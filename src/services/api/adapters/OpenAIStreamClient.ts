/**
 * Creates an Anthropic-compatible client object that internally calls
 * an OpenAI-compatible API. The returned object mimics the shape of
 * the Anthropic SDK's client so it can be used as a drop-in replacement
 * in getAnthropicClient().
 */

import { randomUUID } from 'crypto'
import {
  translateAnthropicToOpenAI,
  translateSystemPrompt,
  translateTools,
} from './OpenAIAdapter.js'
import {
  translateOpenAIChunkToAnthropicEvents,
  createMessageStartEvent,
  createMessageStopEvent,
  type OpenAIChunk,
} from './StreamTranslator.js'
import { getModelCapabilities } from '../../router/capabilities.js'

export interface OpenAIClientConfig {
  baseUrl: string
  apiKey?: string
  model: string
  defaultHeaders?: Record<string, string>
}

/**
 * Async iterable that yields Anthropic-format stream events
 * from an OpenAI-format SSE response.
 */
async function* openAIStreamToAnthropicStream(
  response: Response,
  model: string,
): AsyncGenerator<unknown> {
  const messageId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`

  // Emit synthetic message_start
  yield createMessageStartEvent(model, messageId)

  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''
  let blockIndex = 0
  let isFirstTextChunk = true

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]') continue
      if (!trimmed.startsWith('data: ')) continue

      const json = trimmed.slice(6)
      let chunk: OpenAIChunk
      try {
        chunk = JSON.parse(json)
      } catch {
        continue
      }

      const events = translateOpenAIChunkToAnthropicEvents(chunk, {
        blockIndex,
        isFirstChunk: isFirstTextChunk,
      })

      for (const event of events) {
        yield event
        if (event.type === 'content_block_start') {
          isFirstTextChunk = false
        }
        if (event.type === 'content_block_stop') {
          blockIndex++
        }
      }
    }
  }

  // Emit synthetic message_stop
  yield createMessageStopEvent()
}

export function createOpenAICompatibleClient(config: OpenAIClientConfig) {
  const capabilities = getModelCapabilities(config.model)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    ...(config.defaultHeaders ?? {}),
  }

  return {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>, options?: { signal?: AbortSignal; headers?: Record<string, string> }) => {
          // Translate Anthropic params to OpenAI format
          const messages = params.messages as Array<{ role: string; content: unknown }>
          const system = params.system as Array<{ type: 'text'; text: string }> | undefined
          const tools = params.tools as Array<{ name: string; description: string; input_schema: Record<string, unknown> }> | undefined

          const openAIMessages = [
            ...(system ? [translateSystemPrompt(system)] : []),
            ...translateAnthropicToOpenAI(messages as any),
          ]

          const openAITools = tools && capabilities.supportsTools
            ? translateTools(tools)
            : undefined

          const body: Record<string, unknown> = {
            model: config.model,
            messages: openAIMessages,
            stream: true,
            max_tokens: params.max_tokens,
          }

          if (openAITools && openAITools.length > 0) {
            body.tools = openAITools
          }

          // Strip Anthropic-specific params (thinking, betas, cache_control, etc.)
          // They are simply not sent — graceful degradation

          const response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              ...headers,
              ...(options?.headers ?? {}),
            },
            body: JSON.stringify(body),
            signal: options?.signal,
          })

          if (!response.ok) {
            const text = await response.text()
            throw new Error(`OpenAI-compatible API error (${response.status}): ${text}`)
          }

          // Return an object that matches the Anthropic stream shape
          const stream = openAIStreamToAnthropicStream(response, config.model)

          // The Anthropic SDK returns a Stream with .withResponse()
          // We mimic that interface
          const streamObj = Object.assign(stream, {
            controller: new AbortController(),
            async withResponse() {
              return {
                data: stream,
                response,
                request_id: response.headers.get('x-request-id') ?? randomUUID(),
              }
            },
          })

          return streamObj
        },
      },
    },
  }
}
