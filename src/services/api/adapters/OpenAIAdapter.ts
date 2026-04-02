/**
 * Translates Anthropic Messages API format to OpenAI Chat Completions format.
 *
 * The existing codebase constructs requests in Anthropic format (messages with
 * content blocks, tool_use/tool_result, system as separate param). This module
 * translates those into OpenAI-compatible format for non-Anthropic providers.
 */

// Minimal Anthropic-side types (avoid importing full SDK for testability)
export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export interface AnthropicContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  [key: string]: unknown
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface AnthropicToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

interface AnthropicSystemBlock {
  type: 'text'
  text: string
  [key: string]: unknown
}

export function translateAnthropicToOpenAI(
  messages: AnthropicMessage[],
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content })
      continue
    }

    // Process content blocks
    const blocks = msg.content

    // Check for tool_result blocks (user message with tool results)
    const toolResults = blocks.filter(b => b.type === 'tool_result')
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        const content =
          typeof tr.content === 'string'
            ? tr.content
            : Array.isArray(tr.content)
              ? tr.content
                  .filter((b): b is AnthropicContentBlock => b.type === 'text')
                  .map(b => b.text)
                  .join('\n')
              : ''
        result.push({
          role: 'tool',
          content,
          tool_call_id: tr.tool_use_id!,
        })
      }

      // Also include non-tool-result user content (e.g. text alongside tool results)
      const textBlocks = blocks.filter(b => b.type === 'text')
      if (textBlocks.length > 0) {
        result.push({
          role: 'user',
          content: textBlocks.map(b => b.text).join('\n'),
        })
      }
      continue
    }

    // Check for tool_use blocks (assistant message with tool calls)
    const toolUses = blocks.filter(b => b.type === 'tool_use')
    const textBlocks = blocks.filter(b => b.type === 'text')
    // Strip thinking blocks — non-Anthropic models don't produce/consume them
    const textContent = textBlocks.map(b => b.text).join('\n') || null

    if (toolUses.length > 0) {
      result.push({
        role: 'assistant',
        content: textContent,
        tool_calls: toolUses.map(tu => ({
          id: tu.id!,
          type: 'function' as const,
          function: {
            name: tu.name!,
            arguments: JSON.stringify(tu.input ?? {}),
          },
        })),
      })
    } else {
      result.push({
        role: msg.role,
        content: textContent ?? '',
      })
    }
  }

  return result
}

export function translateSystemPrompt(
  system: AnthropicSystemBlock[],
): OpenAIMessage {
  const text = system
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n\n')
  return { role: 'system', content: text }
}

export function translateTools(tools: AnthropicToolDef[]): OpenAITool[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}
