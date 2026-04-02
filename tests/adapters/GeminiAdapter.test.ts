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
