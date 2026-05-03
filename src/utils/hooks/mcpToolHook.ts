/**
 * Implementation of `mcp_tool` hook type (upstream v2.1.118 parity).
 *
 * Lets a configured hook directly invoke a connected MCP server's tool
 * without spawning a subprocess. The hook's `input` object is sent verbatim
 * to `tools/call` after `${...}` placeholder substitution from the firing
 * event's payload.
 *
 * Supported placeholders inside string values:
 *   ${tool_input.<jsonPath>}  — value at jsonPath in event's tool_input
 *   ${tool_use_id}            — firing tool_use_id
 *   ${tool_name}              — firing tool name
 *   ${session_id}             — current session ID
 *   ${cwd}                    — current working directory
 *
 * Substitution is recursive across object/array values. Non-string leaves
 * are passed through unchanged. Unresolved placeholders are left as the
 * literal `${...}` text.
 */

import type { McpToolHook } from '../../schemas/hooks.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import { logForDebugging } from '../debug.js'
import { logError } from '../log.js'

export interface SubstitutionContext {
  tool_input?: unknown
  tool_use_id?: string
  tool_name?: string
  session_id?: string
  cwd?: string
}

/**
 * Resolve a single `${...}` placeholder to a string. Returns null if the
 * placeholder is unknown or its value can't be coerced; callers should leave
 * the literal `${...}` in the string in that case.
 */
function resolvePlaceholder(
  expr: string,
  ctx: SubstitutionContext,
): string | null {
  // ${tool_input.foo.bar} → walk dotted path through ctx.tool_input
  if (expr.startsWith('tool_input.')) {
    const path = expr.slice('tool_input.'.length).split('.').filter(Boolean)
    let cur: unknown = ctx.tool_input
    for (const seg of path) {
      if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[seg]
      } else {
        return null
      }
    }
    if (typeof cur === 'string') return cur
    if (typeof cur === 'number' || typeof cur === 'boolean') return String(cur)
    if (cur === null || cur === undefined) return null
    try {
      return JSON.stringify(cur)
    } catch {
      return null
    }
  }
  // Bare ${tool_input} → JSON-stringify the whole object
  if (expr === 'tool_input') {
    if (ctx.tool_input === undefined) return null
    try {
      return JSON.stringify(ctx.tool_input)
    } catch {
      return null
    }
  }
  if (expr === 'tool_use_id') return ctx.tool_use_id ?? null
  if (expr === 'tool_name') return ctx.tool_name ?? null
  if (expr === 'session_id') return ctx.session_id ?? null
  if (expr === 'cwd') return ctx.cwd ?? null
  return null
}

const PLACEHOLDER_RE = /\$\{([^}]+)\}/g

/**
 * Apply ${...} substitution to a single string. Unresolved placeholders are
 * left as the literal `${...}` text so authoring mistakes are visible rather
 * than silently producing empty input.
 */
export function substituteString(
  value: string,
  ctx: SubstitutionContext,
): string {
  return value.replace(PLACEHOLDER_RE, (match, expr) => {
    const resolved = resolvePlaceholder(String(expr).trim(), ctx)
    return resolved === null ? match : resolved
  })
}

/**
 * Recursively walk an object/array, applying string substitution to every
 * string leaf. Non-string values pass through unchanged. Cycles are not
 * supported (hook input is JSON-serializable in practice).
 */
export function substituteInput(
  value: unknown,
  ctx: SubstitutionContext,
): unknown {
  if (typeof value === 'string') return substituteString(value, ctx)
  if (Array.isArray(value)) return value.map(v => substituteInput(v, ctx))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = substituteInput(v, ctx)
    }
    return out
  }
  return value
}

export interface McpToolHookExecResult {
  ok: boolean
  output: string
  stderr?: string
  durationMs: number
  serverName: string
  toolName: string
}

/**
 * Execute an mcp_tool hook against a connected MCP server.
 *
 * Looks up the server by `hook.server` in the supplied client list, calls
 * `tools/call` with the substituted input, and returns the result text.
 * Failures (server not connected, tool not found, MCP error response) are
 * captured as ok:false with stderr — they should be treated as
 * non_blocking_error by the caller (parity with HTTP hook errors).
 */
export async function execMcpToolHook(
  hook: McpToolHook,
  ctx: SubstitutionContext,
  clients: readonly MCPServerConnection[],
  abortSignal?: AbortSignal,
): Promise<McpToolHookExecResult> {
  const start = Date.now()
  const result: McpToolHookExecResult = {
    ok: false,
    output: '',
    durationMs: 0,
    serverName: hook.server,
    toolName: hook.tool,
  }

  const connected = clients.find(
    c => c.name === hook.server && c.type === 'connected',
  )
  if (!connected || connected.type !== 'connected') {
    result.stderr = `MCP server "${hook.server}" is not connected`
    result.durationMs = Date.now() - start
    return result
  }

  const substitutedInput = substituteInput(hook.input ?? {}, ctx) as Record<
    string,
    unknown
  >

  try {
    logForDebugging(
      `mcp_tool hook → ${hook.server}.${hook.tool} input=${JSON.stringify(substitutedInput).slice(0, 200)}`,
    )
    const response = await connected.client.callTool(
      {
        name: hook.tool,
        arguments: substitutedInput,
      },
      undefined, // result schema — let the SDK infer
      {
        signal: abortSignal,
        timeout: hook.timeout ? hook.timeout * 1000 : undefined,
      },
    )

    if (response.isError) {
      result.stderr = stringifyMcpContent(response.content)
      result.durationMs = Date.now() - start
      return result
    }

    result.ok = true
    result.output = stringifyMcpContent(response.content)
    result.durationMs = Date.now() - start
    return result
  } catch (err) {
    logError(
      new Error(`mcp_tool hook ${hook.server}.${hook.tool} failed`, {
        cause: err instanceof Error ? err : new Error(String(err)),
      }),
    )
    result.stderr = err instanceof Error ? err.message : String(err)
    result.durationMs = Date.now() - start
    return result
  }
}

function stringifyMcpContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) {
    try {
      return JSON.stringify(content)
    } catch {
      return String(content)
    }
  }
  // MCP returns content as an array of {type:'text', text:string} | image | resource.
  // Concatenate text parts; serialize others as JSON.
  return content
    .map(part => {
      if (
        part &&
        typeof part === 'object' &&
        'type' in part &&
        (part as { type: string }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text
      }
      try {
        return JSON.stringify(part)
      } catch {
        return String(part)
      }
    })
    .join('\n')
}
