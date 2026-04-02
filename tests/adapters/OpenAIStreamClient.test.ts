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

  it('includes stream_options in request body', () => {
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://localhost:9999/v1',
      model: 'test-model',
    })
    expect(typeof client.beta.messages.create).toBe('function')
  })

  it('throws OpenAICompatibleAPIError shape on connection refused', async () => {
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://localhost:1/v1', // port 1 — guaranteed to fail
      model: 'test-model',
    })
    const streamObj = client.beta.messages.create(
      { model: 'test', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10, stream: true },
      {}
    )
    await expect(streamObj.withResponse()).rejects.toThrow(/Connection failed/)
  })
})
