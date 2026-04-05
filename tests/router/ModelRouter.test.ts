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

  it('handles user_override by honouring the user-chosen model', () => {
    const context: TaskContext = {
      activeTools: [],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: 'openai/gpt-4o',
    }
    const resolved = router.resolve(context)
    // user_override should use the user's chosen model, not the default
    expect(resolved.model).toBe('gpt-4o')
    expect(resolved.providerName).toBe('openai')
    expect(resolved.isNativeAnthropic).toBe(false)
  })

  it('handles user_override with anthropic model', () => {
    const context: TaskContext = {
      activeTools: [],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: 'claude-sonnet-4-6',
    }
    const resolved = router.resolve(context)
    expect(resolved.model).toBe('claude-sonnet-4-6')
    expect(resolved.isNativeAnthropic).toBe(true)
  })

  it('handles user_override with provider/model format', () => {
    const context: TaskContext = {
      activeTools: [],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: 'ollama/gemma4-heretic',
    }
    const resolved = router.resolve(context)
    expect(resolved.model).toBe('gemma4-heretic')
    expect(resolved.providerName).toBe('ollama')
    expect(resolved.isNativeAnthropic).toBe(false)
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
