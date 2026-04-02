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
        index: number
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

  // Text content
  if (delta.content != null && delta.content !== '') {
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
      delta: { type: 'text_delta', text: delta.content },
    })
  }

  // Tool calls
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      if (tc.id && tc.function?.name) {
        // New tool call — emit content_block_start
        events.push({
          type: 'content_block_start',
          index: state.blockIndex + tc.index,
          content_block: {
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: {},
          },
        })
      }
      if (tc.function?.arguments) {
        events.push({
          type: 'content_block_delta',
          index: state.blockIndex + tc.index,
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

    events.push({
      type: 'message_delta',
      delta: {
        stop_reason: FINISH_REASON_MAP[finish_reason] || 'end_turn',
      },
      usage: {
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
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  }
}

export function createMessageStopEvent(): AnthropicStreamEvent {
  return { type: 'message_stop' }
}
