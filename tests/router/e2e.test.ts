import { describe, it, expect } from 'vitest'
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
