import { beforeEach, describe, expect, it } from 'vitest'
import { maybeCountBasedMicrocompact } from 'src/services/compact/microCompact.js'
import {
  createAssistantMessage,
  createUserMessage,
} from 'src/utils/messages.js'
import type { Message } from 'src/types/message.js'
import type {
  BetaContentBlock,
  BetaContentBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

// The count-based microcompact replaces old compactable tool_result content
// with this stub from time-based MC (they share the marker). Duplicated here
// as a literal so the test fails loudly if the source-of-truth string ever
// changes and we forget to update the fallback path.
const TIME_BASED_MC_CLEARED_MESSAGE = '[Old tool result content cleared]'

/**
 * Build an assistant message carrying a single Read tool_use block. Read is
 * in the compactable set, so its tool_use_id counts toward the trigger.
 */
function assistantReadCall(id: string, path: string): Message {
  const block = {
    type: 'tool_use' as const,
    id,
    name: 'Read',
    input: { file_path: path },
  } as unknown as BetaContentBlock
  return createAssistantMessage({ content: [block] })
}

/**
 * Build a user message carrying a single tool_result with text content. The
 * count-based path clears these when the trigger fires and they're not in
 * the kept-recent set.
 */
function userToolResult(toolUseId: string, content: string): Message {
  const block = {
    type: 'tool_result' as const,
    tool_use_id: toolUseId,
    content,
  } as unknown as BetaContentBlockParam
  return createUserMessage({ content: [block] })
}

/**
 * Build a paired assistant-calls-Read + user-returns-result sequence. The
 * content is a 500-char string so the stub replacement saves measurable
 * tokens (calculateToolResultTokens uses the string length).
 */
function readPair(id: string, path: string): Message[] {
  const bigPayload = `file contents for ${path}: ${'x'.repeat(500)}`
  return [assistantReadCall(id, path), userToolResult(id, bigPayload)]
}

/**
 * Convenience: build N Read pairs with predictable IDs. With N=11 and the
 * default triggerCount=10, the trigger fires (compactable count > threshold).
 */
function readPairs(n: number): Message[] {
  const msgs: Message[] = []
  for (let i = 0; i < n; i++) {
    msgs.push(...readPair(`toolu_${i}`, `/tmp/file_${i}.txt`))
  }
  return msgs
}

/**
 * Extract the tool_result content string for a given id from a message list.
 * Returns null when not found or content isn't a plain string.
 */
function getToolResultContent(
  messages: Message[],
  toolUseId: string,
): string | null {
  for (const msg of messages) {
    if (msg.type !== 'user' || !Array.isArray(msg.message.content)) continue
    for (const block of msg.message.content) {
      if (
        block.type === 'tool_result' &&
        block.tool_use_id === toolUseId &&
        typeof block.content === 'string'
      ) {
        return block.content
      }
    }
  }
  return null
}

describe('maybeCountBasedMicrocompact', () => {
  beforeEach(() => {
    // Reset env-var overrides between tests so defaults apply.
    delete process.env.CLAUDE_CODE_MC_DISABLE
    delete process.env.CLAUDE_CODE_MC_TRIGGER_COUNT
    delete process.env.CLAUDE_CODE_MC_KEEP_RECENT
  })

  it('returns null when compactable count is below the trigger', () => {
    // 5 Read pairs → 5 compactable tool_use IDs → below default trigger (10).
    const messages = readPairs(5)
    expect(maybeCountBasedMicrocompact(messages)).toBeNull()
  })

  it('returns null at the trigger count (strict >, not >=)', () => {
    // Exactly 10 compactable IDs should NOT fire — trigger is `> 10`.
    const messages = readPairs(10)
    expect(maybeCountBasedMicrocompact(messages)).toBeNull()
  })

  it('clears older tool_results and keeps the most recent N when above trigger', () => {
    // 11 pairs → count exceeds trigger → clears oldest, keeps last 5.
    const messages = readPairs(11)
    const result = maybeCountBasedMicrocompact(messages)
    expect(result).not.toBeNull()

    // IDs 0..5 should be cleared (6 oldest), IDs 6..10 kept in full.
    for (let i = 0; i <= 5; i++) {
      expect(getToolResultContent(result!.messages, `toolu_${i}`)).toBe(
        TIME_BASED_MC_CLEARED_MESSAGE,
      )
    }
    for (let i = 6; i <= 10; i++) {
      const content = getToolResultContent(result!.messages, `toolu_${i}`)
      expect(content).not.toBe(TIME_BASED_MC_CLEARED_MESSAGE)
      expect(content).toContain(`file_${i}.txt`)
    }
  })

  it('is idempotent — running again after a clear reports no further savings', () => {
    const messages = readPairs(11)
    const first = maybeCountBasedMicrocompact(messages)
    expect(first).not.toBeNull()

    // Re-running on the already-cleared output produces zero new tokensSaved,
    // so the function returns null rather than repeating the log event.
    const second = maybeCountBasedMicrocompact(first!.messages)
    expect(second).toBeNull()
  })

  it('ignores non-compactable tools (e.g. TodoWrite)', () => {
    // Build 11 TodoWrite pairs — TodoWrite is NOT in COMPACTABLE_BUILTIN_TOOLS,
    // so none of these count toward the trigger, no clearing happens.
    const msgs: Message[] = []
    for (let i = 0; i < 11; i++) {
      const id = `toolu_todo_${i}`
      const toolUseBlock = {
        type: 'tool_use' as const,
        id,
        name: 'TodoWrite',
        input: { todos: [] },
      } as unknown as BetaContentBlock
      const toolResultBlock = {
        type: 'tool_result' as const,
        tool_use_id: id,
        content: 'updated',
      } as unknown as BetaContentBlockParam
      msgs.push(
        createAssistantMessage({ content: [toolUseBlock] }),
        createUserMessage({ content: [toolResultBlock] }),
      )
    }
    expect(maybeCountBasedMicrocompact(msgs)).toBeNull()
  })

  it('mixes compactable and non-compactable — only compactable count toward trigger', () => {
    // 11 Reads + 20 TodoWrite. Reads are compactable (count=11 > 10 → fires),
    // TodoWrites don't count and are left fully intact after the clear.
    const msgs: Message[] = [...readPairs(11)]
    for (let i = 0; i < 20; i++) {
      const id = `toolu_todo_${i}`
      const toolUseBlock = {
        type: 'tool_use' as const,
        id,
        name: 'TodoWrite',
        input: { todos: [] },
      } as unknown as BetaContentBlock
      const toolResultBlock = {
        type: 'tool_result' as const,
        tool_use_id: id,
        content: `todo result ${i}`,
      } as unknown as BetaContentBlockParam
      msgs.push(
        createAssistantMessage({ content: [toolUseBlock] }),
        createUserMessage({ content: [toolResultBlock] }),
      )
    }

    const result = maybeCountBasedMicrocompact(msgs)
    expect(result).not.toBeNull()
    // TodoWrite results must survive untouched.
    for (let i = 0; i < 20; i++) {
      expect(getToolResultContent(result!.messages, `toolu_todo_${i}`)).toBe(
        `todo result ${i}`,
      )
    }
  })

  it('respects CLAUDE_CODE_MC_DISABLE env var', () => {
    process.env.CLAUDE_CODE_MC_DISABLE = '1'
    const messages = readPairs(20)
    expect(maybeCountBasedMicrocompact(messages)).toBeNull()
  })

  it('respects CLAUDE_CODE_MC_TRIGGER_COUNT env var', () => {
    // Lower trigger to 3, also lower keepRecent to 2 so that with 5 pairs
    // there's actually something left over to clear (5 > 3 fires; last 2
    // kept; 3 oldest cleared). Without lowering keepRecent the default of 5
    // would absorb all 5 IDs into the keep set and the function would
    // correctly report "nothing to clear" by returning null.
    process.env.CLAUDE_CODE_MC_TRIGGER_COUNT = '3'
    process.env.CLAUDE_CODE_MC_KEEP_RECENT = '2'
    const messages = readPairs(5)
    const result = maybeCountBasedMicrocompact(messages)
    expect(result).not.toBeNull()
    // Verify the trigger threshold was actually the env-var value, not the
    // default: the default would NOT have fired here (5 > 10 is false).
    expect(getToolResultContent(result!.messages, 'toolu_0')).toBe(
      TIME_BASED_MC_CLEARED_MESSAGE,
    )
    expect(getToolResultContent(result!.messages, 'toolu_4')).toContain('file_4')
  })

  it('respects CLAUDE_CODE_MC_KEEP_RECENT env var', () => {
    // With keepRecent=2, only the last 2 survive after a trigger-fires run.
    process.env.CLAUDE_CODE_MC_KEEP_RECENT = '2'
    const messages = readPairs(11)
    const result = maybeCountBasedMicrocompact(messages)
    expect(result).not.toBeNull()

    // IDs 9 and 10 should survive; 0..8 cleared.
    expect(getToolResultContent(result!.messages, `toolu_9`)).toContain('file_9')
    expect(getToolResultContent(result!.messages, `toolu_10`)).toContain(
      'file_10',
    )
    for (let i = 0; i <= 8; i++) {
      expect(getToolResultContent(result!.messages, `toolu_${i}`)).toBe(
        TIME_BASED_MC_CLEARED_MESSAGE,
      )
    }
  })
})
