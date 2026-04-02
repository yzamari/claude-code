import { describe, it, expect, vi } from 'vitest'
import {
  createOpenAICompatibleClient,
  type OpenAIClientConfig,
} from 'src/services/api/adapters/OpenAIStreamClient.js'

describe('createOpenAICompatibleClient', () => {
  it('creates a client with the correct config', () => {
    const config: OpenAIClientConfig = {
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'test-key',
      model: 'qwen2.5-coder:7b',
    }
    const client = createOpenAICompatibleClient(config)
    expect(client).toBeDefined()
    expect(client.beta).toBeDefined()
    expect(client.beta.messages).toBeDefined()
    expect(typeof client.beta.messages.create).toBe('function')
  })

  it('creates a client without apiKey (for local models)', () => {
    const config: OpenAIClientConfig = {
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2:8b',
    }
    const client = createOpenAICompatibleClient(config)
    expect(client).toBeDefined()
  })
})
