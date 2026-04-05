/**
 * Creates an Anthropic-compatible client object that internally calls
 * an OpenAI-compatible API. The returned object mimics the shape of
 * the Anthropic SDK's client so it can be used as a drop-in replacement
 * in getAnthropicClient().
 */

import { randomUUID } from 'crypto'
import { logForDebugging } from '../../../utils/debug.js'
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
  const translationState = { blockIndex: 0, isFirstChunk: true, hasToolCalls: false }
  let fullText = ''
  let deferredMessageDelta: unknown = null

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

      // Accumulate full text for tool call parsing
      // Models use different fields: content, reasoning (Ollama), reasoning_content (llama.cpp)
      const delta = chunk.choices[0]?.delta
      const rawContent = delta?.content
      const textContent = (rawContent != null && rawContent !== '' ? rawContent : null)
        ?? (delta as any)?.reasoning_content
        ?? (delta as any)?.reasoning
      if (textContent) {
        fullText += textContent

        // Loop detection: if the model is repeating the same pattern, abort
        // Check every 2000 chars to avoid overhead
        if (fullText.length > 4000 && fullText.length % 2000 < 50) {
          const last1k = fullText.slice(-1000)
          const prev1k = fullText.slice(-2000, -1000)
          if (last1k === prev1k) {
            // Model is stuck in a loop — truncate and stop
            fullText = fullText.slice(0, fullText.length - 1000)
            break
          }
        }
      }

      const events = translateOpenAIChunkToAnthropicEvents(chunk, translationState)

      for (const event of events) {
        // Defer message_delta so we can modify stop_reason if tool calls are found
        if ((event as any).type === 'message_delta') {
          deferredMessageDelta = event
          continue
        }
        yield event
        if (event.type === 'content_block_start') {
          translationState.isFirstChunk = false
        }
        if (event.type === 'content_block_stop') {
          translationState.blockIndex++
        }
      }
    }
  }

  // After stream completes, check for tool calls in text (for tool-less models)
  const { parseToolCallsFromText } = await import('./toolPromptInjection.js')
  const parsedCalls = parseToolCallsFromText(fullText)
  if (parsedCalls.length > 0) {
    // Emit synthetic tool_use content blocks
    for (const call of parsedCalls) {
      yield { type: 'content_block_start', index: translationState.blockIndex, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } }
      yield { type: 'content_block_delta', index: translationState.blockIndex, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } }
      yield { type: 'content_block_stop', index: translationState.blockIndex }
      translationState.blockIndex++
    }
    // Override the stop reason to tool_use
    if (deferredMessageDelta) {
      const md = deferredMessageDelta as any
      deferredMessageDelta = {
        ...md,
        delta: { ...md.delta, stop_reason: 'tool_use' },
      }
    }
  }

  // Empty response detection: if the model returned no content at all (no text,
  // no tool calls), the UI would render a blank message. Throw so the fallback
  // executor can try the next model in the chain instead of silently swallowing it.
  const hasContent = !translationState.isFirstChunk || parsedCalls.length > 0 || translationState.blockIndex > 0
  if (!hasContent) {
    throw new OpenAICompatibleAPIError(
      0,
      `External model "${model}" returned an empty response with no content blocks. ` +
        'This typically means the model refused the request or the provider returned an empty stream.',
      new Headers(),
    )
  }

  // Emit the deferred message_delta (with possibly updated stop_reason)
  // If no message_delta was deferred (server didn't send finish_reason), synthesize one
  if (deferredMessageDelta) {
    yield deferredMessageDelta
  } else {
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { input_tokens: 0, output_tokens: 0 },
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

            // Strip safety layer for local models (localhost endpoints)
            const isLocalModel = config.baseUrl?.match(/localhost|127\.0\.0\.1/) !== null
            const openAIMessages = [
              ...(system ? [translateSystemPrompt(system, { stripSafetyLayer: isLocalModel })] : []),
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

            // Tool-less model support: inject tool descriptions into system prompt
            if (!capabilities.supportsTools && tools && tools.length > 0) {
              const { injectToolsIntoSystemPrompt } = await import('./toolPromptInjection.js')
              const translatedTools = translateTools(tools)
              if (openAIMessages[0]?.role === 'system') {
                openAIMessages[0] = injectToolsIntoSystemPrompt(openAIMessages[0] as any, translatedTools) as any
              } else {
                openAIMessages.unshift(injectToolsIntoSystemPrompt({ role: 'system', content: '' } as any, translatedTools) as any)
              }
            }

            logForDebugging(
              `[ExternalModel] → ${config.baseUrl} model=${config.model} maxTokens=${maxTokens} tools=${openAITools?.length ?? 0}`,
            )

            const body: Record<string, unknown> = {
              model: config.model,
              messages: openAIMessages,
              stream: true,
              max_tokens: maxTokens,
            }

            if (openAITools && openAITools.length > 0) {
              body.tools = openAITools
            }

            // For local models, use a generous 10-minute timeout instead of the
            // default ~4min SDK timeout. Local models with "thinking" can take
            // several minutes before producing the first token.
            const isLocal = config.baseUrl?.match(/localhost|127\.0\.0\.1/) !== null
            const fetchSignal = isLocal
              ? AbortSignal.timeout(600_000) // 10 minutes for local models
              : options?.signal

            let response: Response
            try {
              response = await fetch(`${config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  ...headers,
                  ...(options?.headers ?? {}),
                },
                body: JSON.stringify(body),
                signal: fetchSignal,
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
