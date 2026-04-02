import { describe, it, expect } from 'vitest'
import { resolveModelForQuery } from 'src/services/router/resolveRouteForQuery.js'

describe('resolveModelForQuery edge cases', () => {
  it('caches router instance for same config', () => {
    const config = {
      enabled: true,
      default: 'claude-opus-4-6',
      routes: [{ tasks: ['file_search' as const], model: 'ollama/qwen' }],
      providers: { ollama: { type: 'openai-compatible' as const, models: ['qwen'] } },
    }
    const ctx = {
      lastToolNames: ['GrepTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    }
    const r1 = resolveModelForQuery(config, ctx)
    const r2 = resolveModelForQuery(config, ctx)
    expect(r1).toBe(r2) // Same result
  })

  it('returns null when no routes match', () => {
    const config = {
      enabled: true,
      default: 'claude-opus-4-6',
      routes: [{ tasks: ['planning' as const], model: 'ollama/qwen' }],
      providers: { ollama: { type: 'openai-compatible' as const, models: ['qwen'] } },
    }
    const r = resolveModelForQuery(config, {
      lastToolNames: ['GrepTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    })
    expect(r).toBeNull() // file_search not in routes, default is Claude = native = null
  })
})
