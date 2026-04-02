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
 * Looks for ```tool_call ... ``` blocks with JSON.
 */
export function parseToolCallsFromText(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = []
  const regex = /```tool_call\s*\n([\s\S]*?)```/g
  let match
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      if (parsed.tool && typeof parsed.tool === 'string') {
        calls.push({
          id: `toolu_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
          name: parsed.tool,
          input: parsed.arguments ?? {},
        })
      }
    } catch {
      // Malformed JSON — skip this block
    }
  }
  return calls
}
