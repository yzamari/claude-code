import { randomUUID } from 'crypto'

interface OpenAITool {
  type: string
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface OpenAIMessage {
  role: string
  content?: string | null
  [key: string]: unknown
}

/**
 * Injects tool descriptions into the system prompt for models that don't support
 * native tool calling. The model is instructed to output tool calls in a specific
 * format that we can parse from the response.
 */
export function injectToolsIntoSystemPrompt(
  systemMessage: OpenAIMessage,
  tools: OpenAITool[],
): OpenAIMessage {
  // Only inject top-level tool names + descriptions (not full JSON schemas)
  // to avoid overwhelming small models with huge system prompts
  const toolDescriptions = tools
    .slice(0, 20)
    .map((t) => `### ${t.function.name}\n${t.function.description}`)
    .join('\n\n')

  const injection = [
    '\n\n---',
    'You have access to tools. To use a tool, respond with EXACTLY this format:',
    '```tool_call',
    '{"tool": "<tool_name>", "arguments": {"param": "value"}}',
    '```',
    '',
    `Available tools (${tools.length} total, showing first ${Math.min(tools.length, 20)}):\n`,
    toolDescriptions,
  ].join('\n')

  return {
    ...systemMessage,
    content: (systemMessage.content ?? '') + injection,
  }
}

interface ParsedToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * Parses tool call attempts from model text output.
 * Supports multiple formats:
 *   1. ```tool_call\n{"tool":"X","arguments":{...}}\n```
 *   2. {"tool":"X","arguments":{...}}  (bare JSON in text)
 *   3. <|tool_call>call:ToolName{args:{...}}<tool_call|>  (Gemma native)
 *
 * Also deduplicates repeated identical calls (loop detection).
 */
export function parseToolCallsFromText(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = []
  const seen = new Set<string>()

  function addCall(name: string, input: Record<string, unknown>) {
    const key = `${name}:${JSON.stringify(input)}`
    if (seen.has(key)) return // skip duplicate (loop detection)
    seen.add(key)
    calls.push({
      id: `toolu_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      name,
      input,
    })
  }

  // Format 1: ```tool_call\n{...}\n```
  const fencedRegex = /```tool_call\s*\n([\s\S]*?)```/g
  let match
  while ((match = fencedRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      if (parsed.tool && typeof parsed.tool === 'string') {
        addCall(parsed.tool, parsed.arguments ?? {})
      }
    } catch { /* skip malformed */ }
  }

  // Format 2: bare {"tool":"X","arguments":{...}} in text (not inside fenced blocks)
  const bareRegex = /\{"tool"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\}/g
  while ((match = bareRegex.exec(text)) !== null) {
    try {
      const input = JSON.parse(match[2])
      addCall(match[1], input)
    } catch { /* skip malformed */ }
  }

  // Format 3: Gemma native <|tool_call>call:ToolName{args:{...}}<tool_call|>
  const gemmaRegex = /<\|tool_call>call:(\w+)\{(?:args:\{)?([^}]*(?:\{[^}]*\})*[^}]*)\}(?:\})?\s*<(?:tool_call|\/tool_call)\|>/g
  while ((match = gemmaRegex.exec(text)) !== null) {
    try {
      const toolName = match[1]
      // Gemma format uses key:value not JSON — try to extract command
      const argsStr = match[2]
      const cmdMatch = argsStr.match(/command\s*:\s*<?\|?"?\|?>?\s*(.+?)\s*<?\|?"?\|?>?\s*$/)
      if (cmdMatch) {
        // Clean up Gemma's special tokens from the command string
        const cmd = cmdMatch[1].replace(/<\|"\|>/g, '').replace(/<\|[^>]+\|>/g, '').trim()
        addCall(toolName, { command: cmd })
      } else {
        // Try parsing as JSON-like
        const jsonAttempt = argsStr.replace(/(\w+):/g, '"$1":').replace(/'/g, '"')
        try {
          addCall(toolName, JSON.parse(`{${jsonAttempt}}`))
        } catch {
          addCall(toolName, { raw: argsStr })
        }
      }
    } catch { /* skip malformed */ }
  }

  // Limit to first 3 unique tool calls to prevent runaway execution
  return calls.slice(0, 3)
}
