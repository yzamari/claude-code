import { describe, it, expect } from 'vitest'
import {
  injectToolsIntoSystemPrompt,
  parseToolCallsFromText,
} from 'src/services/api/adapters/toolPromptInjection.js'

describe('injectToolsIntoSystemPrompt', () => {
  it('appends tool descriptions to system message', () => {
    const system = { role: 'system', content: 'You are helpful.' }
    const tools = [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file from disk',
          parameters: { type: 'object' },
        },
      },
    ]
    const result = injectToolsIntoSystemPrompt(system, tools)
    expect(result.content).toContain('You are helpful.')
    expect(result.content).toContain('read_file')
    expect(result.content).toContain('tool_call')
  })

  it('handles empty system content', () => {
    const system = { role: 'system', content: null }
    const tools = [
      {
        type: 'function',
        function: {
          name: 'bash',
          description: 'Run a command',
          parameters: {},
        },
      },
    ]
    const result = injectToolsIntoSystemPrompt(
      system,
      tools as Parameters<typeof injectToolsIntoSystemPrompt>[1],
    )
    expect(result.content).toContain('bash')
  })

  it('includes all tools with parameter info', () => {
    const tools = Array.from({ length: 40 }, (_, i) => ({
      type: 'function',
      function: {
        name: `tool_${i}`,
        description: `Tool ${i}`,
        parameters: {},
      },
    }))
    const result = injectToolsIntoSystemPrompt(
      { role: 'system', content: '' },
      tools as Parameters<typeof injectToolsIntoSystemPrompt>[1],
    )
    expect(result.content).toContain('tool_0')
    expect(result.content).toContain('tool_19')
    expect(result.content).toContain('tool_39')
    expect(result.content).toContain('Available tools (40)')
  })

  it('includes parameter schemas in tool descriptions', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path to read' },
              offset: { type: 'number', description: 'Line to start from' },
            },
            required: ['path'],
          },
        },
      },
    ]
    const result = injectToolsIntoSystemPrompt(
      { role: 'system', content: '' },
      tools as Parameters<typeof injectToolsIntoSystemPrompt>[1],
    )
    expect(result.content).toContain('path (string, required)')
    expect(result.content).toContain('offset (number)')
    expect(result.content).toContain('File path to read')
  })
})

describe('parseToolCallsFromText', () => {
  it('parses a valid tool call', () => {
    const text =
      'Here is the result:\n```tool_call\n{"tool": "read_file", "arguments": {"path": "/tmp/test.txt"}}\n```'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('read_file')
    expect(calls[0].input).toEqual({ path: '/tmp/test.txt' })
    expect(calls[0].id).toMatch(/^toolu_/)
  })

  it('parses multiple tool calls', () => {
    const text =
      '```tool_call\n{"tool": "read_file", "arguments": {"path": "a.txt"}}\n```\nSome text\n```tool_call\n{"tool": "write_file", "arguments": {"path": "b.txt", "content": "hi"}}\n```'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(2)
    expect(calls[0].name).toBe('read_file')
    expect(calls[1].name).toBe('write_file')
  })

  it('skips malformed JSON', () => {
    const text = '```tool_call\n{not valid json}\n```'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(0)
  })

  it('skips blocks without tool field', () => {
    const text = '```tool_call\n{"action": "read", "args": {}}\n```'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(0)
  })

  it('returns empty array for text with no tool calls', () => {
    const text = 'Just some regular text without any tool calls.'
    expect(parseToolCallsFromText(text)).toHaveLength(0)
  })

  it('handles arguments being undefined', () => {
    const text = '```tool_call\n{"tool": "list_files"}\n```'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].input).toEqual({})
  })

  it('deduplicates repeated identical Gemma tool calls (loop detection)', () => {
    const call = '<|tool_call>call:Bash{command: "ls -la"}<tool_call|>'
    const text = `${call}<|tool_response>${call}<|tool_response>${call}<|tool_response>${call}`
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Bash')
  })

  it('parses Gemma multi-argument tool calls (Agent-style)', () => {
    const text = `<|tool_call>call:Agent{description: "test agent", prompt: "do the thing", subagent_type: "general-purpose"}<tool_call|>`
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Agent')
    expect(calls[0].input).toHaveProperty('description')
    expect(calls[0].input).toHaveProperty('prompt')
  })

  it('limits to 3 unique tool calls max', () => {
    const text = [
      '```tool_call\n{"tool": "a", "arguments": {"x": 1}}\n```',
      '```tool_call\n{"tool": "b", "arguments": {"x": 2}}\n```',
      '```tool_call\n{"tool": "c", "arguments": {"x": 3}}\n```',
      '```tool_call\n{"tool": "d", "arguments": {"x": 4}}\n```',
    ].join('\n')
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(3)
  })
})
