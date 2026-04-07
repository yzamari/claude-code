/**
 * Live integration test -- calls a real Ollama instance through our adapter pipeline.
 *
 * Auto-skips when Ollama is not running on localhost:11434.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createOpenAICompatibleClient } from '../../src/services/api/adapters/OpenAIStreamClient.js'
import { getModelCapabilities } from '../../src/services/router/capabilities.js'
import { ModelRouter } from '../../src/services/router/ModelRouter.js'
import { classifyTask, type TaskContext } from '../../src/services/router/taskClassifier.js'
import type { RouterConfig } from '../../src/services/router/routerConfig.js'

const OLLAMA_BASE_URL = 'http://localhost:11434/v1'
const MODEL = 'qwen2.5:0.5b'

let ollamaAvailable = false

beforeAll(async () => {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    ollamaAvailable = res.ok
  } catch {
    ollamaAvailable = false
  }
})

describe.skipIf(() => !ollamaAvailable)('Live Ollama Integration', () => {
  const config: RouterConfig = {
    enabled: true,
    default: 'claude-opus-4-6',
    providers: {
      ollama: {
        type: 'openai-compatible',
        baseUrl: OLLAMA_BASE_URL,
        models: [MODEL],
      },
    },
    routes: [
      { tasks: ['file_search'], model: `ollama/${MODEL}` },
      { tasks: ['simple_edit'], model: `ollama/${MODEL}` },
      { tasks: ['complex_reasoning', 'planning'], model: 'claude-opus-4-6' },
    ],
    fallbackChain: ['claude-sonnet-4-6'],
  }

  it('routes Grep queries to Ollama', () => {
    const router = new ModelRouter(config)
    const grepContext: TaskContext = {
      activeTools: ['Grep'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    const route = router.resolve(grepContext)
    expect(route.model).toBe(MODEL)
    expect(route.providerName).toBe('ollama')
    expect(route.isNativeAnthropic).toBe(false)
  })

  it('routes reasoning queries to Anthropic default', () => {
    const router = new ModelRouter(config)
    const reasoningContext: TaskContext = {
      activeTools: [],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    const route = router.resolve(reasoningContext)
    expect(route.model).toBe('claude-opus-4-6')
    expect(route.isNativeAnthropic).toBe(true)
  })

  it('returns correct model capabilities', () => {
    const ollamaCaps = getModelCapabilities(MODEL)
    const claudeCaps = getModelCapabilities('claude-opus-4-6')

    // qwen2.5:0.5b has no exact or prefix match in KNOWN_CAPABILITIES,
    // so it falls through to DEFAULT_CAPABILITIES (supportsTools: false)
    expect(ollamaCaps.supportsTools).toBe(false)
    expect(claudeCaps.supportsTools).toBe(true)
    expect(claudeCaps.supportsThinking).toBe(true)
    expect(claudeCaps.maxInputTokens).toBeGreaterThan(0)
  })

  it('classifies tasks correctly for various contexts', () => {
    const cases: [string, TaskContext, string][] = [
      [
        'Grep query',
        { activeTools: ['Grep'], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined },
        'file_search',
      ],
      [
        'Plan mode',
        { activeTools: [], messageTokenCount: 5000, isPlanMode: true, isSubagent: false, userModelOverride: undefined },
        'planning',
      ],
      [
        'Large context (200K)',
        { activeTools: [], messageTokenCount: 200000, isPlanMode: false, isSubagent: false, userModelOverride: undefined },
        'large_context',
      ],
      [
        'Subagent',
        { activeTools: [], messageTokenCount: 5000, isPlanMode: false, isSubagent: true, userModelOverride: undefined },
        'subagent',
      ],
      [
        'Default reasoning',
        { activeTools: [], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined },
        'complex_reasoning',
      ],
    ]

    for (const [label, ctx, expectedTask] of cases) {
      const taskType = classifyTask(ctx)
      expect(taskType, `Task classification for "${label}"`).toBe(expectedTask)
    }
  })

  it('streams a response from Ollama via the adapter', async () => {
    const client = createOpenAICompatibleClient({
      baseUrl: OLLAMA_BASE_URL,
      model: MODEL,
    })

    const streamObj = await client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 200,
        system: [{ type: 'text', text: 'You are a helpful coding assistant. Be very brief.' }],
        messages: [
          { role: 'user', content: 'What is a TypeScript interface? Answer in one sentence.' },
        ],
        stream: true,
      },
      {},
    )

    const { data: stream } = await (streamObj as any).withResponse()

    let fullText = ''
    let eventCount = 0
    let hasMessageStart = false
    let hasMessageStop = false
    let hasContentBlockStart = false

    for await (const event of stream as AsyncIterable<any>) {
      eventCount++

      if (event.type === 'message_start') {
        hasMessageStart = true
        expect(event.message).toBeDefined()
        expect(event.message.model).toBeDefined()
        expect(event.message.id).toBeDefined()
      } else if (event.type === 'content_block_start') {
        hasContentBlockStart = true
        expect(event.content_block.type).toBe('text')
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        fullText += event.delta.text
      } else if (event.type === 'message_stop') {
        hasMessageStop = true
      }
    }

    expect(eventCount).toBeGreaterThan(0)
    expect(fullText.length).toBeGreaterThan(0)
    expect(hasMessageStart).toBe(true)
    expect(hasMessageStop).toBe(true)
    expect(hasContentBlockStart).toBe(true)
  }, 30000) // 30s timeout for live API call
})
