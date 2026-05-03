/**
 * Tests for the mcp_tool hook type (upstream v2.1.118 parity).
 * Covers schema, ${...} substitution, executor, and dedupe identity.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  substituteString,
  substituteInput,
  execMcpToolHook,
  type SubstitutionContext,
} from '../../src/utils/hooks/mcpToolHook.js'
import { HookCommandSchema } from '../../src/schemas/hooks.js'
import { isHookEqual } from '../../src/utils/hooks/hooksSettings.js'

// ----------------------------------------------------------------------
// 1. Schema accepts mcp_tool config
// ----------------------------------------------------------------------
describe('mcp_tool hook schema', () => {
  it('accepts a minimal valid mcp_tool config', () => {
    const result = HookCommandSchema().safeParse({
      type: 'mcp_tool',
      server: 'my-server',
      tool: 'my-tool',
    })
    expect(result.success).toBe(true)
  })

  it('accepts an mcp_tool config with input + if + timeout', () => {
    const result = HookCommandSchema().safeParse({
      type: 'mcp_tool',
      server: 'github',
      tool: 'create_issue',
      input: { repo: '${tool_input.repo}', title: 'Auto: ${tool_name}' },
      if: 'Bash(gh issue *)',
      timeout: 30,
    })
    expect(result.success).toBe(true)
  })

  it('rejects an mcp_tool config missing server', () => {
    const result = HookCommandSchema().safeParse({
      type: 'mcp_tool',
      tool: 'my-tool',
    })
    expect(result.success).toBe(false)
  })
})

// ----------------------------------------------------------------------
// 2. Variable substitution
// ----------------------------------------------------------------------
describe('mcp_tool hook substitution', () => {
  const ctx: SubstitutionContext = {
    tool_input: {
      file_path: '/tmp/foo.ts',
      nested: { count: 42 },
      flag: true,
    },
    tool_use_id: 'tu_abc',
    tool_name: 'Edit',
    session_id: 's_123',
    cwd: '/repo',
  }

  it('replaces single placeholders in a string', () => {
    expect(substituteString('file=${tool_input.file_path}', ctx)).toBe(
      'file=/tmp/foo.ts',
    )
  })

  it('replaces multiple placeholders in a string', () => {
    expect(
      substituteString('${tool_name}/${tool_input.file_path}@${session_id}', ctx),
    ).toBe('Edit//tmp/foo.ts@s_123')
  })

  it('walks dotted paths into tool_input', () => {
    expect(substituteString('${tool_input.nested.count}', ctx)).toBe('42')
  })

  it('coerces booleans and numbers to strings', () => {
    expect(substituteString('flag=${tool_input.flag}', ctx)).toBe('flag=true')
  })

  it('leaves unresolved placeholders literal (visible authoring error)', () => {
    expect(substituteString('x=${tool_input.missing}', ctx)).toBe(
      'x=${tool_input.missing}',
    )
    expect(substituteString('y=${unknown_field}', ctx)).toBe('y=${unknown_field}')
  })

  it('JSON-stringifies the whole tool_input when ${tool_input} is bare', () => {
    const out = substituteString('${tool_input}', ctx)
    const parsed = JSON.parse(out)
    expect(parsed.file_path).toBe('/tmp/foo.ts')
  })

  it('recursively substitutes inside arrays and objects', () => {
    const out = substituteInput(
      {
        repo: '${tool_input.file_path}',
        meta: {
          ids: ['${tool_use_id}', 'static'],
          flag: '${tool_input.flag}',
        },
        constant: 99,
        passthrough: null,
      },
      ctx,
    )
    expect(out).toEqual({
      repo: '/tmp/foo.ts',
      meta: { ids: ['tu_abc', 'static'], flag: 'true' },
      constant: 99,
      passthrough: null,
    })
  })
})

// ----------------------------------------------------------------------
// 3. Executor — server lookup, success, failure, isError response
// ----------------------------------------------------------------------
describe('mcp_tool hook executor', () => {
  function makeConnectedClient(name: string, mockCallTool: unknown) {
    return {
      name,
      type: 'connected' as const,
      capabilities: {},
      config: {} as never,
      cleanup: async () => {},
      client: { callTool: mockCallTool } as unknown as never,
    }
  }

  it('returns ok:true with concatenated text content on success', async () => {
    const callTool = vi.fn(async () => ({
      isError: false,
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    }))
    const result = await execMcpToolHook(
      {
        type: 'mcp_tool',
        server: 'srv',
        tool: 'greet',
        input: { name: '${tool_input.who}' },
      },
      { tool_input: { who: 'alice' } },
      [makeConnectedClient('srv', callTool)],
    )
    expect(result.ok).toBe(true)
    expect(result.output).toBe('hello\nworld')
    expect(callTool).toHaveBeenCalledWith(
      { name: 'greet', arguments: { name: 'alice' } },
      undefined,
      expect.any(Object),
    )
  })

  it('returns ok:false when server is not connected', async () => {
    const result = await execMcpToolHook(
      { type: 'mcp_tool', server: 'missing', tool: 't' },
      {},
      [],
    )
    expect(result.ok).toBe(false)
    expect(result.stderr).toContain('not connected')
  })

  it('returns ok:false when MCP returns isError:true', async () => {
    const callTool = vi.fn(async () => ({
      isError: true,
      content: [{ type: 'text', text: 'tool failed' }],
    }))
    const result = await execMcpToolHook(
      { type: 'mcp_tool', server: 'srv', tool: 't' },
      {},
      [makeConnectedClient('srv', callTool)],
    )
    expect(result.ok).toBe(false)
    expect(result.stderr).toContain('tool failed')
  })

  it('returns ok:false when callTool throws (transport/timeout)', async () => {
    const callTool = vi.fn(async () => {
      throw new Error('timeout after 30s')
    })
    const result = await execMcpToolHook(
      { type: 'mcp_tool', server: 'srv', tool: 't' },
      {},
      [makeConnectedClient('srv', callTool)],
    )
    expect(result.ok).toBe(false)
    expect(result.stderr).toContain('timeout')
  })
})

// ----------------------------------------------------------------------
// 4. Dedupe identity (mcp_tool entries with same server+tool+input merge)
// ----------------------------------------------------------------------
describe('mcp_tool isHookEqual identity', () => {
  it('treats identical mcp_tool hooks as equal', () => {
    const a = {
      type: 'mcp_tool' as const,
      server: 'srv',
      tool: 't',
      input: { x: 1 },
    }
    const b = {
      type: 'mcp_tool' as const,
      server: 'srv',
      tool: 't',
      input: { x: 1 },
    }
    expect(isHookEqual(a, b)).toBe(true)
  })

  it('different `input` makes mcp_tool hooks distinct (different calls)', () => {
    const a = {
      type: 'mcp_tool' as const,
      server: 'srv',
      tool: 't',
      input: { x: 1 },
    }
    const b = {
      type: 'mcp_tool' as const,
      server: 'srv',
      tool: 't',
      input: { x: 2 },
    }
    expect(isHookEqual(a, b)).toBe(false)
  })

  it('different `if` makes mcp_tool hooks distinct', () => {
    const a = {
      type: 'mcp_tool' as const,
      server: 'srv',
      tool: 't',
      if: 'Bash(git *)',
    }
    const b = {
      type: 'mcp_tool' as const,
      server: 'srv',
      tool: 't',
      if: 'Bash(npm *)',
    }
    expect(isHookEqual(a, b)).toBe(false)
  })

  it('different `tool` makes hooks distinct', () => {
    const a = { type: 'mcp_tool' as const, server: 'srv', tool: 'a' }
    const b = { type: 'mcp_tool' as const, server: 'srv', tool: 'b' }
    expect(isHookEqual(a, b)).toBe(false)
  })
})
