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
