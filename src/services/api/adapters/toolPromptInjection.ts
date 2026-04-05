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
 * Builds a compact parameter summary for a tool's JSON schema.
 * Returns something like: path (string, required), content (string)
 */
function summarizeParams(params: Record<string, unknown>): string {
  const props = (params.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = new Set((params.required ?? []) as string[])
  const entries = Object.entries(props).slice(0, 10) // cap at 10 params
  if (entries.length === 0) return '(no parameters)'
  return entries
    .map(([name, schema]) => {
      const type = schema.type ?? 'any'
      const req = required.has(name) ? ', required' : ''
      const desc = schema.description
        ? ` — ${(schema.description as string).slice(0, 80)}`
        : ''
      return `  - ${name} (${type}${req})${desc}`
    })
    .join('\n')
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
  // Include all tools with parameter schemas so the model knows how to call them
  const toolDescriptions = tools
    .map((t) => {
      const params = summarizeParams(t.function.parameters)
      // Truncate long descriptions to keep prompt manageable
      const desc = t.function.description.length > 200
        ? t.function.description.slice(0, 200) + '...'
        : t.function.description
      return `### ${t.function.name}\n${desc}\nParameters:\n${params}`
    })
    .join('\n\n')

  const injection = [
    '\n\n---',
    '# TOOL USE',
    'You have access to tools. To use a tool, output EXACTLY this format (JSON inside a fenced block):',
    '```tool_call',
    '{"tool": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}',
    '```',
    '',
    'RULES:',
    '- Use valid JSON with double quotes for all keys and string values.',
    '- One tool call per fenced block. You may use multiple blocks in one response.',
    '- Do NOT hallucinate or roleplay tool results. Wait for the actual result.',
    '- If a tool call fails, try a different approach. Do NOT retry the same call.',
    '- Maximum 10 tool calls per response.',
    '',
    `Available tools (${tools.length}):\n`,
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
  // Use a greedy approach: find each <|tool_call>call:Name... and match to closing <tool_call|>
  const gemmaStartRegex = /<\|tool_call>call:(\w+)\{/g
  while ((match = gemmaStartRegex.exec(text)) !== null) {
    try {
      const toolName = match[1]
      const argsStart = match.index + match[0].length
      // Find the closing <tool_call|> or </tool_call|> after this point
      const closingIdx = text.indexOf('<tool_call|>', argsStart)
      const closingIdx2 = text.indexOf('</tool_call|>', argsStart)
      const endIdx = closingIdx === -1 ? closingIdx2
        : closingIdx2 === -1 ? closingIdx
        : Math.min(closingIdx, closingIdx2)
      if (endIdx === -1) continue

      // Extract everything between the opening { and the closing tag, then strip trailing }
      let argsStr = text.slice(argsStart, endIdx).replace(/\}\s*$/, '').replace(/^\s*args:\{/, '')
      // Clean Gemma special tokens
      argsStr = argsStr.replace(/<\|"\|>/g, '').replace(/<\|[^>]+\|>/g, '')

      // Try command shortcut first (most common for Bash calls)
      const cmdMatch = argsStr.match(/^command\s*:\s*"?(.+?)"?\s*$/)
      if (cmdMatch) {
        addCall(toolName, { command: cmdMatch[1].trim() })
      } else {
        // Try to parse as key:"value" pairs (handles multi-arg calls like Agent)
        const pairs: Record<string, string> = {}
        // Match key: "value" or key: 'value' patterns, allowing multiline values
        const pairRegex = /(\w+)\s*:\s*"((?:[^"\\]|\\.)*)"|(\w+)\s*:\s*'((?:[^'\\]|\\.)*)'/g
        let pairMatch
        while ((pairMatch = pairRegex.exec(argsStr)) !== null) {
          const key = pairMatch[1] || pairMatch[3]
          const val = pairMatch[2] || pairMatch[4]
          pairs[key] = val
        }

        if (Object.keys(pairs).length > 0) {
          addCall(toolName, pairs)
        } else {
          // Fallback: try JSON-like conversion
          const jsonAttempt = argsStr.replace(/(\w+):/g, '"$1":').replace(/'/g, '"')
          try {
            addCall(toolName, JSON.parse(`{${jsonAttempt}}`))
          } catch {
            addCall(toolName, { raw: argsStr })
          }
        }
      }
    } catch { /* skip malformed */ }
  }

  // Limit to first 10 unique tool calls to prevent runaway execution
  return calls.slice(0, 10)
}
