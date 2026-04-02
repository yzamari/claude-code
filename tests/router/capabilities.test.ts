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
