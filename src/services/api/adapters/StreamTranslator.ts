/**
 * Translates OpenAI ChatCompletionChunk events into Anthropic BetaRawMessageStreamEvent events.
 *
 * This is the critical bridge that allows the existing claude-code streaming pipeline
 * (which processes BetaRawMessageStreamEvent) to work with OpenAI-compatible APIs.
 */

export interface OpenAIChunk {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

interface TranslationState {
  blockIndex: number
  isFirstChunk: boolean
  hasToolCalls?: boolean
}

// Minimal Anthropic event types — only the fields the streaming pipeline reads.
// We avoid importing the full SDK types so this module has zero external dependencies.
export interface AnthropicStreamEvent {
  type: string
  [key: string]: unknown
}

const FINISH_REASON_MAP: Record<string, string> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  content_filter: 'end_turn',
}

export function translateOpenAIChunkToAnthropicEvents(
  chunk: OpenAIChunk,
  state: TranslationState,
): AnthropicStreamEvent[] {
  const events: AnthropicStreamEvent[] = []
  const choice = chunk.choices[0]
  if (!choice) return events

  const { delta, finish_reason } = choice

  // Text content — models use different fields:
  //   - standard: delta.content
  //   - Ollama thinking models: delta.reasoning (content is "")
  //   - llama.cpp thinking models: delta.reasoning_content (content has the answer)
  const rawContent = delta.content
  const textContent = (rawContent != null && rawContent !== '' ? rawContent : null)
    ?? (delta as any).reasoning_content
    ?? (delta as any).reasoning
    ?? null
  if (textContent != null && textContent !== '') {
    if (state.isFirstChunk) {
      events.push({
        type: 'content_block_start',
        index: state.blockIndex,
        content_block: { type: 'text', text: '' },
      })
    }
    events.push({
      type: 'content_block_delta',
      index: state.blockIndex,
      delta: { type: 'text_delta', text: textContent },
    })
  }

  // Tool calls
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      // Gemini may omit the index field (OpenAI always includes it).
      // Default to 0 when missing so blockIndex arithmetic stays valid.
      const tcIndex = tc.index ?? 0

      // Gemini 3.x includes thought_signature in tool calls. Capture it so
      // we can include it in the assistant message when sending tool results back.
      const thoughtSignature =
        (tc as any).extra_content?.google?.thought_signature as string | undefined

      if (tc.id && tc.function?.name) {
        // New tool call — emit content_block_start
        state.hasToolCalls = true
        events.push({
          type: 'content_block_start',
          index: state.blockIndex + tcIndex,
          content_block: {
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: {},
            ...(thoughtSignature ? { _gemini_thought_signature: thoughtSignature } : {}),
          },
        })
      }
      if (tc.function?.arguments) {
        events.push({
          type: 'content_block_delta',
          index: state.blockIndex + tcIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: tc.function.arguments,
          },
        })
      }
    }
  }

  // Finish reason
  if (finish_reason) {
    // Close open content blocks
    events.push({
      type: 'content_block_stop',
      index: state.blockIndex,
    })

    // Gemini may send finish_reason="stop" even when tool calls were made.
    // Override to "tool_use" when we know tools were emitted.
    let stopReason = FINISH_REASON_MAP[finish_reason] || 'end_turn'
    if (state.hasToolCalls && stopReason === 'end_turn') {
      stopReason = 'tool_use'
    }

    events.push({
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
      },
      usage: {
        input_tokens: chunk.usage?.prompt_tokens ?? 0,
        output_tokens: chunk.usage?.completion_tokens ?? 0,
      },
    })
  }

  return events
}

export function createMessageStartEvent(
  model: string,
  id: string,
): AnthropicStreamEvent {
  return {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        service_tier: 'standard',
        cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
        inference_geo: '',
        iterations: [],
        speed: 'standard',
      },
    },
  }
}

export function createMessageStopEvent(): AnthropicStreamEvent {
  return { type: 'message_stop' }
}
