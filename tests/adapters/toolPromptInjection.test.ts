import { describe, it, expect } from 'vitest'
import {
  injectToolsIntoSystemPrompt,
  parseToolCallsFromText,
  detectNarratedToolCalls,
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

describe('parseGemmaArgs edge cases (via parseToolCallsFromText)', () => {
  // Helper: wrap raw args in bare call:Bash{} format (Format 4)
  // and extract the parsed input
  function parseViaBareBash(argsStr: string): Record<string, unknown> {
    const text = `call:Bash{${argsStr}}`
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    return calls[0].input
  }

  // Helper: wrap raw args in bare call:Tool{} format with a custom tool name
  function parseViaBareCall(toolName: string, argsStr: string): Record<string, unknown> {
    const text = `call:${toolName}{${argsStr}}`
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    return calls[0].input
  }

  // Helper: wrap raw args in Gemma Format 3
  function parseViaGemma(toolName: string, argsStr: string): Record<string, unknown> {
    const text = `<|tool_call>call:${toolName}{${argsStr}}<tool_call|>`
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    return calls[0].input
  }

  it('1. command with commas in values preserves quotes', () => {
    const input = parseViaBareBash('command:echo "hello, world",description:test')
    // Quote stripping only removes MATCHING pairs — inner quotes preserved
    expect(input.command).toBe('echo "hello, world"')
    expect(input.description).toBe('test')
  })

  it('2. command with URL containing colons', () => {
    const input = parseViaBareBash('command:curl https://api.example.com:8080/path,description:fetch API')
    expect(input.command).toBe('curl https://api.example.com:8080/path')
    expect(input.description).toBe('fetch API')
  })

  it('3. command with pipes', () => {
    const input = parseViaBareBash('command:ls | grep foo,description:filter')
    expect(input.command).toBe('ls | grep foo')
    expect(input.description).toBe('filter')
  })

  it('4. command with semicolons', () => {
    const input = parseViaBareBash('command:cd /tmp; ls -la,description:list')
    expect(input.command).toBe('cd /tmp; ls -la')
    expect(input.description).toBe('list')
  })

  it('5. command with single quotes in unquoted value', () => {
    const input = parseViaBareBash("command:echo 'test value',description:test")
    // Quote stripping only removes MATCHING pairs — inner quotes preserved
    expect(input.command).toBe("echo 'test value'")
    expect(input.description).toBe('test')
  })

  it('6. empty command value', () => {
    const input = parseViaBareBash('command:,description:test')
    expect(input.command).toBe('')
    expect(input.description).toBe('test')
  })

  it('7. command only — no description', () => {
    const input = parseViaBareBash('command:ls -la')
    expect(input.command).toBe('ls -la')
    expect(input).not.toHaveProperty('description')
  })

  it('8. description only — no command', () => {
    const input = parseViaBareCall('MyTool', 'description:test desc')
    expect(input.description).toBe('test desc')
    expect(input).not.toHaveProperty('command')
  })

  it('9. three parameters including numeric value', () => {
    const input = parseViaBareBash('command:ls,description:list,timeout:5000')
    expect(input.command).toBe('ls')
    expect(input.description).toBe('list')
    expect(input.timeout).toBe(5000)
  })

  it('10. value with equals sign', () => {
    const input = parseViaBareBash('command:export FOO=bar,description:set env')
    expect(input.command).toBe('export FOO=bar')
    expect(input.description).toBe('set env')
  })

  it('11. value with backslashes', () => {
    const input = parseViaBareBash('command:echo \\\\n,description:newline')
    expect(input.command).toBe('echo \\\\n')
    expect(input.description).toBe('newline')
  })

  it('12. key with underscores and path value', () => {
    const input = parseViaBareCall('Read', 'file_path:/tmp/test.txt')
    expect(input.file_path).toBe('/tmp/test.txt')
  })

  it('13. unicode in values', () => {
    const input = parseViaBareBash('command:echo héllo,description:utf8 test')
    expect(input.command).toBe('echo héllo')
    expect(input.description).toBe('utf8 test')
  })

  it('14. very long command (500+ chars)', () => {
    const longCmd = 'echo ' + 'a'.repeat(500)
    const input = parseViaBareBash(`command:${longCmd},description:long command test`)
    expect(input.command).toBe(longCmd)
    expect(input.description).toBe('long command test')
  })

  it('15. nested braces in value (brace expansion)', () => {
    // The outer brace counter in Format 4 must handle inner {a,b,c}
    const text = 'call:Bash{command:echo {a,b,c},description:brace expansion}'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].input.command).toBe('echo {a,b,c}')
    expect(calls[0].input.description).toBe('brace expansion')
  })

  // Additional evil edge cases beyond the 15 requested

  it('16. value that looks like a key:value but is not (no comma separator)', () => {
    // "command:echo key:value" — the "key:value" is part of the command, not a separate pair
    const input = parseViaBareBash('command:echo key:value')
    expect(input.command).toBe('echo key:value')
  })

  it('17. multiple colons in one value segment', () => {
    const input = parseViaBareCall('ToolSearch', 'query:select:AskUserQuestion:extra,max_results:5')
    expect(input.query).toBe('select:AskUserQuestion:extra')
    expect(input.max_results).toBe(5)
  })

  it('18. boolean values true and false', () => {
    const input = parseViaBareCall('MyTool', 'enabled:true,verbose:false,name:hello')
    expect(input.enabled).toBe(true)
    expect(input.verbose).toBe(false)
    expect(input.name).toBe('hello')
  })

  it('19. floating point number value', () => {
    const input = parseViaBareCall('MyTool', 'threshold:3.14,label:pi')
    expect(input.threshold).toBe(3.14)
    expect(input.label).toBe('pi')
  })

  it('20. Gemma special tokens in args should be stripped', () => {
    const text = '<|tool_call>call:Bash{<|"|>command<|"|>:<|"|>ls -la<|"|>}<tool_call|>'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].input.command).toBe('ls -la')
  })

  it('21. whitespace around colons and commas', () => {
    const input = parseViaBareCall('MyTool', 'key1 : value1 , key2 : value2')
    // The segment split regex is /,\s*(?=\w+\s*:)/ so "key1 : value1" and "key2 : value2"
    // key regex requires no whitespace in key: /\s/.test(key) filters out keys with spaces
    // "key1 " has a trailing space, so /\s/.test("key1 ") is true — it will be skipped!
    // Actually wait: key = seg.slice(0, colonIdx).trim() — so it's trimmed. "key1 " -> "key1"
    // But then /\s/.test("key1") is false. So it should work.
    expect(input.key1).toBe('value1')
    expect(input.key2).toBe('value2')
  })

  it('22. value with trailing/leading whitespace is trimmed', () => {
    const input = parseViaBareCall('MyTool', 'name:  hello world  ,count:42')
    expect(input.name).toBe('hello world')
    expect(input.count).toBe(42)
  })

  it('23. quoted pair format via Gemma Format 3', () => {
    const input = parseViaGemma('Agent', 'prompt: "Search for bugs", description: "Find bugs"')
    expect(input.prompt).toBe('Search for bugs')
    expect(input.description).toBe('Find bugs')
  })

  it('24. single-quoted pair format via Gemma Format 3', () => {
    const input = parseViaGemma('Agent', "prompt: 'Search for bugs', description: 'Find bugs'")
    expect(input.prompt).toBe('Search for bugs')
    expect(input.description).toBe('Find bugs')
  })

  it('25. mixed quoted and unquoted should prefer quoted regex when all are quoted', () => {
    const input = parseViaGemma('Agent', 'prompt:"do stuff",model:"opus"')
    expect(input.prompt).toBe('do stuff')
    expect(input.model).toBe('opus')
  })

  it('26. value that is just a number string should be treated as number in segment path', () => {
    const input = parseViaBareCall('MyTool', 'max_results:1')
    expect(input.max_results).toBe(1)
    expect(typeof input.max_results).toBe('number')
  })

  it('27. value that looks numeric but has leading zeros should still be number', () => {
    const input = parseViaBareCall('MyTool', 'port:0080')
    // /^\d+(\.\d+)?$/ matches "0080", so it becomes Number("0080") = 80
    expect(input.port).toBe(80)
  })

  it('28. value with only whitespace after colon', () => {
    const input = parseViaBareCall('MyTool', 'key:   ,other:val')
    // val after trim = "", empty string won't match number regex
    expect(input.key).toBe('')
    expect(input.other).toBe('val')
  })

  it('29. deeply nested braces in Format 4 brace counter', () => {
    const text = 'call:Bash{command:echo {{nested}} stuff}'
    const calls = parseToolCallsFromText(text)
    // Brace counting: depth starts at 1 for outer {
    // First { of {{ -> depth 2, second { -> depth 3
    // First } of }} -> depth 2, second } -> depth 1
    // Final } -> depth 0: endIdx here
    // argsStr = "command:echo {{nested}} stuff"
    expect(calls).toHaveLength(1)
    expect(calls[0].input.command).toBe('echo {{nested}} stuff')
  })

  it('30. unbalanced opening brace in value causes Format 4 to fail gracefully', () => {
    // "command:echo {broken" — the brace counter in Format 4 will never reach depth 0
    // because the inner { pushes depth to 2 and there's only one } at the end
    // Actually: call:Bash{command:echo {broken}
    // depth=1 at outer {, depth=2 at inner {, then } at end drops to 1, never 0
    // endIdx stays -1, Format 4 skips it with `continue`
    const text = 'call:Bash{command:echo {broken}'
    const calls = parseToolCallsFromText(text)
    // The brace counter sees: { (depth=1), then { (depth=2), then } (depth=1), end of string
    // endIdx = -1, so it's skipped
    expect(calls).toHaveLength(0)
  })

  it('31. args:{} wrapper stripping in Gemma format', () => {
    const text = '<|tool_call>call:Bash{args:{command:ls -la}}<tool_call|>'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    // The argsStr extracted by Format 3 is "args:{command:ls -la}" (after stripping trailing })
    // Wait — Format 3 does: text.slice(argsStart, endIdx).replace(/\}\s*$/, '')
    // argsStart is after the { in call:Bash{
    // endIdx is position of <tool_call|>
    // So we get "args:{command:ls -la}"  (the outer } was removed by Format 3's replace)
    // Then parseGemmaArgs strips args:{} wrapper: .replace(/^\s*args:\{/, '').replace(/\}\s*$/, '')
    // "args:{command:ls -la}" -> after first replace: "command:ls -la}" -> after second: "command:ls -la"
    // Wait, the second replace removes trailing }: "command:ls -la}" -> "command:ls -la"
    // Hmm, but Format 3 already stripped the trailing } before <tool_call|>
    // Let me re-trace. text = "<|tool_call>call:Bash{args:{command:ls -la}}<tool_call|>"
    // gemmaStartRegex matches "<|tool_call>call:Bash{", toolName="Bash"
    // argsStart = after that match
    // closingIdx = index of "<tool_call|>"
    // argsStr = text.slice(argsStart, endIdx).replace(/\}\s*$/, '')
    // text between: "args:{command:ls -la}}"  (two closing braces: one for args:{}, one for outer Bash{})
    // Wait no, the outer { is part of the regex match already. Let me re-check.
    // The regex is /<\|tool_call>call:(\w+)\{/g — it matches up to and including the opening {
    // argsStart = match.index + match[0].length = position AFTER the opening {
    // So argsStr before replace = "args:{command:ls -la}}"
    // After .replace(/\}\s*$/, '') = "args:{command:ls -la}" (strips ONE trailing })
    // Then parseGemmaArgs:
    //   .replace(/^\s*args:\{/, '') -> "command:ls -la}"
    //   .replace(/\}\s*$/, '') -> "command:ls -la"
    // Then command shortcut matches: { command: "ls -la" }
    expect(calls[0].input.command).toBe('ls -la')
  })

  it('32. key with digits like param1', () => {
    // \w+ in regex includes digits, so param1 should work as a key
    const input = parseViaBareCall('MyTool', 'param1:hello,param2:world')
    expect(input.param1).toBe('hello')
    expect(input.param2).toBe('world')
  })

  it('33. escaped quotes inside quoted values', () => {
    const input = parseViaGemma('Bash', 'command: "echo \\"hello\\"", description: "test"')
    expect(input.command).toBe('echo \\"hello\\"')
    expect(input.description).toBe('test')
  })

  it('34. empty args string falls back to raw', () => {
    // An empty string with no key:value pairs
    const text = '<|tool_call>call:Bash{}<tool_call|>'
    const calls = parseToolCallsFromText(text)
    expect(calls).toHaveLength(1)
    // argsStr after Format 3 processing: text between { and <tool_call|> = ""
    // after .replace(/\}\s*$/, '') on "" = ""
    // parseGemmaArgs(""):
    //   hasMultipleKeys = false
    //   cmdMatch = null (no "command" prefix)
    //   pairRegex finds nothing
    //   segment split on "" gives [""], seg="" has colonIdx=-1, skipped
    //   segPairs is empty
    //   returns { raw: "" }
    expect(calls[0].input).toEqual({ raw: '' })
  })

  it('35. command with dollar signs and env vars', () => {
    const input = parseViaBareBash('command:echo $HOME/$USER,description:show home')
    expect(input.command).toBe('echo $HOME/$USER')
    expect(input.description).toBe('show home')
  })

  it('36. command with backticks', () => {
    const input = parseViaBareBash('command:echo `date`,description:show date')
    expect(input.command).toBe('echo `date`')
    expect(input.description).toBe('show date')
  })

  it('37. command with parentheses', () => {
    const input = parseViaBareBash('command:(cd /tmp && ls),description:subshell')
    expect(input.command).toBe('(cd /tmp && ls)')
    expect(input.description).toBe('subshell')
  })

  it('38. command with double ampersand', () => {
    const input = parseViaBareBash('command:mkdir -p /tmp/test && cd /tmp/test,description:create and enter')
    expect(input.command).toBe('mkdir -p /tmp/test && cd /tmp/test')
    expect(input.description).toBe('create and enter')
  })

  it('39. command with redirect operators', () => {
    const input = parseViaBareBash('command:echo hello > /tmp/out.txt 2>&1,description:redirect')
    expect(input.command).toBe('echo hello > /tmp/out.txt 2>&1')
    expect(input.description).toBe('redirect')
  })

  it('40. value starting with a quote but not ending with one (unbalanced quotes)', () => {
    // command:"broken quote,description:test
    // The quoted pair regex won't match (unclosed quote)
    // Falls through to segment split
    const input = parseViaBareBash('command:"broken quote,description:test')
    // val = '"broken quote' — unbalanced quote (starts with " but doesn't end with ")
    // With matching-pair-only stripping, the quote is preserved
    expect(input.command).toBe('"broken quote')
    expect(input.description).toBe('test')
  })
})

// ============================================================
// detectNarratedToolCalls tests
// ============================================================
describe('detectNarratedToolCalls', () => {
  const tools = ['Bash', 'Grep', 'Read', 'Edit', 'Agent']

  it('detects "I will use the Bash tool"', () => {
    expect(detectNarratedToolCalls('I will use the Bash tool to run the tests.', tools)).toBe('Bash')
  })

  it('detects "I\'ll launch an agent"', () => {
    expect(detectNarratedToolCalls("I'll launch an Agent to search the codebase.", tools)).toBe('Agent')
  })

  it('detects "Let me call Read"', () => {
    expect(detectNarratedToolCalls('Let me call Read to check the file contents.', tools)).toBe('Read')
  })

  it('detects "Using the Grep tool"', () => {
    expect(detectNarratedToolCalls('Using the Grep tool to find all occurrences.', tools)).toBe('Grep')
  })

  it('detects "I\'m going to invoke Edit"', () => {
    expect(detectNarratedToolCalls("I'm going to invoke Edit to fix the typo.", tools)).toBe('Edit')
  })

  it('returns null when no narration detected', () => {
    expect(detectNarratedToolCalls('The search results show three matches.', tools)).toBeNull()
  })

  it('returns null for empty text', () => {
    expect(detectNarratedToolCalls('', tools)).toBeNull()
  })

  it('returns null for empty tool names', () => {
    expect(detectNarratedToolCalls('I will use the Bash tool', [])).toBeNull()
  })

  it('does not false-positive on tool names in regular text', () => {
    expect(detectNarratedToolCalls('The Bash script runs fine.', tools)).toBeNull()
  })

  it('detects "Launching the Agent tool"', () => {
    expect(detectNarratedToolCalls('Launching the Agent tool to help.', tools)).toBe('Agent')
  })

  it('is case-insensitive on the verb', () => {
    expect(detectNarratedToolCalls('i will USE the Bash tool', tools)).toBe('Bash')
  })
})

// ============================================================
// injectToolsIntoSystemPrompt — tool result format & enum truncation
// ============================================================
describe('injectToolsIntoSystemPrompt — advanced', () => {
  it('includes TOOL RESULTS guidance', () => {
    const system = { role: 'system', content: 'You are helpful.' }
    const tools = [{
      type: 'function',
      function: { name: 'test', description: 'A tool', parameters: { type: 'object' } },
    }]
    const result = injectToolsIntoSystemPrompt(system, tools)
    expect(result.content).toContain('TOOL RESULTS:')
    expect(result.content).toContain('[Tool Result: ToolName]')
  })

  it('shows enum truncation indicator when >6 values', () => {
    const system = { role: 'system', content: '' }
    const tools = [{
      type: 'function',
      function: {
        name: 'picker',
        description: 'Pick a color',
        parameters: {
          type: 'object',
          properties: {
            color: {
              type: 'string',
              enum: ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet', 'pink'],
            },
          },
        },
      },
    }]
    const result = injectToolsIntoSystemPrompt(system, tools)
    expect(result.content).toContain('2 more')
    expect(result.content).toContain('"red"')
    expect(result.content).toContain('"indigo"')
    // pink and violet (7th, 8th) should NOT be shown inline
    expect(result.content).not.toMatch(/"pink"/)
  })

  it('shows all enum values when <=6', () => {
    const system = { role: 'system', content: '' }
    const tools = [{
      type: 'function',
      function: {
        name: 'picker',
        description: 'Pick',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['fast', 'slow', 'auto'] },
          },
        },
      },
    }]
    const result = injectToolsIntoSystemPrompt(system, tools)
    expect(result.content).toContain('"fast"')
    expect(result.content).toContain('"slow"')
    expect(result.content).toContain('"auto"')
    expect(result.content).not.toContain('more')
  })
})
