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

  it('accepts deprecated task types and maps them to file_search', () => {
    const config = {
      enabled: true,
      default: 'claude-opus-4-6',
      routes: [
        { tasks: ['grep', 'glob', 'file_read'], model: 'ollama/qwen:7b' },
      ],
    }
    const result = RouterConfigSchema().safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      // All deprecated types should be transformed to file_search
      expect(result.data.routes![0].tasks).toEqual([
        'file_search', 'file_search', 'file_search',
      ])
    }
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
