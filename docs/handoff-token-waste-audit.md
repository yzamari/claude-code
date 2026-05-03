# Token Waste Audit & Fixes — Handoff Document

**Branch:** `fix/reduce-token-waste`  
**Date:** 2026-04-15  
**Status:** All high-impact audit findings addressed. Remaining medium-impact items tracked below.

---

## What Was Done

### 1. Full Token Waste Audit
Scanned the entire codebase and identified 12+ sources of excessive token usage across three categories:
- System prompt / tool description bloat
- Conversation context management inefficiencies  
- Missing cost-optimization in model routing

### 2. Fixes Implemented (this branch)

| Fix | Files Changed | Impact |
|-----|--------------|--------|
| **BashTool prompt slimmed** (21KB -> 13KB) | `src/tools/BashTool/prompt.ts` | ~1,900 tokens saved per request |
| **Cheap model routing for tool turns** | `routerConfig.ts`, `taskClassifier.ts`, `ModelRouter.ts`, `resolveRouteForQuery.ts`, `query.ts` | Up to 19x cost reduction on tool follow-up turns |
| **MCP tools added to microcompact** | `src/services/compact/microCompact.ts` | Prevents unbounded MCP result accumulation |
| **Duplicate subagent instructions removed** | `src/constants/prompts.ts` | ~60 tokens saved per subagent call |
| **Post-compact re-injection budgets shrunk** | `src/services/compact/compact.ts` | `POST_COMPACT_MAX_FILES_TO_RESTORE 5→3`, `POST_COMPACT_TOKEN_BUDGET 50_000→20_000`, `POST_COMPACT_MAX_TOKENS_PER_FILE 5_000→3_000`, `POST_COMPACT_MAX_TOKENS_PER_SKILL 5_000→3_000`, `POST_COMPACT_SKILLS_TOKEN_BUDGET 25_000→12_000`. Worst-case re-injection drops from ~75K tokens to ~32K tokens per compact. |
| **Skill dedup against preserved tail** | `src/services/compact/compact.ts`, `tests/compact/createSkillAttachment.test.ts` | `createSkillAttachmentIfNeeded` now accepts `preservedMessages` and skips skills whose `Skill` tool_use is already visible in the preserved tail. Partial-compact path (the one with a tail) saves up to `POST_COMPACT_MAX_TOKENS_PER_SKILL` × duplicated-skills per compact. Full-compact path passes `[]` (no tail to dedup against). Mirrors the existing file dedup in `createPostCompactFileAttachments`. |
| **Count-based microcompact (FileRead/Bash/Grep accumulation fix)** | `src/services/compact/microCompact.ts`, `tests/compact/countBasedMicrocompact.test.ts` | New `maybeCountBasedMicrocompact` mirrors the time-based path but triggers on compactable-tool count (default `> 10`) instead of an idle gap. Clears older tool_results to the same `[Old tool result content cleared]` stub while keeping the most recent `keepRecent` (default 5) in full. Runs as a fallback after time-based and cached MC decline, so external builds and unsupported models finally get incremental clearing during active work — the public fork was previously letting FileRead results pile up until autocompact at the ~75–90% threshold. Tunable via `CLAUDE_CODE_MC_TRIGGER_COUNT`, `CLAUDE_CODE_MC_KEEP_RECENT`, `CLAUDE_CODE_MC_DISABLE`. |
| **Session memory byte counter persists across compact** | `src/bootstrap/state.ts`, `src/utils/attachments.ts` | `RELEVANT_MEMORIES_CONFIG.MAX_SESSION_BYTES` (60KB) previously reset on every /compact because the byte total was recomputed by scanning in-context messages. Added module-level `surfacedMemoryBytes` that survives compaction — the compact summary almost always captures memory content, so re-injecting the same files post-compact was pure waste (~60KB × N compactions per session). The selector now compares against `Math.max(surfaced.totalBytes, getSurfacedMemoryBytes())` and the counter is only reset on `switchSession()` / `regenerateSessionId()`. Path-level dedup still scans messages so new memory files can surface when the old ones roll out of context. |
| **TodoWriteTool prompt trimmed** (9.5KB → 4KB) | `src/tools/TodoWriteTool/prompt.ts` | Collapsed 8 verbose `<example>` blocks (each with `<reasoning>` tags) down to 3 concise examples. ~1,375 tokens saved every time TodoWriteTool is in the tool list. The task-state / management / breakdown sections are unchanged — only the example prose was cut. |
| **FileReadTool persistence bypass (fix #2 in audit)** — *verified no-op, documented* | `src/Tool.ts:460–468` | The audit flagged `maxResultSizeChars: Infinity` on `FileReadTool` as a bypass. Investigation showed it's a deliberate guard against the circular `Read → persisted file → Read` loop, and the tool already self-bounds via `validateContentTokens` at 25K tokens (`src/tools/FileReadTool/limits.ts`). The actual accumulation problem the audit was worried about is addressed by the count-based microcompact above, not by persistence. No code change needed. |
| **Deferred loading of built-in tools (fix #3 in audit)** — *already in place* | `src/tools/*/shouldDefer: true`, `src/tools/ToolSearchTool/prompt.ts:62` | Investigation showed this branch already sets `shouldDefer: true` on 20+ rarely-used built-in tools (NotebookEdit, WebFetch, WebSearch, LSPTool, ConfigTool, all Task/Team/Cron/Worktree tools, AskUserQuestion, SendMessage, Enter/ExitPlanMode, TodoWrite, RemoteTrigger, ListMcp/ReadMcp resources). The `isDeferredTool()` function returns `true` for them whenever tool search is enabled (default on Anthropic first-party API). The core daily drivers (Bash, Read, Write, Edit, Grep, Glob, Agent, Skill, Brief, ToolSearch, PowerShell, MCPTool) are correctly kept always-loaded. Nothing to change — the audit's "only MCP tools use deferred loading" claim was stale. |

### 3. How Cheap Model Routing Works

The router already runs per-turn inside the `while(true)` loop in `query.ts` (line ~639). We added:

- **`tool_followup` task type** — classified when the previous turn produced tool results (i.e., the model just needs to read output and decide the next action)
- **`cheapModel` config field** — set in `settings.json` under `modelRouter` to auto-downgrade tool follow-up turns to a cheaper model

**To enable**, add to `settings.json`:
```json
{
  "modelRouter": {
    "enabled": true,
    "default": "claude-opus-4-6-...",
    "cheapModel": "claude-haiku-4-5-20251001"
  }
}
```

The flow: User message -> Opus (turn 0) -> tools execute -> Haiku (turn 1, reads results) -> tools execute -> Haiku (turn 2) -> ... -> final response uses whatever model the router picks.

---

## Remaining Optimization Opportunities (NOT yet fixed)

### MEDIUM IMPACT
1. **Full `compactConversation` has no preserved tail** — `src/services/compact/compact.ts:395`  
   Full compact summarizes everything and replaces the message stream. Unlike `partialCompactConversation` (which keeps a head/tail), there's no in-place dedup target for the post-compact file/skill re-injection. A bigger fix would preserve a recent API-round as `messagesToKeep` and re-summarize only older context — deferred because it meaningfully changes compact's semantics and needs careful testing against the existing session-memory-compact path.

2. **~30 attachment generators fire every turn** — `src/utils/attachments.ts:744`  
   Each turn walks a long chain of potential `<system-reminder>` injectors even when none have work to do. The walk is cheap in CPU but the call-site sprawl makes it hard to reason about what reaches the model. Refactor candidate, not a tokens-on-the-wire fix.

3. **CLAUDE.md + gitStatus never compacted** — `src/utils/api.ts:449`  
   These sit in `userContext` and are resent every turn. Usually small (<2KB combined) but still overhead. Needs an invalidation signal (mtime / git HEAD change) to safely cache-skip.

4. **Token estimation undercounts code** — `src/services/tokenEstimation.ts:203`  
   `roughTokenCountEstimation` uses `bytesPerToken = 4`, which matches prose but under-counts code (~3.2 chars/token). Affects budget guards and threshold decisions — the autocompact trigger fires later than it should on heavy-code sessions. Low-risk tuning fix.

---

## Architecture Notes

- **System prompt** is assembled in `src/constants/prompts.ts:getSystemPrompt()` from ~15 sections, cached via `systemPromptSection()`
- **Per-turn attachments** are generated in `src/utils/attachments.ts:getAttachments()` and injected as `<system-reminder>` blocks
- **Model routing** lives in `src/services/router/` with 5 files: config schema, task classifier, router, resolver, fallback executor
- **Microcompact** in `src/services/compact/microCompact.ts` clears old tool results between turns
- **Compaction** in `src/services/compact/compact.ts` handles full conversation compression

## Key Patterns
- `feature('...')` is a Bun bundle-time macro for dead code elimination (ant vs external builds)
- `process.env.USER_TYPE === 'ant'` gates Anthropic-internal features
- The `while(true)` loop in `query.ts:325-1955` is the main turn loop — each iteration = one API call + tool execution
- `getSmallFastModel()` returns Haiku — used for side-channel queries (summaries, token estimation, hooks)
