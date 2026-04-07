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
import { detectNarratedToolCalls } from './toolPromptInjection.js'

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
  toolNames?: string[],
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
  let loopWasDetected = false
  let specialTokenCount = 0

  while (true) {
    if (loopWasDetected) break
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
        let loopDetected = false

        // Strategy 1: window-based repetition detection (needs enough text)
        if (fullText.length > 3000 && fullText.length % 500 < 50) {
          for (const winSize of [500, 1000, 2000]) {
            if (fullText.length >= winSize * 2) {
              const lastWin = fullText.slice(-winSize)
              const prevWin = fullText.slice(-winSize * 2, -winSize)
              if (lastWin === prevWin) {
                fullText = fullText.slice(0, fullText.length - winSize)
                loopDetected = true
                break
              }
            }
          }
        }

        // Strategy 2: count tool_call markers — works at any text length
        // 4+ markers is almost certainly a loop (normal usage is 1-3)
        if (!loopDetected && fullText.length % 200 < 50) {
          const toolCallCount = (fullText.match(/<\|tool_call>/g) || []).length
          if (toolCallCount > 3) {
            // Keep text up to the 3rd marker
            let idx = -1
            for (let i = 0; i < 3; i++) {
              idx = fullText.indexOf('<|tool_call>', idx + 1)
              if (idx === -1) break
            }
            if (idx > 0) fullText = fullText.slice(0, idx)
            loopDetected = true
          }
        }

        // Strategy 3: incremental special token counting (Gemma thinking loop,
        // Llama/Qwen chat template leaks, etc.) — checked every chunk for
        // instant detection instead of periodic scanning
        if (!loopDetected) {
          const newSpecial = (textContent.match(/<\|[\w]+>|<\/?\w+\|>|<\|[^>]*\|>|\[\/?INST\]/g) || []).length
          specialTokenCount += newSpecial
          if (specialTokenCount > 15) {
            fullText = ''
            loopDetected = true
          }
        }

        if (loopDetected) {
          loopWasDetected = true
          // Cancel the reader to stop consuming the HTTP stream immediately.
          // Without this, the outer while loop keeps reading chunks until the
          // model finishes generating — which can take 10+ minutes for a looping model.
          reader.cancel().catch(() => {})
          break
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

  // If a loop was detected, append a recovery marker and DO NOT execute any
  // tool calls from the truncated text. The [LOOP_RECOVERY] marker lets the
  // query loop in query.ts detect this and auto-retry with a different approach.
  if (loopWasDetected) {
    const warningText = '\n\n[LOOP_RECOVERY] Your output was repeating and was truncated. The repeated tool calls were NOT executed. You MUST try a completely different approach — if a file was missing, check with `ls` first; if a command failed, try an alternative; if you are stuck, explain what you need and ask the user.'
    yield { type: 'content_block_start', index: translationState.blockIndex, content_block: { type: 'text', text: '' } }
    yield { type: 'content_block_delta', index: translationState.blockIndex, delta: { type: 'text_delta', text: warningText } }
    yield { type: 'content_block_stop', index: translationState.blockIndex }
    translationState.blockIndex++
    translationState.isFirstChunk = false
    // Do NOT add to fullText — we skip tool parsing below
  }

  // After stream completes, check for tool calls in text (for tool-less models).
  // CRITICAL: skip when loop was detected — the looping tool call is the cause,
  // executing it would just feed the next loop iteration.
  if (!loopWasDetected) {
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

    // Narration detection: if the model talked about using a tool but didn't
    // produce a tool_call block, inject corrective feedback so it can self-correct
    if (parsedCalls.length === 0 && toolNames && toolNames.length > 0 && fullText.length > 20) {
      const narratedTool = detectNarratedToolCalls(fullText, toolNames)
      if (narratedTool) {
        const correction = `\n\n[You described using the ${narratedTool} tool but didn't include a tool_call block. To actually call it, output:\n\`\`\`tool_call\n{"tool": "${narratedTool}", "arguments": {"prompt": "your task here", "description": "short description"}}\n\`\`\`\nOnly the JSON block above triggers tool execution — text descriptions do NOT call tools.]`
        yield { type: 'content_block_start', index: translationState.blockIndex, content_block: { type: 'text', text: '' } }
        yield { type: 'content_block_delta', index: translationState.blockIndex, delta: { type: 'text_delta', text: correction } }
        yield { type: 'content_block_stop', index: translationState.blockIndex }
        translationState.blockIndex++
        translationState.isFirstChunk = false
      }
    }
  }

  // Empty response detection: if the model returned no content at all (no text,
  // no tool calls), the UI would render a blank message. Throw so the fallback
  // executor can try the next model in the chain instead of silently swallowing it.
  // When a loop was detected we always emit content blocks (the recovery warning),
  // so loopWasDetected alone is sufficient to satisfy "has content".
  const hasContent = !translationState.isFirstChunk || loopWasDetected || translationState.blockIndex > 0
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

            // Vision: convert image blocks to text placeholders if model doesn't support vision
            if (!capabilities.supportsVision) {
              for (const msg of openAIMessages) {
                if (Array.isArray((msg as any).content)) {
                  ;(msg as any).content = (msg as any).content.map((part: any) => {
                    if (part.type === 'image_url' || part.type === 'image') {
                      return { type: 'text', text: '[An image was provided here but your model does not support vision. Ask the user to describe it or use a vision-capable model.]' }
                    }
                    return part
                  })
                }
              }
            }

            // PDFs: convert document/file blocks to text placeholders if model doesn't support PDFs
            if (!capabilities.supportsPDFs) {
              for (const msg of openAIMessages) {
                if (Array.isArray((msg as any).content)) {
                  ;(msg as any).content = (msg as any).content.map((part: any) => {
                    if (part.type === 'document' || part.type === 'file') {
                      // If the block has extractable text content, use it
                      const name = part.name || part.filename || 'document'
                      const textContent = part.text || part.content
                      if (textContent && typeof textContent === 'string') {
                        return { type: 'text', text: `[Content of ${name}]:\n${textContent}` }
                      }
                      return { type: 'text', text: `[A PDF/document "${name}" was provided here but your model does not support PDFs. Use a tool like Bash to extract its text, e.g.: pdftotext file.pdf -]` }
                    }
                    return part
                  })
                }
              }
            }

            // max_tokens capping: clamp to model's actual maximum output tokens
            const maxTokens = typeof params.max_tokens === 'number'
              ? Math.min(params.max_tokens as number, capabilities.maxOutputTokens)
              : capabilities.maxOutputTokens

            // Tool-result conversion: for models with no native tool support,
            // convert role:'tool' messages to role:'user' (the model never sent
            // tool_calls, so it won't understand role:'tool' responses).
            // Also strip tool_calls from assistant messages — the model's original
            // output was plain text that we parsed; replaying tool_calls confuses it.
            if (!capabilities.supportsTools) {
              for (let i = 0; i < openAIMessages.length; i++) {
                const msg = openAIMessages[i] as any
                if (msg.role === 'tool') {
                  // Convert tool result to user message the model can understand
                  const toolName = msg.name || 'Tool'
                  openAIMessages[i] = {
                    role: 'user',
                    content: `[Tool Result: ${toolName}]\n${msg.content ?? '(no output)'}`,
                  }
                } else if (msg.role === 'assistant' && msg.tool_calls) {
                  // Strip tool_calls — the model sees its own text output, not structured calls
                  delete msg.tool_calls
                }
              }
            }

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

            // DRY (Don't Repeat Yourself) sampling for local models.
            // Penalizes repeated token sequences exponentially, preventing
            // loops at the sampler level before they form — far more effective
            // than post-hoc truncation. Settings tuned for code generation.
            if (isLocalModel) {
              body.dry_multiplier = 0.8        // enable DRY, scale penalty
              body.dry_base = 1.75             // exponential escalation rate
              body.dry_allowed_length = 3      // tolerate short repeated patterns (const x =, etc.)
              body.dry_penalty_last_n = -1     // scan full context
              body.dry_sequence_breakers = ['\n', ':', '"', '*', ';', '{', '}']  // code-aware breakers
              // Sampler ordering: DRY after temperature (Daniel Han's fix for quantized models)
              body.samplers = ['top_k', 'top_p', 'min_p', 'temperature', 'dry', 'typ_p', 'xtc']
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

            // Pass tool names so stream can detect narrated (not actually called) tools
            const allToolNames = tools?.map(t => t.name) ?? []
            const stream = openAIStreamToAnthropicStream(response, config.model, allToolNames)
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
