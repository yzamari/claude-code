import { describe, it, expect } from 'vitest'
import {
  translateAnthropicToOpenAI,
  translateSystemPrompt,
  translateTools,
  type AnthropicMessage,
} from 'src/services/api/adapters/OpenAIAdapter.js'

describe('OpenAIAdapter message translation', () => {
  it('translates user text message', () => {
    const msg: AnthropicMessage = {
      role: 'user',
      content: 'Hello world',
    }
    const result = translateAnthropicToOpenAI([msg])
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
    expect(result[0].content).toBe('Hello world')
  })

  it('translates assistant text message', () => {
    const msg: AnthropicMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi there' }],
    }
    const result = translateAnthropicToOpenAI([msg])
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('assistant')
    expect(result[0].content).toBe('Hi there')
  })

  it('translates tool_use block to tool_calls', () => {
    const msg: AnthropicMessage = {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: 'tool_123',
        name: 'read_file',
        input: { path: '/tmp/test.txt' },
      }],
    }
    const result = translateAnthropicToOpenAI([msg])
    expect(result[0].tool_calls).toHaveLength(1)
    expect(result[0].tool_calls[0].function.name).toBe('read_file')
    expect(JSON.parse(result[0].tool_calls[0].function.arguments)).toEqual({ path: '/tmp/test.txt' })
  })

  it('translates tool_result to tool role message', () => {
    const msg: AnthropicMessage = {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'tool_123',
        content: 'file contents here',
      }],
    }
    const result = translateAnthropicToOpenAI([msg])
    expect(result[0].role).toBe('tool')
    expect(result[0].tool_call_id).toBe('tool_123')
  })

  it('strips thinking blocks from messages', () => {
    const msg: AnthropicMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'let me think...' },
        { type: 'text', text: 'The answer is 42' },
      ],
    }
    const result = translateAnthropicToOpenAI([msg])
    expect(result[0].content).toBe('The answer is 42')
    // No thinking content should appear
    expect(JSON.stringify(result[0])).not.toContain('let me think')
  })
})

describe('translateSystemPrompt', () => {
  it('converts Anthropic system blocks to OpenAI system message', () => {
    const system = [
      { type: 'text' as const, text: 'You are a helpful assistant.' },
      { type: 'text' as const, text: 'Be concise.' },
    ]
    const result = translateSystemPrompt(system)
    expect(result.role).toBe('system')
    expect(result.content).toBe('You are a helpful assistant.\n\nBe concise.')
  })
})

describe('translateTools', () => {
  it('converts Anthropic tool schema to OpenAI function format', () => {
    const tools = [{
      name: 'read_file',
      description: 'Read a file',
      input_schema: {
        type: 'object' as const,
        properties: { path: { type: 'string', description: 'File path' } },
        required: ['path'],
      },
    }]
    const result = translateTools(tools)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('function')
    expect(result[0].function.name).toBe('read_file')
    expect(result[0].function.parameters.properties.path.type).toBe('string')
  })
})
