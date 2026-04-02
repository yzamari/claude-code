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
    { tasks: ['file_search', 'grep'], model: 'ollama/qwen2.5-coder:7b' },
    { tasks: ['large_context'], model: 'gemini/gemini-2.5-pro' },
    { tasks: ['complex_reasoning'], model: 'claude-opus-4-6' },
  ],
}

describe('resolveModelForQuery', () => {
  it('returns null when router disabled', () => {
    expect(resolveModelForQuery({ enabled: false, default: 'claude-opus-4-6' }, {
      lastToolNames: ['GrepTool'], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined,
    })).toBeNull()
  })

  it('returns null when config is undefined', () => {
    expect(resolveModelForQuery(undefined, {
      lastToolNames: [], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined,
    })).toBeNull()
  })

  it('routes grep to Ollama', () => {
    const result = resolveModelForQuery(testConfig, {
      lastToolNames: ['GrepTool'], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined,
    })
    expect(result).toBe('ollama/qwen2.5-coder:7b')
  })

  it('routes large context to Gemini', () => {
    const result = resolveModelForQuery(testConfig, {
      lastToolNames: [], messageTokenCount: 200000, isPlanMode: false, isSubagent: false, userModelOverride: undefined,
    })
    expect(result).toBe('gemini/gemini-2.5-pro')
  })

  it('returns null for native Claude routes', () => {
    const result = resolveModelForQuery(testConfig, {
      lastToolNames: [], messageTokenCount: 5000, isPlanMode: false, isSubagent: false, userModelOverride: undefined,
    })
    expect(result).toBeNull()
  })
})
