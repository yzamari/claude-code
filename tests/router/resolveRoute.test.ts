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
    expect(r1.model).toBe(r2.model)
  })

  it('returns null model when no routes match and default is Claude', () => {
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
    expect(r.model).toBeNull() // file_search not in routes, default is Claude = native = null
  })

  it('returns explicit Claude model when router routes to it and default is non-Claude', () => {
    // This tests the fix for the bug where routing to claude-opus-4-6 returned null,
    // causing the caller to fall back to ANTHROPIC_MODEL (e.g. gemini) instead.
    const config = {
      enabled: true,
      default: 'gemini/gemini-3.1-pro-preview',
      routes: [{ tasks: ['complex_reasoning' as const], model: 'claude-opus-4-6' }],
      providers: {
        gemini: { type: 'openai-compatible' as const, baseUrl: 'https://example.com', models: ['gemini-3.1-pro-preview'] },
      },
    }
    const r = resolveModelForQuery(config, {
      lastToolNames: [],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    })
    // Router should return the explicit Claude model, NOT null
    expect(r.model).toBe('claude-opus-4-6')
  })

  it('returns null model when router falls to default Claude model', () => {
    const config = {
      enabled: true,
      default: 'claude-opus-4-6',
      routes: [{ tasks: ['planning' as const], model: 'gemini/gemini-3.1-pro-preview' }],
      providers: {
        gemini: { type: 'openai-compatible' as const, baseUrl: 'https://example.com', models: ['gemini-3.1-pro-preview'] },
      },
    }
    const r = resolveModelForQuery(config, {
      lastToolNames: [],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    })
    // complex_reasoning has no route, falls to default (claude-opus-4-6) = native = null
    expect(r.model).toBeNull()
  })

  it('returns provider/model for external provider routes', () => {
    const config = {
      enabled: true,
      default: 'claude-opus-4-6',
      routes: [{ tasks: ['file_search' as const], model: 'ollama/qwen' }],
      providers: { ollama: { type: 'openai-compatible' as const, models: ['qwen'] } },
    }
    const r = resolveModelForQuery(config, {
      lastToolNames: ['GrepTool'],
      messageTokenCount: 5000,
      isPlanMode: false,
      isSubagent: false,
      userModelOverride: undefined,
    })
    expect(r.model).toBe('ollama/qwen')
  })
})
