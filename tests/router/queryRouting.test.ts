import { describe, it, expect } from 'vitest'
import { resolveModelForQuery } from 'src/services/router/resolveRouteForQuery.js'
import type { RouterConfig } from 'src/services/router/routerConfig.js'

const testConfig: RouterConfig = {
  enabled: true,
  default: 'claude-opus-4-6',
  providers: {
    ollama: { type: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', models: ['qwen2.5-coder:7b'] },
    gemini: { type: 'gemini', models: ['gemini-2.5-pro'] },
  },
  routes: [
    { tasks: ['file_search'], model: 'ollama/qwen2.5-coder:7b' },
    { tasks: ['large_context'], model: 'gemini/gemini-2.5-pro' },
    { tasks: ['complex_reasoning'], model: 'claude-opus-4-6' },
  ],
}

describe('resolveModelForQuery', () => {
  it('returns null model when router disabled', () => {
    const result = resolveModelForQuery({ enabled: false, default: 'claude-opus-4-6' }, {
      lastToolNames: ['Grep'], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined,
    })
    expect(result.model).toBeNull()
    expect(result.fallbackChain).toEqual([])
  })

  it('returns null model when config is undefined', () => {
    const result = resolveModelForQuery(undefined, {
      lastToolNames: [], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined,
    })
    expect(result.model).toBeNull()
  })

  it('routes grep to Ollama', () => {
    const result = resolveModelForQuery(testConfig, {
      lastToolNames: ['Grep'], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined,
    })
    expect(result.model).toBe('ollama/qwen2.5-coder:7b')
  })

  it('routes large context to Gemini', () => {
    const result = resolveModelForQuery(testConfig, {
      lastToolNames: [], messageTokenCount: 200000, isPlanMode: false, isSubagent: false, userModelOverride: undefined,
    })
    expect(result.model).toBe('gemini/gemini-2.5-pro')
  })

  it('returns null model for native Claude routes', () => {
    const result = resolveModelForQuery(testConfig, {
      lastToolNames: [], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined,
    })
    expect(result.model).toBeNull()
  })

  it('includes fallbackChain from config', () => {
    const configWithFallback: RouterConfig = {
      ...testConfig,
      fallbackChain: ['claude-sonnet-4-6', 'gemini/gemini-2.5-pro'],
    }
    const result = resolveModelForQuery(configWithFallback, {
      lastToolNames: ['Grep'], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined,
    })
    expect(result.model).toBe('ollama/qwen2.5-coder:7b')
    expect(result.fallbackChain).toEqual(['claude-sonnet-4-6', 'gemini/gemini-2.5-pro'])
  })
})
