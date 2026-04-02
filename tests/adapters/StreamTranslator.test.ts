import { describe, it, expect } from 'vitest'
import {
  translateOpenAIChunkToAnthropicEvents,
  createMessageStartEvent,
  createMessageStopEvent,
  type OpenAIChunk,
} from 'src/services/api/adapters/StreamTranslator.js'

describe('StreamTranslator', () => {
  it('translates text content delta', () => {
    const chunk: OpenAIChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4o',
      choices: [{
        index: 0,
        delta: { content: 'Hello world' },
        finish_reason: null,
      }],
    }
    const events = translateOpenAIChunkToAnthropicEvents(chunk, { blockIndex: 0, isFirstChunk: false })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('content_block_delta')
    expect(events[0].delta.type).toBe('text_delta')
    expect(events[0].delta.text).toBe('Hello world')
  })

  it('emits content_block_start for first text chunk', () => {
    const chunk: OpenAIChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4o',
      choices: [{
        index: 0,
        delta: { content: 'Hi' },
        finish_reason: null,
      }],
    }
    const events = translateOpenAIChunkToAnthropicEvents(chunk, { blockIndex: 0, isFirstChunk: true })
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('content_block_start')
    expect(events[0].content_block.type).toBe('text')
    expect(events[1].type).toBe('content_block_delta')
  })

  it('translates tool call delta', () => {
    const chunk: OpenAIChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4o',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_abc',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"/tmp"}' },
          }],
        },
        finish_reason: null,
      }],
    }
    const events = translateOpenAIChunkToAnthropicEvents(chunk, { blockIndex: 0, isFirstChunk: true })
    // Should emit: content_block_start (tool_use) + content_block_delta (input_json_delta)
    expect(events.length).toBeGreaterThanOrEqual(2)
    const startEvent = events.find(e => e.type === 'content_block_start')
    expect(startEvent?.content_block.type).toBe('tool_use')
    expect(startEvent?.content_block.name).toBe('read_file')
  })

  it('translates finish_reason stop to message_delta', () => {
    const chunk: OpenAIChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4o',
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop',
      }],
    }
    const events = translateOpenAIChunkToAnthropicEvents(chunk, { blockIndex: 0, isFirstChunk: false })
    const messageDelta = events.find(e => e.type === 'message_delta')
    expect(messageDelta).toBeDefined()
    expect(messageDelta?.delta.stop_reason).toBe('end_turn')
  })

  it('translates finish_reason tool_calls to message_delta', () => {
    const chunk: OpenAIChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4o',
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'tool_calls',
      }],
    }
    const events = translateOpenAIChunkToAnthropicEvents(chunk, { blockIndex: 1, isFirstChunk: false })
    const messageDelta = events.find(e => e.type === 'message_delta')
    expect(messageDelta?.delta.stop_reason).toBe('tool_use')
  })

  it('creates synthetic message_start event', () => {
    const event = createMessageStartEvent('gpt-4o', 'msg-123')
    expect(event.type).toBe('message_start')
    expect(event.message.model).toBe('gpt-4o')
    expect(event.message.id).toBe('msg-123')
    expect(event.message.role).toBe('assistant')
  })

  it('creates message_stop event', () => {
    const event = createMessageStopEvent()
    expect(event.type).toBe('message_stop')
  })
})
