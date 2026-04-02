# Multi-Model Router Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add task-based multi-model routing to Claude Code, enabling OpenAI-compatible (Ollama, OpenAI, OpenRouter), Gemini, and local mlx-turboquant backends alongside native Claude.

**Architecture:** Adapter pattern with Anthropic as internal lingua franca. A `ModelRouter` classifies tasks and routes to providers. Adapters translate OpenAI/Gemini message formats into Anthropic's `BetaMessage`/`BetaRawMessageStreamEvent` types so the existing 512K-line codebase remains untouched.

**Tech Stack:** TypeScript, Bun, Vitest, Zod v4, `openai` SDK, `@google/generative-ai` SDK

**Design Doc:** `docs/plans/2026-04-02-multi-model-router-design.md`

---

## Task 1: Model Capabilities Registry

**Files:**
- Create: `src/services/router/capabilities.ts`
- Test: `tests/router/capabilities.test.ts`

This is the foundation — every other component queries it to know what a model can/cannot do.

**Step 1: Write the failing test**

Create `tests/router/capabilities.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  getModelCapabilities,
  registerModelCapabilities,
  type ModelCapabilities,
} from 'src/services/router/capabilities.js'

describe('ModelCapabilities', () => {
  it('returns default capabilities for unknown models', () => {
    const caps = getModelCapabilities('unknown-model-xyz')
    expect(caps.supportsTools).toBe(false)
    expect(caps.supportsThinking).toBe(false)
    expect(caps.supportsStreaming).toBe(true)
    expect(caps.maxInputTokens).toBe(4096)
  })

  it('returns known capabilities for Claude models', () => {
    const caps = getModelCapabilities('claude-opus-4-6')
    expect(caps.supportsTools).toBe(true)
    expect(caps.supportsThinking).toBe(true)
    expect(caps.supportsEffort).toBe(true)
    expect(caps.supportsCaching).toBe(true)
    expect(caps.maxInputTokens).toBe(1_000_000)
  })

  it('returns known capabilities for OpenAI models', () => {
    const caps = getModelCapabilities('gpt-4o')
    expect(caps.supportsTools).toBe(true)
    expect(caps.supportsThinking).toBe(false)
    expect(caps.supportsStreaming).toBe(true)
    expect(caps.maxInputTokens).toBe(128_000)
  })

  it('returns known capabilities for Gemini models', () => {
    const caps = getModelCapabilities('gemini-2.5-pro')
    expect(caps.supportsTools).toBe(true)
    expect(caps.supportsThinking).toBe(false)
    expect(caps.maxInputTokens).toBe(2_000_000)
  })

  it('allows registering custom model capabilities', () => {
    const custom: ModelCapabilities = {
      maxInputTokens: 32_768,
      maxOutputTokens: 4096,
      supportsTools: false,
      supportsStreaming: true,
      supportsVision: false,
      supportsThinking: false,
      supportsEffort: false,
      supportsCaching: false,
      supportsPDFs: false,
      toolCallStyle: 'none',
    }
    registerModelCapabilities('ollama/qwen2.5-coder:7b', custom)
    const caps = getModelCapabilities('ollama/qwen2.5-coder:7b')
    expect(caps.maxInputTokens).toBe(32_768)
    expect(caps.supportsTools).toBe(false)
  })

  it('matches partial model names with prefix lookup', () => {
    // 'gpt-4o-mini' should match 'gpt-4o' capabilities as fallback
    const caps = getModelCapabilities('gpt-4o-mini')
    expect(caps.supportsTools).toBe(true)
    expect(caps.maxInputTokens).toBe(128_000)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/capabilities.test.ts`
Expected: FAIL — module `src/services/router/capabilities.js` not found

**Step 3: Write minimal implementation**

Create `src/services/router/capabilities.ts`:

```typescript
export interface ModelCapabilities {
  maxInputTokens: number
  maxOutputTokens: number
  supportsTools: boolean
  supportsStreaming: boolean
  supportsVision: boolean
  supportsThinking: boolean
  supportsEffort: boolean
  supportsCaching: boolean
  supportsPDFs: boolean
  toolCallStyle: 'anthropic' | 'openai' | 'none'
}

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  maxInputTokens: 4096,
  maxOutputTokens: 4096,
  supportsTools: false,
  supportsStreaming: true,
  supportsVision: false,
  supportsThinking: false,
  supportsEffort: false,
  supportsCaching: false,
  supportsPDFs: false,
  toolCallStyle: 'none',
}

const KNOWN_CAPABILITIES: Record<string, Partial<ModelCapabilities>> = {
  // Claude models
  'claude-opus-4-6': {
    maxInputTokens: 1_000_000, maxOutputTokens: 16_384,
    supportsTools: true, supportsVision: true, supportsThinking: true,
    supportsEffort: true, supportsCaching: true, supportsPDFs: true,
    toolCallStyle: 'anthropic',
  },
  'claude-sonnet-4-6': {
    maxInputTokens: 1_000_000, maxOutputTokens: 16_384,
    supportsTools: true, supportsVision: true, supportsThinking: true,
    supportsEffort: false, supportsCaching: true, supportsPDFs: true,
    toolCallStyle: 'anthropic',
  },
  'claude-haiku-4-5': {
    maxInputTokens: 200_000, maxOutputTokens: 8_192,
    supportsTools: true, supportsVision: true, supportsThinking: true,
    supportsEffort: false, supportsCaching: true, supportsPDFs: true,
    toolCallStyle: 'anthropic',
  },
  // OpenAI models
  'gpt-4o': {
    maxInputTokens: 128_000, maxOutputTokens: 16_384,
    supportsTools: true, supportsVision: true, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: false,
    toolCallStyle: 'openai',
  },
  'o3': {
    maxInputTokens: 200_000, maxOutputTokens: 100_000,
    supportsTools: true, supportsVision: true, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: false,
    toolCallStyle: 'openai',
  },
  // Gemini models
  'gemini-2.5-pro': {
    maxInputTokens: 2_000_000, maxOutputTokens: 65_536,
    supportsTools: true, supportsVision: true, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: true,
    toolCallStyle: 'openai',
  },
  'gemini-2.5-flash': {
    maxInputTokens: 1_000_000, maxOutputTokens: 65_536,
    supportsTools: true, supportsVision: true, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: false,
    toolCallStyle: 'openai',
  },
  // Local models (common Ollama defaults)
  'llama3': {
    maxInputTokens: 128_000, maxOutputTokens: 4096,
    supportsTools: false, supportsVision: false, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: false,
    toolCallStyle: 'none',
  },
  'qwen2.5-coder': {
    maxInputTokens: 32_768, maxOutputTokens: 4096,
    supportsTools: false, supportsVision: false, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: false,
    toolCallStyle: 'none',
  },
  'deepseek-coder-v2': {
    maxInputTokens: 128_000, maxOutputTokens: 4096,
    supportsTools: true, supportsVision: false, supportsThinking: false,
    supportsEffort: false, supportsCaching: false, supportsPDFs: false,
    toolCallStyle: 'openai',
  },
}

// User-registered capabilities (from settings or runtime)
const customCapabilities = new Map<string, ModelCapabilities>()

export function registerModelCapabilities(
  modelId: string,
  caps: ModelCapabilities,
): void {
  customCapabilities.set(modelId, caps)
}

export function getModelCapabilities(modelId: string): ModelCapabilities {
  // 1. Check custom registry first
  const custom = customCapabilities.get(modelId)
  if (custom) return custom

  // 2. Check exact match in known capabilities
  const known = KNOWN_CAPABILITIES[modelId]
  if (known) return { ...DEFAULT_CAPABILITIES, ...known }

  // 3. Prefix match: "gpt-4o-mini" matches "gpt-4o", "claude-opus-4-6-20260101" matches "claude-opus-4-6"
  for (const [prefix, caps] of Object.entries(KNOWN_CAPABILITIES)) {
    if (modelId.startsWith(prefix)) {
      return { ...DEFAULT_CAPABILITIES, ...caps }
    }
  }

  // 4. Heuristic: if model name contains provider hints
  if (modelId.startsWith('claude-')) {
    return { ...DEFAULT_CAPABILITIES, supportsTools: true, toolCallStyle: 'anthropic' }
  }
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3')) {
    return { ...DEFAULT_CAPABILITIES, supportsTools: true, toolCallStyle: 'openai' }
  }
  if (modelId.startsWith('gemini-')) {
    return { ...DEFAULT_CAPABILITIES, supportsTools: true, toolCallStyle: 'openai' }
  }

  return DEFAULT_CAPABILITIES
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router/capabilities.test.ts`
Expected: PASS (all 6 tests)

**Step 5: Commit**

```bash
git add tests/router/capabilities.test.ts src/services/router/capabilities.ts
git commit -m "feat(router): add model capabilities registry with known models and custom registration"
```

---

## Task 2: Router Configuration Schema

**Files:**
- Create: `src/services/router/routerConfig.ts`
- Test: `tests/router/routerConfig.test.ts`

Defines the Zod schema for the `modelRouter` section of `settings.json`.

**Step 1: Write the failing test**

Create `tests/router/routerConfig.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { RouterConfigSchema, type RouterConfig } from 'src/services/router/routerConfig.js'

describe('RouterConfigSchema', () => {
  it('validates a minimal config', () => {
    const config = {
      enabled: true,
      default: 'claude-opus-4-6',
    }
    const result = RouterConfigSchema().safeParse(config)
    expect(result.success).toBe(true)
  })

  it('validates a full config with providers and routes', () => {
    const config: RouterConfig = {
      enabled: true,
      default: 'claude-opus-4-6',
      providers: {
        ollama: {
          type: 'openai-compatible',
          baseUrl: 'http://localhost:11434/v1',
          models: ['qwen2.5-coder:7b'],
        },
        openai: {
          type: 'openai',
          models: ['gpt-4o'],
        },
      },
      routes: [
        { tasks: ['file_search'], model: 'ollama/qwen2.5-coder:7b' },
        { tasks: ['complex_reasoning'], model: 'claude-opus-4-6' },
      ],
      fallbackChain: ['claude-sonnet-4-6'],
    }
    const result = RouterConfigSchema().safeParse(config)
    expect(result.success).toBe(true)
  })

  it('rejects invalid provider type', () => {
    const config = {
      enabled: true,
      default: 'claude-opus-4-6',
      providers: {
        bad: { type: 'invalid-type', models: [] },
      },
    }
    const result = RouterConfigSchema().safeParse(config)
    expect(result.success).toBe(false)
  })

  it('rejects empty routes tasks array', () => {
    const config = {
      enabled: true,
      default: 'claude-opus-4-6',
      routes: [{ tasks: [], model: 'gpt-4o' }],
    }
    const result = RouterConfigSchema().safeParse(config)
    expect(result.success).toBe(false)
  })

  it('defaults enabled to false when not specified', () => {
    const config = { default: 'claude-opus-4-6' }
    const result = RouterConfigSchema().safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(false)
    }
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/routerConfig.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/services/router/routerConfig.ts`:

```typescript
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'

export const TASK_TYPES = [
  'file_search',
  'glob',
  'grep',
  'simple_edit',
  'file_read',
  'test_execution',
  'subagent',
  'planning',
  'large_context',
  'complex_reasoning',
  'user_override',
] as const

export type TaskType = (typeof TASK_TYPES)[number]

const ProviderConfigSchema = lazySchema(() =>
  z.object({
    type: z.enum(['openai-compatible', 'openai', 'gemini']),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    models: z.array(z.string()),
  }),
)

const RouteSchema = lazySchema(() =>
  z.object({
    tasks: z.array(z.enum(TASK_TYPES)).min(1),
    model: z.string(),
  }),
)

export const RouterConfigSchema = lazySchema(() =>
  z.object({
    enabled: z.boolean().default(false),
    default: z.string(),
    providers: z.record(z.string(), ProviderConfigSchema()).optional(),
    routes: z.array(RouteSchema()).optional(),
    fallbackChain: z.array(z.string()).optional(),
  }),
)

export type RouterConfig = z.infer<ReturnType<typeof RouterConfigSchema>>
export type ProviderConfig = z.infer<ReturnType<typeof ProviderConfigSchema>>
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router/routerConfig.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add tests/router/routerConfig.test.ts src/services/router/routerConfig.ts
git commit -m "feat(router): add Zod schema for modelRouter settings configuration"
```

---

## Task 3: Task Classifier

**Files:**
- Create: `src/services/router/taskClassifier.ts`
- Test: `tests/router/taskClassifier.test.ts`

Classifies the current query context into a task type for routing.

**Step 1: Write the failing test**

Create `tests/router/taskClassifier.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { classifyTask, type TaskContext } from 'src/services/router/taskClassifier.js'

describe('classifyTask', () => {
  it('classifies grep/glob tool calls as file_search', () => {
    const context: TaskContext = {
      activeTools: ['GrepTool', 'GlobTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('file_search')
  })

  it('classifies FileEditTool as simple_edit', () => {
    const context: TaskContext = {
      activeTools: ['FileEditTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('simple_edit')
  })

  it('classifies plan mode as planning', () => {
    const context: TaskContext = {
      activeTools: [],
      messageTokenCount: 5000,
      isPlanMode: true,
      isSubagent: false,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('planning')
  })

  it('classifies large context as large_context', () => {
    const context: TaskContext = {
      activeTools: [],
      messageTokenCount: 150_000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('large_context')
  })

  it('classifies subagent queries', () => {
    const context: TaskContext = {
      activeTools: ['AgentTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: true,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('subagent')
  })

  it('respects user model override', () => {
    const context: TaskContext = {
      activeTools: ['GrepTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: 'gpt-4o',
    }
    expect(classifyTask(context)).toBe('user_override')
  })

  it('defaults to complex_reasoning', () => {
    const context: TaskContext = {
      activeTools: [],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    expect(classifyTask(context)).toBe('complex_reasoning')
  })

  it('classifies BashTool with test patterns as test_execution', () => {
    const context: TaskContext = {
      activeTools: ['BashTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
      bashCommand: 'npx vitest run tests/',
    }
    expect(classifyTask(context)).toBe('test_execution')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/taskClassifier.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/services/router/taskClassifier.ts`:

```typescript
import type { TaskType } from './routerConfig.js'

export interface TaskContext {
  activeTools: string[]
  messageTokenCount: number
  isPlanMode: boolean
  isSubagent: boolean
  userModelOverride: string | undefined
  bashCommand?: string
}

const SEARCH_TOOLS = new Set(['GrepTool', 'GlobTool', 'FileReadTool'])
const EDIT_TOOLS = new Set(['FileEditTool', 'FileWriteTool'])
const AGENT_TOOLS = new Set(['AgentTool', 'TeamCreateTool'])
const LARGE_CONTEXT_THRESHOLD = 100_000

const TEST_COMMAND_PATTERNS = [
  /\bvitest\b/, /\bjest\b/, /\bpytest\b/, /\bmocha\b/,
  /\bnpm\s+test\b/, /\bnpm\s+run\s+test\b/, /\bbun\s+test\b/,
  /\bcargo\s+test\b/, /\bgo\s+test\b/, /\bmake\s+test\b/,
]

export function classifyTask(context: TaskContext): TaskType {
  // Highest priority: user explicitly chose a model
  if (context.userModelOverride) {
    return 'user_override'
  }

  // Subagent mode
  if (context.isSubagent || context.activeTools.some(t => AGENT_TOOLS.has(t))) {
    return 'subagent'
  }

  // Plan mode
  if (context.isPlanMode) {
    return 'planning'
  }

  // Test execution
  if (
    context.activeTools.includes('BashTool') &&
    context.bashCommand &&
    TEST_COMMAND_PATTERNS.some(p => p.test(context.bashCommand!))
  ) {
    return 'test_execution'
  }

  // File search tools
  if (context.activeTools.some(t => SEARCH_TOOLS.has(t))) {
    return 'file_search'
  }

  // Edit tools
  if (context.activeTools.some(t => EDIT_TOOLS.has(t))) {
    return 'simple_edit'
  }

  // Large context (message history exceeds threshold)
  if (context.messageTokenCount > LARGE_CONTEXT_THRESHOLD) {
    return 'large_context'
  }

  return 'complex_reasoning'
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router/taskClassifier.test.ts`
Expected: PASS (all 8 tests)

**Step 5: Commit**

```bash
git add tests/router/taskClassifier.test.ts src/services/router/taskClassifier.ts
git commit -m "feat(router): add heuristic task classifier for routing decisions"
```

---

## Task 4: Stream Translator (OpenAI → Anthropic)

**Files:**
- Create: `src/services/api/adapters/StreamTranslator.ts`
- Test: `tests/adapters/StreamTranslator.test.ts`

Translates OpenAI `ChatCompletionChunk` events into Anthropic `BetaRawMessageStreamEvent` events. This is the critical translation layer that makes the rest of the codebase work unchanged.

**Step 1: Write the failing test**

Create `tests/adapters/StreamTranslator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  translateOpenAIChunkToAnthropicEvents,
  createMessageStartEvent,
  createMessageStopEvent,
  type OpenAIChunk,
} from 'src/services/api/adapters/StreamTranslator.js'

describe('StreamTranslator', () => {
  it('translates text content delta', () => {
    const chunk: OpenAIChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4o',
      choices: [{
        index: 0,
        delta: { content: 'Hello world' },
        finish_reason: null,
      }],
    }
    const events = translateOpenAIChunkToAnthropicEvents(chunk, { blockIndex: 0, isFirstChunk: false })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('content_block_delta')
    expect(events[0].delta.type).toBe('text_delta')
    expect(events[0].delta.text).toBe('Hello world')
  })

  it('emits content_block_start for first text chunk', () => {
    const chunk: OpenAIChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4o',
      choices: [{
        index: 0,
        delta: { content: 'Hi' },
        finish_reason: null,
      }],
    }
    const events = translateOpenAIChunkToAnthropicEvents(chunk, { blockIndex: 0, isFirstChunk: true })
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('content_block_start')
    expect(events[0].content_block.type).toBe('text')
    expect(events[1].type).toBe('content_block_delta')
  })

  it('translates tool call delta', () => {
    const chunk: OpenAIChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4o',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_abc',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"/tmp"}' },
          }],
        },
        finish_reason: null,
      }],
    }
    const events = translateOpenAIChunkToAnthropicEvents(chunk, { blockIndex: 0, isFirstChunk: true })
    // Should emit: content_block_start (tool_use) + content_block_delta (input_json_delta)
    expect(events.length).toBeGreaterThanOrEqual(2)
    const startEvent = events.find(e => e.type === 'content_block_start')
    expect(startEvent?.content_block.type).toBe('tool_use')
    expect(startEvent?.content_block.name).toBe('read_file')
  })

  it('translates finish_reason stop to message_delta', () => {
    const chunk: OpenAIChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4o',
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop',
      }],
    }
    const events = translateOpenAIChunkToAnthropicEvents(chunk, { blockIndex: 0, isFirstChunk: false })
    const messageDelta = events.find(e => e.type === 'message_delta')
    expect(messageDelta).toBeDefined()
    expect(messageDelta?.delta.stop_reason).toBe('end_turn')
  })

  it('translates finish_reason tool_calls to message_delta', () => {
    const chunk: OpenAIChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4o',
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'tool_calls',
      }],
    }
    const events = translateOpenAIChunkToAnthropicEvents(chunk, { blockIndex: 1, isFirstChunk: false })
    const messageDelta = events.find(e => e.type === 'message_delta')
    expect(messageDelta?.delta.stop_reason).toBe('tool_use')
  })

  it('creates synthetic message_start event', () => {
    const event = createMessageStartEvent('gpt-4o', 'msg-123')
    expect(event.type).toBe('message_start')
    expect(event.message.model).toBe('gpt-4o')
    expect(event.message.id).toBe('msg-123')
    expect(event.message.role).toBe('assistant')
  })

  it('creates message_stop event', () => {
    const event = createMessageStopEvent()
    expect(event.type).toBe('message_stop')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/StreamTranslator.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/services/api/adapters/StreamTranslator.ts`:

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/StreamTranslator.test.ts`
Expected: PASS (all 7 tests)

**Step 5: Commit**

```bash
git add tests/adapters/StreamTranslator.test.ts src/services/api/adapters/StreamTranslator.ts
git commit -m "feat(adapter): add OpenAI-to-Anthropic stream event translator"
```

---

## Task 5: OpenAI-Compatible Adapter

**Files:**
- Create: `src/services/api/adapters/OpenAIAdapter.ts`
- Test: `tests/adapters/OpenAIAdapter.test.ts`

The adapter wraps the `openai` SDK and exposes an Anthropic-compatible `.beta.messages.create()` interface. This is the largest and most critical component.

**Step 1: Install openai SDK**

Run: `bun add openai`

Note: Check `package.json` dependencies first — if `openai` is already listed, skip this step.

**Step 2: Write the failing test**

Create `tests/adapters/OpenAIAdapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  translateAnthropicToOpenAI,
  translateSystemPrompt,
  translateTools,
  type AnthropicMessage,
} from 'src/services/api/adapters/OpenAIAdapter.js'

describe('OpenAIAdapter message translation', () => {
  it('translates user text message', () => {
    const msg: AnthropicMessage = {
      role: 'user',
      content: 'Hello world',
    }
    const result = translateAnthropicToOpenAI([msg])
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
    expect(result[0].content).toBe('Hello world')
  })

  it('translates assistant text message', () => {
    const msg: AnthropicMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi there' }],
    }
    const result = translateAnthropicToOpenAI([msg])
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('assistant')
    expect(result[0].content).toBe('Hi there')
  })

  it('translates tool_use block to tool_calls', () => {
    const msg: AnthropicMessage = {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: 'tool_123',
        name: 'read_file',
        input: { path: '/tmp/test.txt' },
      }],
    }
    const result = translateAnthropicToOpenAI([msg])
    expect(result[0].tool_calls).toHaveLength(1)
    expect(result[0].tool_calls[0].function.name).toBe('read_file')
    expect(JSON.parse(result[0].tool_calls[0].function.arguments)).toEqual({ path: '/tmp/test.txt' })
  })

  it('translates tool_result to tool role message', () => {
    const msg: AnthropicMessage = {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'tool_123',
        content: 'file contents here',
      }],
    }
    const result = translateAnthropicToOpenAI([msg])
    expect(result[0].role).toBe('tool')
    expect(result[0].tool_call_id).toBe('tool_123')
  })

  it('strips thinking blocks from messages', () => {
    const msg: AnthropicMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'let me think...' },
        { type: 'text', text: 'The answer is 42' },
      ],
    }
    const result = translateAnthropicToOpenAI([msg])
    expect(result[0].content).toBe('The answer is 42')
    // No thinking content should appear
    expect(JSON.stringify(result[0])).not.toContain('let me think')
  })
})

describe('translateSystemPrompt', () => {
  it('converts Anthropic system blocks to OpenAI system message', () => {
    const system = [
      { type: 'text' as const, text: 'You are a helpful assistant.' },
      { type: 'text' as const, text: 'Be concise.' },
    ]
    const result = translateSystemPrompt(system)
    expect(result.role).toBe('system')
    expect(result.content).toBe('You are a helpful assistant.\n\nBe concise.')
  })
})

describe('translateTools', () => {
  it('converts Anthropic tool schema to OpenAI function format', () => {
    const tools = [{
      name: 'read_file',
      description: 'Read a file',
      input_schema: {
        type: 'object' as const,
        properties: { path: { type: 'string', description: 'File path' } },
        required: ['path'],
      },
    }]
    const result = translateTools(tools)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('function')
    expect(result[0].function.name).toBe('read_file')
    expect(result[0].function.parameters.properties.path.type).toBe('string')
  })
})
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run tests/adapters/OpenAIAdapter.test.ts`
Expected: FAIL — module not found

**Step 4: Write minimal implementation**

Create `src/services/api/adapters/OpenAIAdapter.ts`:

```typescript
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
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/adapters/OpenAIAdapter.test.ts`
Expected: PASS (all 7 tests)

**Step 6: Commit**

```bash
git add tests/adapters/OpenAIAdapter.test.ts src/services/api/adapters/OpenAIAdapter.ts
git commit -m "feat(adapter): add Anthropic-to-OpenAI message format translation"
```

---

## Task 6: OpenAI Streaming Client Wrapper

**Files:**
- Create: `src/services/api/adapters/OpenAIStreamClient.ts`
- Test: `tests/adapters/OpenAIStreamClient.test.ts`

Creates an object that mimics the Anthropic SDK's `Stream<BetaRawMessageStreamEvent>` interface but internally calls the OpenAI Chat Completions API and translates the streaming response.

**Step 1: Write the failing test**

Create `tests/adapters/OpenAIStreamClient.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import {
  createOpenAICompatibleClient,
  type OpenAIClientConfig,
} from 'src/services/api/adapters/OpenAIStreamClient.js'

describe('createOpenAICompatibleClient', () => {
  it('creates a client with the correct config', () => {
    const config: OpenAIClientConfig = {
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'test-key',
      model: 'qwen2.5-coder:7b',
    }
    const client = createOpenAICompatibleClient(config)
    expect(client).toBeDefined()
    expect(client.beta).toBeDefined()
    expect(client.beta.messages).toBeDefined()
    expect(typeof client.beta.messages.create).toBe('function')
  })

  it('creates a client without apiKey (for local models)', () => {
    const config: OpenAIClientConfig = {
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2:8b',
    }
    const client = createOpenAICompatibleClient(config)
    expect(client).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/OpenAIStreamClient.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/services/api/adapters/OpenAIStreamClient.ts`:

```typescript
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
          const system = params.system as Array<{ type: string; text: string }> | undefined
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/OpenAIStreamClient.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add tests/adapters/OpenAIStreamClient.test.ts src/services/api/adapters/OpenAIStreamClient.ts
git commit -m "feat(adapter): add OpenAI streaming client wrapper with Anthropic-compatible interface"
```

---

## Task 7: ModelRouter Core

**Files:**
- Create: `src/services/router/ModelRouter.ts`
- Test: `tests/router/ModelRouter.test.ts`

The central routing engine that ties together task classification, route matching, and fallback handling.

**Step 1: Write the failing test**

Create `tests/router/ModelRouter.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { ModelRouter } from 'src/services/router/ModelRouter.js'
import type { RouterConfig } from 'src/services/router/routerConfig.js'
import type { TaskContext } from 'src/services/router/taskClassifier.js'

const testConfig: RouterConfig = {
  enabled: true,
  default: 'claude-opus-4-6',
  providers: {
    ollama: {
      type: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      models: ['qwen2.5-coder:7b'],
    },
    openai: {
      type: 'openai',
      models: ['gpt-4o'],
    },
  },
  routes: [
    { tasks: ['file_search', 'grep'], model: 'ollama/qwen2.5-coder:7b' },
    { tasks: ['subagent'], model: 'openai/gpt-4o' },
    { tasks: ['complex_reasoning'], model: 'claude-opus-4-6' },
  ],
  fallbackChain: ['claude-sonnet-4-6', 'openai/gpt-4o'],
}

describe('ModelRouter', () => {
  let router: ModelRouter

  beforeEach(() => {
    router = new ModelRouter(testConfig)
  })

  it('routes file_search to ollama', () => {
    const context: TaskContext = {
      activeTools: ['GrepTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    const resolved = router.resolve(context)
    expect(resolved.model).toBe('qwen2.5-coder:7b')
    expect(resolved.providerName).toBe('ollama')
    expect(resolved.providerConfig.type).toBe('openai-compatible')
  })

  it('routes subagent to openai', () => {
    const context: TaskContext = {
      activeTools: ['AgentTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: true,
      userModelOverride: undefined,
    }
    const resolved = router.resolve(context)
    expect(resolved.model).toBe('gpt-4o')
    expect(resolved.providerName).toBe('openai')
  })

  it('routes complex reasoning to default (Claude)', () => {
    const context: TaskContext = {
      activeTools: [],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    const resolved = router.resolve(context)
    expect(resolved.model).toBe('claude-opus-4-6')
    expect(resolved.isNativeAnthropic).toBe(true)
  })

  it('returns fallback chain', () => {
    const context: TaskContext = {
      activeTools: ['GrepTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    const resolved = router.resolve(context)
    expect(resolved.fallbackChain).toEqual(['claude-sonnet-4-6', 'openai/gpt-4o'])
  })

  it('returns native anthropic when router is disabled', () => {
    const disabledRouter = new ModelRouter({ enabled: false, default: 'claude-opus-4-6' })
    const context: TaskContext = {
      activeTools: ['GrepTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    const resolved = disabledRouter.resolve(context)
    expect(resolved.isNativeAnthropic).toBe(true)
    expect(resolved.model).toBe('claude-opus-4-6')
  })

  it('handles user_override task type (no routing)', () => {
    const context: TaskContext = {
      activeTools: [],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: 'gpt-4o',
    }
    const resolved = router.resolve(context)
    // user_override not in routes, so falls back to default
    expect(resolved.model).toBe('claude-opus-4-6')
    expect(resolved.isNativeAnthropic).toBe(true)
  })

  it('parses provider/model format correctly', () => {
    const context: TaskContext = {
      activeTools: ['GrepTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    const resolved = router.resolve(context)
    // 'ollama/qwen2.5-coder:7b' → providerName='ollama', model='qwen2.5-coder:7b'
    expect(resolved.providerName).toBe('ollama')
    expect(resolved.model).toBe('qwen2.5-coder:7b')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/ModelRouter.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/services/router/ModelRouter.ts`:

```typescript
import { classifyTask, type TaskContext } from './taskClassifier.js'
import type { ProviderConfig, RouterConfig, TaskType } from './routerConfig.js'

export interface ResolvedRoute {
  model: string
  providerName: string
  providerConfig: ProviderConfig
  isNativeAnthropic: boolean
  taskType: TaskType
  fallbackChain: string[]
}

const NATIVE_ANTHROPIC_PROVIDER: ProviderConfig = {
  type: 'openai-compatible', // placeholder — won't be used for native
  models: [],
}

function parseModelSpec(spec: string): { providerName: string; model: string } {
  const slashIndex = spec.indexOf('/')
  if (slashIndex === -1) {
    return { providerName: '', model: spec }
  }
  return {
    providerName: spec.slice(0, slashIndex),
    model: spec.slice(slashIndex + 1),
  }
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-')
}

export class ModelRouter {
  private config: RouterConfig
  private routeMap: Map<TaskType, string>

  constructor(config: RouterConfig) {
    this.config = config
    this.routeMap = new Map()

    if (config.routes) {
      for (const route of config.routes) {
        for (const task of route.tasks) {
          this.routeMap.set(task, route.model)
        }
      }
    }
  }

  resolve(context: TaskContext): ResolvedRoute {
    const taskType = classifyTask(context)
    const fallbackChain = this.config.fallbackChain ?? []

    // If router disabled, always use default (native Anthropic)
    if (!this.config.enabled) {
      return {
        model: this.config.default,
        providerName: 'anthropic',
        providerConfig: NATIVE_ANTHROPIC_PROVIDER,
        isNativeAnthropic: true,
        taskType,
        fallbackChain,
      }
    }

    // Look up route for this task type
    const modelSpec = this.routeMap.get(taskType)
    if (!modelSpec) {
      // No route for this task — use default
      return this.resolveDefault(taskType, fallbackChain)
    }

    const { providerName, model } = parseModelSpec(modelSpec)

    // If no provider prefix or it's a Claude model, use native Anthropic
    if (!providerName || isAnthropicModel(model)) {
      return {
        model: model || modelSpec,
        providerName: 'anthropic',
        providerConfig: NATIVE_ANTHROPIC_PROVIDER,
        isNativeAnthropic: true,
        taskType,
        fallbackChain,
      }
    }

    // Look up provider config
    const providerConfig = this.config.providers?.[providerName]
    if (!providerConfig) {
      // Unknown provider — fall back to default
      return this.resolveDefault(taskType, fallbackChain)
    }

    return {
      model,
      providerName,
      providerConfig,
      isNativeAnthropic: false,
      taskType,
      fallbackChain,
    }
  }

  private resolveDefault(
    taskType: TaskType,
    fallbackChain: string[],
  ): ResolvedRoute {
    const defaultModel = this.config.default
    const { providerName, model } = parseModelSpec(defaultModel)

    if (!providerName || isAnthropicModel(model || defaultModel)) {
      return {
        model: model || defaultModel,
        providerName: 'anthropic',
        providerConfig: NATIVE_ANTHROPIC_PROVIDER,
        isNativeAnthropic: true,
        taskType,
        fallbackChain,
      }
    }

    const providerConfig = this.config.providers?.[providerName]
    return {
      model: model || defaultModel,
      providerName,
      providerConfig: providerConfig ?? NATIVE_ANTHROPIC_PROVIDER,
      isNativeAnthropic: false,
      taskType,
      fallbackChain,
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router/ModelRouter.test.ts`
Expected: PASS (all 7 tests)

**Step 5: Commit**

```bash
git add tests/router/ModelRouter.test.ts src/services/router/ModelRouter.ts
git commit -m "feat(router): add ModelRouter with task-based routing and fallback chains"
```

---

## Task 8: Wire Router into Provider Factory

**Files:**
- Modify: `src/utils/model/providers.ts` (line 4)
- Modify: `src/services/api/client.ts` (lines 153-316)
- Test: `tests/router/integration.test.ts`

This is where we connect the new system to the existing codebase.

**Step 1: Write the failing integration test**

Create `tests/router/integration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock environment to avoid real API calls
vi.stubEnv('CLAUDE_CODE_USE_BEDROCK', '')
vi.stubEnv('CLAUDE_CODE_USE_VERTEX', '')
vi.stubEnv('CLAUDE_CODE_USE_FOUNDRY', '')

describe('Provider integration', () => {
  it('getAPIProvider returns openai-compatible when configured', async () => {
    const { getAPIProvider } = await import('src/utils/model/providers.js')
    // Default should still be firstParty
    expect(getAPIProvider()).toBe('firstParty')
  })

  it('parseExternalModelSpec splits provider/model correctly', async () => {
    const { parseExternalModelSpec } = await import('src/utils/model/providers.js')
    expect(parseExternalModelSpec('ollama/qwen2.5-coder:7b')).toEqual({
      provider: 'ollama',
      model: 'qwen2.5-coder:7b',
    })
    expect(parseExternalModelSpec('claude-opus-4-6')).toEqual({
      provider: null,
      model: 'claude-opus-4-6',
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/integration.test.ts`
Expected: FAIL — `parseExternalModelSpec` not found

**Step 3: Modify providers.ts**

Add to `src/utils/model/providers.ts` (after line 14):

```typescript
export type ExternalAPIProvider = 'openai-compatible' | 'openai' | 'gemini'

export function parseExternalModelSpec(modelSpec: string): {
  provider: string | null
  model: string
} {
  const slashIndex = modelSpec.indexOf('/')
  if (slashIndex === -1) {
    return { provider: null, model: modelSpec }
  }
  return {
    provider: modelSpec.slice(0, slashIndex),
    model: modelSpec.slice(slashIndex + 1),
  }
}
```

**Step 4: Modify client.ts — add adapter branch**

In `src/services/api/client.ts`, add a new branch **before** the existing `if (isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK))` block (after line 152). The branch checks if the ModelRouter resolved to a non-Anthropic provider:

```typescript
// --- NEW: Check if ModelRouter resolves to an external provider ---
// This is called by the withRetry wrapper which passes the model.
// If the model is in "provider/model" format, use the appropriate adapter.
if (model && model.includes('/')) {
  const { createOpenAICompatibleClient } = await import('./adapters/OpenAIStreamClient.js')
  const { parseExternalModelSpec } = await import('../../utils/model/providers.js')
  const { provider, model: resolvedModel } = parseExternalModelSpec(model)
  
  if (provider) {
    // Read provider config from settings
    const settings = (await import('../../utils/settings/settings.js')).getSettings_DEPRECATED()
    const routerConfig = settings?.modelRouter
    const providerConfig = routerConfig?.providers?.[provider]
    
    if (providerConfig) {
      const client = createOpenAICompatibleClient({
        baseUrl: providerConfig.baseUrl ?? `https://api.openai.com/v1`,
        apiKey: providerConfig.apiKey ?? process.env[`${provider.toUpperCase()}_API_KEY`],
        model: resolvedModel,
        defaultHeaders: { ...defaultHeaders },
      })
      return client as unknown as Anthropic
    }
  }
}
// --- END NEW ---
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/router/integration.test.ts`
Expected: PASS (2 tests)

**Step 6: Run existing tests to verify no regressions**

Run: `npx vitest run tests/`
Expected: All existing tests PASS

**Step 7: Commit**

```bash
git add src/utils/model/providers.ts src/services/api/client.ts tests/router/integration.test.ts
git commit -m "feat(router): wire ModelRouter into provider factory with external model support"
```

---

## Task 9: Settings Schema Integration

**Files:**
- Modify: `src/utils/settings/types.ts` (around line 255, inside SettingsSchema)
- Test: `tests/router/settings.test.ts`

Add `modelRouter` to the settings schema so it's validated when reading `~/.claude/settings.json`.

**Step 1: Write the failing test**

Create `tests/router/settings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { SettingsSchema } from 'src/utils/settings/types.js'

describe('Settings modelRouter integration', () => {
  it('accepts modelRouter in settings', () => {
    const settings = {
      modelRouter: {
        enabled: true,
        default: 'claude-opus-4-6',
        providers: {
          ollama: {
            type: 'openai-compatible',
            baseUrl: 'http://localhost:11434/v1',
            models: ['qwen2.5-coder:7b'],
          },
        },
        routes: [
          { tasks: ['file_search'], model: 'ollama/qwen2.5-coder:7b' },
        ],
      },
    }
    const result = SettingsSchema().safeParse(settings)
    expect(result.success).toBe(true)
  })

  it('accepts settings without modelRouter (backward compatible)', () => {
    const settings = {
      model: 'claude-opus-4-6',
    }
    const result = SettingsSchema().safeParse(settings)
    expect(result.success).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/settings.test.ts`
Expected: FAIL — `modelRouter` key is stripped by `.passthrough()` or causes validation error

**Step 3: Add modelRouter to SettingsSchema**

In `src/utils/settings/types.ts`, find the `SettingsSchema` object (line ~255) and add inside the `z.object({...})`:

```typescript
modelRouter: RouterConfigSchema().optional().describe(
  'Multi-model router configuration for task-based routing to different providers',
),
```

Also add the import at the top of the file:

```typescript
import { RouterConfigSchema } from '../../services/router/routerConfig.js'
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router/settings.test.ts`
Expected: PASS (2 tests)

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/utils/settings/types.ts tests/router/settings.test.ts
git commit -m "feat(router): add modelRouter to settings schema for user configuration"
```

---

## Task 10: Gemini Adapter

**Files:**
- Create: `src/services/api/adapters/GeminiAdapter.ts`
- Test: `tests/adapters/GeminiAdapter.test.ts`

Gemini uses a different API format from both Anthropic and OpenAI. However, since Gemini also supports an OpenAI-compatible endpoint (`/v1beta/openai/`), we can reuse the OpenAI adapter for Gemini by pointing to Google's OpenAI-compatible endpoint.

**Step 1: Write the failing test**

Create `tests/adapters/GeminiAdapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getGeminiOpenAIBaseUrl } from 'src/services/api/adapters/GeminiAdapter.js'

describe('GeminiAdapter', () => {
  it('returns the correct OpenAI-compatible base URL for Gemini', () => {
    const url = getGeminiOpenAIBaseUrl()
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
  })

  it('uses GEMINI_API_KEY env var for auth', () => {
    // This is a config test — the actual auth is handled by OpenAIStreamClient
    const url = getGeminiOpenAIBaseUrl()
    expect(url).toContain('googleapis.com')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/GeminiAdapter.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/services/api/adapters/GeminiAdapter.ts`:

```typescript
/**
 * Gemini Adapter — uses Google's OpenAI-compatible endpoint.
 *
 * Google provides an OpenAI-compatible API at:
 * https://generativelanguage.googleapis.com/v1beta/openai/
 *
 * This means we can reuse the OpenAI adapter (OpenAIStreamClient) for Gemini
 * by pointing it to this base URL with GEMINI_API_KEY.
 *
 * See: https://ai.google.dev/gemini-api/docs/openai
 */

const GEMINI_OPENAI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai'

export function getGeminiOpenAIBaseUrl(): string {
  return process.env.GEMINI_BASE_URL ?? GEMINI_OPENAI_BASE_URL
}

export function getGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/GeminiAdapter.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add tests/adapters/GeminiAdapter.test.ts src/services/api/adapters/GeminiAdapter.ts
git commit -m "feat(adapter): add Gemini adapter using Google's OpenAI-compatible endpoint"
```

---

## Task 11: End-to-End Integration Test

**Files:**
- Create: `tests/router/e2e.test.ts`

Full pipeline test: router resolves → adapter creates client → stream translates.

**Step 1: Write the test**

Create `tests/router/e2e.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { ModelRouter } from 'src/services/router/ModelRouter.js'
import { classifyTask, type TaskContext } from 'src/services/router/taskClassifier.js'
import { getModelCapabilities } from 'src/services/router/capabilities.js'
import type { RouterConfig } from 'src/services/router/routerConfig.js'

const fullConfig: RouterConfig = {
  enabled: true,
  default: 'claude-opus-4-6',
  providers: {
    ollama: {
      type: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      models: ['qwen2.5-coder:7b', 'llama3.2:8b'],
    },
    openai: {
      type: 'openai',
      models: ['gpt-4o'],
    },
    gemini: {
      type: 'gemini',
      models: ['gemini-2.5-pro'],
    },
  },
  routes: [
    { tasks: ['file_search', 'grep', 'glob'], model: 'ollama/qwen2.5-coder:7b' },
    { tasks: ['simple_edit'], model: 'ollama/llama3.2:8b' },
    { tasks: ['large_context'], model: 'gemini/gemini-2.5-pro' },
    { tasks: ['subagent'], model: 'openai/gpt-4o' },
    { tasks: ['complex_reasoning', 'planning'], model: 'claude-opus-4-6' },
  ],
  fallbackChain: ['claude-sonnet-4-6', 'openai/gpt-4o', 'ollama/llama3.2:8b'],
}

describe('Multi-Model Router E2E', () => {
  const router = new ModelRouter(fullConfig)

  it('routes grep to local Ollama model with correct capabilities', () => {
    const context: TaskContext = {
      activeTools: ['GrepTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    const resolved = router.resolve(context)
    expect(resolved.model).toBe('qwen2.5-coder:7b')
    expect(resolved.providerConfig.type).toBe('openai-compatible')
    expect(resolved.isNativeAnthropic).toBe(false)

    const caps = getModelCapabilities('qwen2.5-coder:7b')
    expect(caps.supportsThinking).toBe(false)
    expect(caps.supportsCaching).toBe(false)
  })

  it('routes large context to Gemini', () => {
    const context: TaskContext = {
      activeTools: [],
      messageTokenCount: 200_000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    const resolved = router.resolve(context)
    expect(resolved.model).toBe('gemini-2.5-pro')
    expect(resolved.providerConfig.type).toBe('gemini')

    const caps = getModelCapabilities('gemini-2.5-pro')
    expect(caps.maxInputTokens).toBe(2_000_000)
  })

  it('routes planning to Claude (native)', () => {
    const context: TaskContext = {
      activeTools: [],
      messageTokenCount: 5000,
      isPlanMode: true,
      isSubagent: false,
      userModelOverride: undefined,
    }
    const resolved = router.resolve(context)
    expect(resolved.model).toBe('claude-opus-4-6')
    expect(resolved.isNativeAnthropic).toBe(true)

    const caps = getModelCapabilities('claude-opus-4-6')
    expect(caps.supportsThinking).toBe(true)
    expect(caps.supportsEffort).toBe(true)
  })

  it('provides correct fallback chain for recovery', () => {
    const context: TaskContext = {
      activeTools: ['GrepTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    const resolved = router.resolve(context)
    expect(resolved.fallbackChain).toEqual([
      'claude-sonnet-4-6',
      'openai/gpt-4o',
      'ollama/llama3.2:8b',
    ])
  })

  it('full routing table covers all task types', () => {
    const allContexts: [string, TaskContext][] = [
      ['file_search', { activeTools: ['GrepTool'], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined }],
      ['simple_edit', { activeTools: ['FileEditTool'], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined }],
      ['planning', { activeTools: [], messageTokenCount: 5000, isPlanMode: true, isSubagent: false, userModelOverride: undefined }],
      ['subagent', { activeTools: ['AgentTool'], messageTokenCount: 5000, isPlanMode: false, isSubagent: true, userModelOverride: undefined }],
      ['large_context', { activeTools: [], messageTokenCount: 200_000, isPlanMode: false, isSubagent: false, userModelOverride: undefined }],
      ['complex_reasoning', { activeTools: [], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined }],
    ]

    for (const [expectedTask, context] of allContexts) {
      const resolved = router.resolve(context)
      expect(resolved.taskType).toBe(expectedTask)
      expect(resolved.model).toBeTruthy()
    }
  })
})
```

**Step 2: Run the test**

Run: `npx vitest run tests/router/e2e.test.ts`
Expected: PASS (all 5 tests)

**Step 3: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add tests/router/e2e.test.ts
git commit -m "test(router): add end-to-end integration tests for multi-model routing"
```

---

## Task 12: Documentation Update

**Files:**
- Modify: `docs/architecture.md` — add Multi-Model Router section
- Create: `docs/multi-model-setup.md` — user-facing setup guide

**Step 1: Add section to architecture.md**

Append to `docs/architecture.md`:

```markdown
## Multi-Model Router

Claude Code supports routing queries to multiple model providers based on task type.

### Architecture

The ModelRouter sits between the query engine and the API client:

```
QueryEngine → ModelRouter → Provider Factory → API Client
                                ├── Anthropic SDK (native)
                                ├── OpenAI-Compatible Adapter (Ollama, OpenAI, OpenRouter)
                                └── Gemini Adapter (Google AI)
```

### Key Files

- `src/services/router/ModelRouter.ts` — Task classification and route matching
- `src/services/router/taskClassifier.ts` — Heuristic task type detection
- `src/services/router/capabilities.ts` — Model feature matrix
- `src/services/router/routerConfig.ts` — Configuration schema
- `src/services/api/adapters/` — Format translators (OpenAI, Gemini)

### Configuration

Add `modelRouter` to `~/.claude/settings.json`. See `docs/multi-model-setup.md` for details.
```

**Step 2: Create setup guide**

Create `docs/multi-model-setup.md` with:
- Quick start (Ollama local setup)
- Full configuration reference
- Provider-specific setup (OpenAI, Gemini, OpenRouter, mlx-tq)
- Task type reference
- Troubleshooting

**Step 3: Commit**

```bash
git add docs/architecture.md docs/multi-model-setup.md
git commit -m "docs: add multi-model router architecture and setup guide"
```

---

## Summary

| Task | Component | Tests | Lines |
|------|-----------|-------|-------|
| 1 | Capabilities Registry | 6 | ~200 |
| 2 | Router Config Schema | 5 | ~80 |
| 3 | Task Classifier | 8 | ~100 |
| 4 | Stream Translator | 7 | ~180 |
| 5 | OpenAI Adapter | 7 | ~200 |
| 6 | OpenAI Stream Client | 2 | ~200 |
| 7 | ModelRouter Core | 7 | ~150 |
| 8 | Wire into Provider Factory | 2 | ~30 (modification) |
| 9 | Settings Schema | 2 | ~10 (modification) |
| 10 | Gemini Adapter | 2 | ~30 |
| 11 | E2E Integration Tests | 5 | ~100 |
| 12 | Documentation | — | ~300 |
| **Total** | **12 tasks** | **53 tests** | **~1,580 new lines** |

**Execution order is strict** — each task depends on the previous ones.
