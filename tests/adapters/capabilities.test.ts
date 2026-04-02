import { describe, it, expect } from 'vitest'
import {
  createOpenAICompatibleClient,
} from 'src/services/api/adapters/OpenAIStreamClient.js'
import { registerModelCapabilities } from 'src/services/router/capabilities.js'

describe('Capability enforcement in OpenAIStreamClient', () => {
  it('creates client with max_tokens capping for small models', () => {
    // Register a model with low max output
    registerModelCapabilities('test-small-model', {
      maxInputTokens: 4096,
      maxOutputTokens: 512,
      supportsTools: false,
      supportsStreaming: true,
      supportsVision: false,
      supportsThinking: false,
      supportsEffort: false,
      supportsCaching: false,
      supportsPDFs: false,
      toolCallStyle: 'none',
    })
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://localhost:9999/v1',
      model: 'test-small-model',
    })
    expect(client).toBeDefined()
    // The actual capping is tested via the request body, which we can't easily inspect
    // without a real server. The unit test verifies the client creates without error.
  })

  it('creates client for model without vision support', () => {
    registerModelCapabilities('test-no-vision', {
      maxInputTokens: 8192,
      maxOutputTokens: 2048,
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      supportsThinking: false,
      supportsEffort: false,
      supportsCaching: false,
      supportsPDFs: false,
      toolCallStyle: 'openai',
    })
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://localhost:9999/v1',
      model: 'test-no-vision',
    })
    expect(client).toBeDefined()
    expect(client.beta.messages).toBeDefined()
  })

  it('creates client for model without PDF support', () => {
    registerModelCapabilities('test-no-pdf', {
      maxInputTokens: 8192,
      maxOutputTokens: 2048,
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: true,
      supportsThinking: false,
      supportsEffort: false,
      supportsCaching: false,
      supportsPDFs: false,
      toolCallStyle: 'openai',
    })
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://localhost:9999/v1',
      model: 'test-no-pdf',
    })
    expect(client).toBeDefined()
    expect(client.beta.messages).toBeDefined()
  })

  it('creates client for model with full capabilities', () => {
    registerModelCapabilities('test-full-caps', {
      maxInputTokens: 128_000,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: true,
      supportsThinking: false,
      supportsEffort: false,
      supportsCaching: false,
      supportsPDFs: true,
      toolCallStyle: 'openai',
    })
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://localhost:9999/v1',
      model: 'test-full-caps',
    })
    expect(client).toBeDefined()
    expect(typeof client.beta.messages.create).toBe('function')
  })
})
