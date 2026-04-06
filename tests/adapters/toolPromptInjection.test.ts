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

  it('shows nested schema for array items with properties', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'ask_user',
          description: 'Ask the user a question',
          parameters: {
            type: 'object',
            properties: {
              questions: {
                type: 'array',
                description: 'Questions to ask',
                items: {
                  type: 'object',
                  properties: {
                    question: { type: 'string', description: 'The question text' },
                    header: { type: 'string', description: 'Short label' },
                    multiSelect: { type: 'boolean', description: 'Allow multiple' },
                  },
                  required: ['question', 'header'],
                },
              },
            },
            required: ['questions'],
          },
        },
      },
    ]
    const result = injectToolsIntoSystemPrompt(
      { role: 'system', content: '' },
      tools as Parameters<typeof injectToolsIntoSystemPrompt>[1],
    )
    expect(result.content).toContain('questions (array, required)')
    expect(result.content).toContain('Each item:')
    expect(result.content).toContain('question (string, required)')
    expect(result.content).toContain('header (string, required)')
    expect(result.content).toContain('multiSelect (boolean)')
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

  it('limits to 10 unique tool calls max', () => {
    const text = Array.from({ length: 12 }, (_, i) =>
      `\`\`\`tool_call\n{"tool": "t${i}", "arguments": {"x": ${i}}}\n\`\`\``
    ).join('\n')
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(10)
  })

  it('parses bare JSON with nested objects (brace-balanced)', () => {
    const text = 'Here is the call: {"tool": "AskUserQuestion", "arguments": {"questions": [{"question": "Which?", "header": "Choice", "options": [{"label": "A", "description": "Option A"}], "multiSelect": false}]}} done.'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('AskUserQuestion')
    expect(calls[0].input).toHaveProperty('questions')
    expect((calls[0].input as any).questions[0].header).toBe('Choice')
  })

  it('parses bare JSON with multiline string values', () => {
    const text = '{"tool": "Bash", "arguments": {"command": "echo hello\nworld"}}'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Bash')
    expect(calls[0].input.command).toBe('echo hello\nworld')
  })

  it('parses Gemma format with colons in values', () => {
    const text = '<|tool_call>call:ToolSearch{query:select:AskUserQuestion,max_results:1}<tool_call|>'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('ToolSearch')
    expect(calls[0].input).toEqual({ query: 'select:AskUserQuestion', max_results: 1 })
  })

  it('parses Gemma format with boolean and numeric values', () => {
    const text = '<|tool_call>call:MyTool{enabled:true,count:42,name:hello}<tool_call|>'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].input).toEqual({ enabled: true, count: 42, name: 'hello' })
  })

  it('parses bare call:Name{} format without special tokens', () => {
    const text = 'call:Bash{command:ls -F,description:List files in the current directory}'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Bash')
    expect(calls[0].input.command).toBe('ls -F')
    expect(calls[0].input.description).toBe('List files in the current directory')
  })

  it('separates command from description in Bash calls (regression: URL corruption)', () => {
    const text = 'call:Bash{command:git clone https://github.com/fastapi/fastapi.git,description:Clone the FastAPI repository.}'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Bash')
    expect(calls[0].input.command).toBe('git clone https://github.com/fastapi/fastapi.git')
    expect(calls[0].input.description).toBe('Clone the FastAPI repository.')
  })

  it('parses multiple back-to-back bare call: formats', () => {
    const text = 'call:Bash{command:ls -F,description:List files}call:Skill{skill:superpowers:brainstorm}thought'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(2)
    expect(calls[0].name).toBe('Bash')
    expect(calls[1].name).toBe('Skill')
    expect(calls[1].input).toHaveProperty('skill')
  })

  it('parses bare call: format with quoted values', () => {
    const text = 'call:Agent{prompt: "Search the codebase for bugs", description: "Find bugs"}'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Agent')
    expect(calls[0].input).toEqual({ prompt: 'Search the codebase for bugs', description: 'Find bugs' })
  })

  it('does not double-parse call: that was already matched by Gemma Format 3', () => {
    const text = '<|tool_call>call:Bash{command: "ls"}<tool_call|>'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1) // not 2
    expect(calls[0].name).toBe('Bash')
  })

  it('parses bare call: after newline', () => {
    const text = 'Some explanation text\ncall:Read{file_path:/tmp/test.txt}'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Read')
    expect(calls[0].input).toHaveProperty('file_path')
  })
})
