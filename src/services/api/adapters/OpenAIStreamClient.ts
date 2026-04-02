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
import { OpenAICompatibleAPIError } from './errors.js'

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
        /**
         * Mimics the Anthropic SDK's create() which returns a "thenable" object:
         *   - Has .withResponse() method (called BEFORE await in the real codebase)
         *   - Has .then()/.catch() so it can be awaited directly too
         *
         * Real codebase pattern:
         *   const result = await anthropic.beta.messages.create({...}).withResponse()
         *   // .withResponse() is called on the return value BEFORE the await resolves
         */
        create(params: Record<string, unknown>, options?: { signal?: AbortSignal; headers?: Record<string, string> }) {
          // Build the actual API call as a lazy promise
          const doFetch = async () => {
            const messages = params.messages as Array<{ role: string; content: unknown }>
            const system = params.system as Array<{ type: 'text'; text: string }> | undefined
            const tools = params.tools as Array<{ name: string; description: string; input_schema: Record<string, unknown> }> | undefined

            const openAIMessages = [
              ...(system ? [translateSystemPrompt(system)] : []),
              ...translateAnthropicToOpenAI(messages as any),
            ]

            // --- Capability enforcement: strip unsupported content ---

            // Vision stripping: remove image blocks if model doesn't support vision
            if (!capabilities.supportsVision) {
              for (const msg of openAIMessages) {
                if (Array.isArray((msg as any).content)) {
                  ;(msg as any).content = (msg as any).content.filter(
                    (part: any) => part.type !== 'image_url' && part.type !== 'image',
                  )
                }
              }
            }

            // PDF stripping: remove document/file blocks if model doesn't support PDFs
            if (!capabilities.supportsPDFs) {
              for (const msg of openAIMessages) {
                if (Array.isArray((msg as any).content)) {
                  ;(msg as any).content = (msg as any).content.filter(
                    (part: any) => part.type !== 'document' && part.type !== 'file',
                  )
                }
              }
            }

            // max_tokens capping: clamp to model's actual maximum output tokens
            const maxTokens = typeof params.max_tokens === 'number'
              ? Math.min(params.max_tokens as number, capabilities.maxOutputTokens)
              : capabilities.maxOutputTokens

            // --- End capability enforcement ---

            const openAITools = tools && capabilities.supportsTools
              ? translateTools(tools)
              : undefined

            const body: Record<string, unknown> = {
              model: config.model,
              messages: openAIMessages,
              stream: true,
              stream_options: { include_usage: true },
              max_tokens: maxTokens,
            }

            if (openAITools && openAITools.length > 0) {
              body.tools = openAITools
            }

            let response: Response
            try {
              response = await fetch(`${config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  ...headers,
                  ...(options?.headers ?? {}),
                },
                body: JSON.stringify(body),
                signal: options?.signal,
              })
            } catch (fetchError) {
              throw new OpenAICompatibleAPIError(
                0,
                `Connection failed: ${(fetchError as Error).message}`,
                new Headers(),
              )
            }

            if (!response.ok) {
              const text = await response.text()
              throw new OpenAICompatibleAPIError(
                response.status,
                `OpenAI-compatible API error (${response.status}): ${text}`,
                response.headers,
              )
            }

            const stream = openAIStreamToAnthropicStream(response, config.model)
            const streamObj = Object.assign(stream, {
              controller: new AbortController(),
            })

            return { stream: streamObj, response }
          }

          // Cache the promise so both .then() and .withResponse() share the same fetch
          let fetchPromise: ReturnType<typeof doFetch> | null = null
          const ensureFetch = () => {
            if (!fetchPromise) fetchPromise = doFetch()
            return fetchPromise
          }

          // Return a thenable with .withResponse() — matches Anthropic SDK shape
          return {
            // .withResponse() — called before await in the real codebase
            withResponse() {
              return ensureFetch().then(({ stream, response }) => ({
                data: stream,
                response,
                request_id: response.headers.get('x-request-id') ?? randomUUID(),
              }))
            },
            // Make it thenable so `await create(...)` also works
            then(resolve: (value: any) => any, reject?: (reason: any) => any) {
              return ensureFetch().then(({ stream }) => stream).then(resolve, reject)
            },
            catch(reject: (reason: any) => any) {
              return ensureFetch().then(({ stream }) => stream).catch(reject)
            },
          }
        },
      },
    },
  }
}
