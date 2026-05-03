# Upstream Catch-up — Brutal Audit Supplement

**Date compiled:** 2026-05-03
**Purpose:** Adversarial review of `upstream-catchup-2026-05.md`. Lists what the original report **missed**, **glossed**, or **under-weighted**. Window emphasized: April 15 → May 3, 2026.

The original report is solid on 80% of CHANGELOG-visible items but it is **substantially blind to (a) the Agent SDK's own surface area, (b) hidden / undocumented env vars surfaced by the npm source-map leak, (c) week-of-May-1 changes, and (d) several net-new slash commands and hook events**. Specifics below, with URLs.

---

## GAPS IN ORIGINAL REPORT

These are concrete items that should be in the report but are absent. Each is listed with severity for our fork.

### G1. Agent SDK is treated as a single bullet — it had ~75 versions of changes
The original report (§1.8) lumps the SDK into 7 lines. The TypeScript SDK alone went **0.2.0 → 0.2.126** in this window with major option-surface, method-surface, and event-surface additions. Severity: **HIGH** — this fork wraps the SDK; we are flying blind on what callers can now configure.

Net-new `ClaudeAgentOptions` not in the report:
- `skills: string[] | 'all'` — gate which skills load
- `managedSettings` — embedders inject policy-tier settings into spawned CLI
- `sessionStore` (alpha, plus full `SessionStore` / `SessionKey` types, `InMemorySessionStore`, `--session-mirror` transcript mirror, S3/Redis/Postgres reference adapters in `examples/session_stores/`)
- `taskBudget` — API-side token-budget pacing for tool use (directly relevant to our token-waste branch)
- `agentProgressSummaries` — periodic AI summaries of running subagents, surfaced via `task_progress.summary`
- `forwardSubagentText` — stream subagent text deltas to consumer
- `title` — explicit session title, skips auto-generation
- `betas: string[]` — pass `anthropic-beta` headers (e.g. `'context-1m-2025-08-07'`)
- `debug` / `debugFile` — programmatic debug logging
- `agentProgressSummaries` requires `CLAUDE_CODE_ENABLE_TASKS=true`

Net-new methods (none in original report):
`startup()` (~20× faster first query — relevant to our cold-start), `getContextUsage()`, `reloadPlugins()`, `enableChannel()`, `getSessionInfo()`, `listSessions()`, `getSessionMessages()`, `listSubagents()`, `getSubagentMessages()`, `forkSession()`, `deleteSession()`, `renameSession()`, `tagSession()`, `supportedAgents()`, `promptSuggestion()`, `canUseTool()`, `close()`, `reconnectMcpServer()`, `toggleMcpServer()`, `mcpServerStatus()`.

Net-new event/system messages (none in original report):
- `SDKMirrorErrorMessage` (mirror_error)
- `SDKElicitationCompleteMessage`
- `task_progress` / `task_started` / `task_notification`
- `ConfigChange`, `TeammateIdle`, `TaskCompleted` hook events
- `hook_started` / `hook_progress` / `hook_response` (gated by `includeHookEvents`)
- `api_retry` system message (attempt count, max retries, delay, error status)
- `memory_recall` event
- `system/init.memory_paths` field

**Breaking changes the original report does not flag:**
- v0.2.113: SDK now spawns the **native Claude Code binary** instead of the bundled JS. This affects how a fork like ours that ships its own binary or wraps the CLI is invoked.
- v0.2.113: `options.env` **replaces** `process.env` for subprocess (used to be a merge). Embedders must explicitly overlay: `{...process.env, MY_VAR: "x"}`. Easy to miss → silent regression.
- v0.2.72: `toggleMcpServer` / `reconnectMcpServer` now **error** on unknown server (was silent).
- Sandbox default flipped: `failIfUnavailable` defaults to `true` when `enabled: true`.
- `PostToolUseHookSpecificOutput.updatedMCPToolOutput` is **deprecated** in favor of `updatedToolOutput`.

Source: https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md

### G2. Python SDK has its own surface — and it's behind TS
Original report says "Agent SDK" generically. Python SDK details:
- v0.1.64 (Apr 20): `SessionStore` parity reached (5-method protocol, `InMemorySessionStore`, conformance harness `claude_agent_sdk.testing.run_session_store_conformance`, S3/Redis/Postgres adapters)
- v0.1.65 (Apr 23): `ServerToolUseBlock`, `AdvisorToolResultBlock` content types **were silently dropped before**, fixed; `--thinking-display` CLI option exposed via `ThinkingConfig.display`
- v0.1.67 (Apr 25): trio runtime regression fixed via `sniffio` dispatch (regression introduced v0.1.51 — not mentioned in original report)
- v0.1.71 (Apr 29): `SandboxNetworkConfig` fields `allowedDomains`, `deniedDomains`, `allowManagedDomainsOnly`, `allowMachLookup`
- v0.1.72 (May 1): bumps bundled CLI to **2.1.126**

Source: https://github.com/anthropics/claude-agent-sdk-python/releases

### G3. Versions v2.1.124, v2.1.125, v2.1.126 entirely missing
The original report's window header says "v2.1.86 → v2.1.126" but content stops at v2.1.121 changes. v2.1.122–126 (Apr 28 → May 1) are the most recent week and contain:

- **v2.1.122** (Apr 28): `ANTHROPIC_BEDROCK_SERVICE_TIER` env, `/resume` accepts pasted PR URL to find the creating session, `/mcp` now visualizes claude.ai connectors *shadowed* by manual servers with same URL (mentioned in original under MCP but **without** the "shadowed by URL match" detail), OTEL numeric attrs as numbers, `claude_code.at_mention` event.
- **v2.1.123** (Apr 29): bug fix — OAuth 401 retry-loop when `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`. Original report does not mention this env var at all.
- **v2.1.126** (May 1): `claude project purge [path]` (mentioned in original) but also adds `--dry-run`; `claude_code.skill_activated` gains `invocation_trigger` attribute (not in original); `--dangerously-skip-permissions` extended to bypass writes to **`.claude/skills/`, `.claude/agents/`, `.claude/commands/`** (original lists only `.claude/`, `.git/`, `.vscode/` — incomplete); **security fix**: `allowManagedDomainsOnly` / `allowManagedReadPathsOnly` enforcement was buggy — anyone running fork builds before v2.1.126 with these set was not actually protected.

Source: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md (raw at https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md)

### G4. Hidden env vars from the source-map leak (NOT documented anywhere in original)
The original notes the v2.1.88 source map leak but **does not enumerate the hidden flags it exposed**. From community archaeology of the leak (mculp gist, claudefa.st, claudelab.net):

- `CLAUDE_CODE_SIMPLE` / `CLAUDE_SIMPLE` — bare-mode minimal prompt (very relevant to our token-waste branch — could replace our slim BashTool prompt with the official one)
- `CLAUDE_CODE_DISABLE_THINKING` — kill-switch for thinking
- `DISABLE_INTERLEAVED_THINKING` — flagged Anthropic-internal
- `DISABLE_AUTO_COMPACT` — disables auto-compaction
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY` — disables auto memory updates
- `CLAUDE_CODE_REMOTE_MEMORY_DIR` — points memory store at remote dir
- `CLAUDE_CODE_RESUME_THRESHOLD_MINUTES` (default 70) — resume staleness threshold
- `CLAUDE_CODE_RESUME_TOKEN_THRESHOLD` (default 100000) — resume offers summary above N tokens
- `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` — auto-resume mid-turn
- `CLAUDE_CODE_MAX_CONTEXT_TOKENS` — override context window calc (relevant: original report flags "Claude Code computing 200K instead of Opus 4.7's 1M")
- `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (default 10)
- `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` — autocompact tuning
- `CLAUDE_CODE_PLUGIN_SEED_DIR`, `CLAUDE_CODE_PLUGIN_USE_ZIP_CACHE`, `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE`
- `CLAUDE_CODE_DISABLE_CLAUDE_API_SKILL`, `CLAUDE_CODE_DISABLE_POLICY_SKILLS`
- `CLAUDE_CODE_NO_FLICKER`, `CLAUDE_CODE_DISABLE_MOUSE`, `CLAUDE_CODE_DISABLE_MOUSE_CLICKS`
- `CLAUDE_CODE_GLOB_HIDDEN`, `CLAUDE_CODE_GLOB_NO_IGNORE`
- `CLAUDE_CODE_SHELL_PREFIX` — prefix every Bash invocation
- `CLAUDE_CODE_SIMULATE_PROXY_USAGE`, `CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK`
- `CLAUDE_CODE_AGENT_COST_STEER`, `CLAUDE_CODE_UNATTENDED_RETRY`
- `CLAUDE_CODE_TEAM_ONBOARDING`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_ENTRYPOINT`
- `CLAUDE_CODE_REMOTE_SETTINGS_PATH`
- `CLAUDE_STREAM_IDLE_TIMEOUT_MS` (default 90000)
- `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK`
- `CLAUDE_CODE_DISABLE_FAST_MODE`, `CLAUDE_CODE_DISABLE_CRON`
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_CODE_BRIEF`, `CLAUDE_CODE_ENABLE_CFC`
- `CLAUDE_CODE_USE_ANTHROPIC_AWS`, `CLAUDE_CODE_SKIP_BEDROCK_AUTH`, `CLAUDE_CODE_SKIP_MANTLE_AUTH`
- `CLAUDE_CODE_SANDBOXED` — mark process as sandboxed (affects internal heuristics)
- `CLAUDE_CODE_REMOTE` — CCR container marker
- `CLAUDE_CODE_COORDINATOR_MODE` — agent coordinator role
- `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX`
- `CCR_UPSTREAM_PROXY_ENABLED`
- `CLAUDE_CODE_USE_POWERSHELL_TOOL` — opt into PowerShell tool (was rolling out gradually)
- `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` — disables experimental beta features (caused OAuth bug fixed in v2.1.123)
- `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` — opt-in session-state events from SDK
- `CLAUDE_CODE_ENABLE_TASKS=true` — opt-in to new task system (required for `agentProgressSummaries`)
- `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` — load `CLAUDE.md` from extra dirs
- `AI_AGENT` — set on subprocess so child tools know they're in an agent context
- `OTEL_LOG_RAW_API_BODIES`, `OTEL_LOG_USER_PROMPTS` — privacy-relevant; original mentions these but does not flag the privacy impact

Source: https://gist.github.com/mculp/e6a573f2a45ef7dbbf30f6a8574c7351 ; https://claudelab.net/en/articles/claude-code/claude-code-sourcemap-kairos-internal-architecture

### G5. Slash commands missing from original
The original lists `/loop` but does not describe its behavior. New ones not listed at all:
- **`/dream`** — manual memory consolidation; deduplicates notes, removes stale entries (the public-build counterpart of the gated KAIROS auto-dream cron)
- **`/babysit-prs`** — referenced in `/loop` examples; watch-and-react PR loop
- **`/less-permission-prompts`** — scans transcripts and proposes a read-only allowlist for `.claude/settings.json` (this fork has a similar `fewer-permission-prompts` skill — confirm we are not duplicating)
- **`/theme`** — interactive theme picker; supports plugin-shipped themes
- **`/config`** persistence — settings now persist to `~/.claude/settings.json` with project/local/policy precedence
- **`claude ultrareview [target]`** — non-interactive CLI subcommand (different from `/ultrareview` slash command which is the interactive multi-agent cloud review). The original conflates them.
- **`/mcp`** "shadowed connector" diagnostic — original only says "shows shadowed connectors"; the precise rule is "shadowed when a manual server has the same URL as a claude.ai connector"

### G6. Hook events the original does not list
Beyond what original §1.2 covers:
- `ConfigChange` (Agent SDK)
- `TeammateIdle`
- `TaskCompleted`
- `hook_started` / `hook_progress` / `hook_response` (lifecycle events for hooks themselves, gated behind `includeHookEvents`)
- `api_retry` system message — usable for telemetry on rate-limit retry storms

### G7. Beta headers (`anthropic-beta`)
Original says nothing about beta-header surface area. Active or recently-changed beta tokens:
- `context-1m-2025-08-07` — **retired April 30, 2026** for Sonnet 4.5 / Sonnet 4. Sonnet 4.6 / Opus 4.6+ have 1M natively, no header. **A fork that hardcodes this header on Sonnet 4.5 silently breaks May 1+.**
- `interleaved-thinking-2025-05-14` — still required for non-Opus-4.7 models; Opus 4.7 enables it automatically with adaptive thinking
- `fine-grained-tool-streaming-2025-05-14` — **GA, header now no-op** (was beta)

Source: https://platform.claude.com/docs/en/release-notes/overview ; https://pasqualepillitteri.it/en/news/1451/anthropic-1m-context-beta-retirement-april-30-2026

### G8. Native binary distribution treated as "skip"
Original tier-tagged this 🔴 Skip. Worth reconsidering one piece: **native builds bundle `bfs` (find replacement) and `ugrep` and replace the JS Glob/Grep tools**. Even if we skip the binary distribution, those are independently useful for performance — our fork still uses the JS implementations.

### G9. Cache-creation regression has a real cost number now
Original mentions issue #46917 but no magnitude. Community measurements: ~20K extra `cache_creation` tokens per request vs v2.1.98 baseline. Combined with the Opus 4.7 1.0–1.35× inflation, real users report 40–60% real-world cost increase between v2.1.98 + Opus 4.6 and v2.1.121 + Opus 4.7.

### G10. The April 23 postmortem has a third bug the original under-emphasizes
Original §2 lists "three overlapping bugs" but only names two precisely. The full triple per the postmortem and Fortune's analysis:
1. Mar 4: default effort `high → medium` (latency optimization)
2. Mar 26: thinking-cache clearing every turn (idle-cleanup bug)
3. Apr 16: 25-word verbosity constraint between tool calls (prompt edit)
Rolled back in **v2.1.116** (Apr 20). Anyone reading the original might think only #1 and #2 mattered.

Source: https://fortune.com/2026/04/24/anthropic-engineering-missteps-claude-code-performance-decline-user-backlash/

---

## VERY RECENT (last 14 days, Apr 19 → May 3 2026)

| Date | Version | What |
|---|---|---|
| Apr 20 | 2.1.116 | Rollback of the three-bug regression. Reset usage limits. |
| Apr 22 | 2.1.117? | `CLAUDE_CODE_FORK_SUBAGENT=1` enables fork-subagents on external builds. `/model` selections persist across restarts. `/resume` offers to summarize stale large sessions. |
| Apr 23 | — | Anthropic engineering postmortem published. |
| Apr 25 | 2.1.119 | Various stability. |
| Apr 27 | — | Week-17 digest: `/ultrareview` public preview; session recap; custom themes via plugins; web redesign with sessions sidebar. |
| Apr 28 | 2.1.122 | `ANTHROPIC_BEDROCK_SERVICE_TIER`; `/resume` PR-URL search; OTEL numeric attrs as numbers; `claude_code.at_mention`. |
| Apr 28 | 2.1.122 | Python SDK 0.1.69 — adds field docstrings for IDE autocomplete. |
| Apr 29 | 2.1.123 | OAuth 401 retry-loop fix when `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`. Python SDK 0.1.71 — `SandboxNetworkConfig` domain allowlist parity. |
| Apr 30 | — | **`context-1m-2025-08-07` beta header retired** for Sonnet 4 / 4.5. Silent breakage risk. |
| May 1  | 2.1.126 | `claude project purge --dry-run`; `claude_code.skill_activated.invocation_trigger`; **security fix** for `allowManagedDomainsOnly` / `allowManagedReadPathsOnly`; `--dangerously-skip-permissions` extends bypass to `.claude/skills/`, `.claude/agents/`, `.claude/commands/`. Python SDK 0.1.72 bundles this CLI. |
| May 1+ | — | Reports that `/model` picker on `ANTHROPIC_BASE_URL` gateways now lists `/v1/models` results — **directly affects our multi-model router**. |

Sources:
- https://code.claude.com/docs/en/whats-new
- https://github.com/anthropics/claude-agent-sdk-python/releases
- https://releasebot.io/updates/anthropic/claude-code

---

## Hidden env vars / beta headers / feature flags

See **G4** above for the full enumerated env-var list. Critical ones the fork should explicitly decide on:

| Variable | Default | Why we care |
|---|---|---|
| `CLAUDE_CODE_SIMPLE` / `CLAUDE_SIMPLE` | unset | Built-in minimal prompt — could replace our hand-rolled slim BashTool prompt |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | model-derived | Override needed if we want to pin Opus 4.7 to 1M instead of 200K |
| `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` | 10 | Local model loops; lower = fewer runaway tool calls |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | ~85% | Tune for our local models that handle long context worse |
| `CLAUDE_STREAM_IDLE_TIMEOUT_MS` | 90000 | Local-model long thinking pauses; raise to avoid false drops |
| `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK` | unset | If our local server doesn't support non-streaming fallback, set this |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | unset | If we want full control over MEMORY.md |
| `CLAUDE_CODE_ENABLE_TASKS=true` | unset | Required to use `agentProgressSummaries` SDK option |
| `CLAUDE_CODE_FORK_SUBAGENT=1` | unset | Enables fork-subagent on external/forked builds |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` | unset | Disables all `anthropic-beta` headers in flight (use to dodge churn like the 1M retirement) |
| `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` | unset | Hook visibility |
| `AI_AGENT` (env *set by* CLI on children) | — | Tools downstream can detect agent context; we should set this for parity |
| `DISABLE_UPDATES` | unset | Stricter than `DISABLE_AUTOUPDATER` — also blocks plugin/marketplace refreshes |

Active beta headers:
- `interleaved-thinking-2025-05-14` (still needed off Opus 4.7)
- `context-1m-2025-08-07` (retired Sonnet 4/4.5, no-op there now)
- `fine-grained-tool-streaming-2025-05-14` (GA, no-op)

Sources: https://gist.github.com/mculp/e6a573f2a45ef7dbbf30f6a8574c7351 ; https://platform.claude.com/docs/en/release-notes/overview

---

## Agent SDK specific

**Critical for this fork because we wrap the SDK lifecycle.** Original report has 7 SDK bullets; here are the deltas:

1. **`startup()` pre-warm** (~20× first-query speedup) — port to our cold-start path.
2. **`getContextUsage()`** — perfect input for our model-router decisions; we currently estimate, this is authoritative.
3. **`taskBudget`** — replaces our ad-hoc budget enforcement; should adopt or align our token-waste branch with it.
4. **`agentProgressSummaries` + `task_progress.summary`** — useful for surfacing long-running gemma4-heretic background tasks.
5. **`forwardSubagentText`** — currently we don't stream subagent deltas; users get nothing until subagent finishes.
6. **`canUseTool()`** — proper permission-checking method; we have a custom wrapper that may now diverge from upstream semantics.
7. **`SessionStore` protocol + reference adapters (S3 / Redis / Postgres)** — relevant if we want session persistence outside `~/.claude/`.
8. **`includeHookEvents` + `hook_started`/`hook_progress`/`hook_response`** — lifecycle visibility into hooks themselves; we could surface hook latency in our status line.
9. **`api_retry` system message** — exposes attempt count / delay / error; pair with our exponential-backoff fix for accurate telemetry.
10. **Breaking: `options.env` no longer merges with `process.env`** — if our launcher passes an explicit `env` it now drops everything else. Audit our `run.sh` and Python entry points.
11. **Breaking: SDK now spawns native binary** — if we ship a custom JS bundle, we need to either disable that or keep using subprocess-via-node explicitly.
12. **`SDKMirrorErrorMessage`** — mandatory handling if we ever enable `sessionStore`.
13. **Sandbox `failIfUnavailable` default flipped to `true`** — silent breakage on hosts where sandbox can't init.

Sources:
- https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md
- https://github.com/anthropics/claude-agent-sdk-python/releases
- https://platform.claude.com/docs/en/agent-sdk/overview

---

## JetBrains / VS Code extension specific

Largely missing from original (no IDE-extension section).

**JetBrains plugin (Beta, marketplace ID 27310):**
- IntelliJ 2026's new devcontainer architecture **breaks integration**: no JetBrains backend runs inside the container, so no lock file lands at `~/.claude/ide/`, and Claude Code can't discover the IDE. Tracked at https://github.com/anthropics/claude-code/issues/42774. **Direct hit** for any user trying our fork inside a 2026-vintage IntelliJ devcontainer.
- External-editor-context option: `Ctrl+G` external editor can now show Claude's last response as a comment.
- `/plugin` Installed-tab sort: surfaces items needing attention + favorites at top; `f` favorites the selected item.
- Diff viewing, selection-share, file-reference shortcut, diagnostic-share.

**VS Code extension (`anthropic.claude-code`):**
- Apr 28: improved fullscreen scrolling specifically for VS Code / Cursor / Windsurf integrated terminals.
- Apr 29: OAuth 401 retry-loop fix overlaps with the CLI v2.1.123 fix.
- "Auto (match terminal)" theme syncs with VS Code's dark/light setting.

Sources:
- https://plugins.jetbrains.com/plugin/27310-claude-code-beta-
- https://github.com/anthropics/claude-code/issues/42774
- https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code

---

## Anti-features to NOT replicate

Beyond what the original §2 lists:

1. **Verbosity constraint between tool calls (Apr 16)** — concretely: "respond in ≤25 words between tool calls". Don't bake any equivalent into our system prompts.
2. **`options.env` overwrites `process.env`** behavior (SDK v0.2.113) — don't mirror this in any SDK wrapper we build; it's a footgun.
3. **Session-cache clearing every turn (Mar 26)** — the bug was an over-aggressive idle-cleanup running on the *active* session. Our `--continue` flow must not adopt similar logic.
4. **Default effort silent downgrade (Mar 4)** — never silently change effort/model defaults under user.
5. **`fine-grained-tool-streaming-2025-05-14` still being sent as a beta header after GA** — don't ship dead headers; bloats requests.
6. **`context-1m` header on Sonnet 4 / 4.5 post-Apr-30** — confirmed no-op; will silently truncate at 200K. Audit any hardcoded model+header pair.
7. **Sandbox `failIfUnavailable=true` default** — surprise hard-fail; we should explicitly set false unless user opted in.
8. **Cache-creation inflation v2.1.100+ (#46917)** — original mentions; *avoid the underlying change*: per-turn re-stringification of MCP tool schemas as part of the cache key. Our MCP compaction should ensure schema bytes are stable across turns.
9. **Pulling Claude Code from $20 Pro tier (Apr 21–22)** — not applicable to our fork but a UX lesson: never silently revoke entitlements.
10. **Source map shipping in npm package (v2.1.88)** — verify our `package.json`/build excludes `.map` files before publish.

---

## Sources

- Official CHANGELOG (raw): https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md
- TypeScript SDK changelog: https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md
- Python SDK releases: https://github.com/anthropics/claude-agent-sdk-python/releases
- What's New weekly digest: https://code.claude.com/docs/en/whats-new
- Releasebot Anthropic feed: https://releasebot.io/updates/anthropic/claude-code
- Env var gist (mculp): https://gist.github.com/mculp/e6a573f2a45ef7dbbf30f6a8574c7351
- Source-leak archaeology (claudelab): https://claudelab.net/en/articles/claude-code/claude-code-sourcemap-kairos-internal-architecture
- KAIROS / hidden features (wavespeed): https://wavespeed.ai/blog/posts/claude-code-leaked-source-hidden-features/
- KAIROS dream/cron module: https://github.com/yitianlian/claude-code-hidden-features/blob/main/src/content/docs/03-kairos-dream-cron.mdx
- 1M context retirement notice: https://pasqualepillitteri.it/en/news/1451/anthropic-1m-context-beta-retirement-april-30-2026
- Beta headers reference: https://platform.claude.com/docs/en/release-notes/overview
- April 23 postmortem: https://www.anthropic.com/engineering/april-23-postmortem
- Fortune analysis (third bug detail): https://fortune.com/2026/04/24/anthropic-engineering-missteps-claude-code-performance-decline-user-backlash/
- AMD/Laurenzo regression issue (#42796): https://github.com/anthropics/claude-code/issues/42796
- Opus regression issue (#49244): https://github.com/anthropics/claude-code/issues/49244
- JetBrains 2026 devcontainer break (#42774): https://github.com/anthropics/claude-code/issues/42774
- JetBrains plugin marketplace: https://plugins.jetbrains.com/plugin/27310-claude-code-beta-
- VS Code extension: https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code
- Cache-creation regression (#46917): https://github.com/anthropics/claude-code/issues/46917
- Secret commands writeup: https://www.sabrina.dev/p/secret-commands-for-claude-code
- 12 hidden CLI commands (clskillshub): https://clskillshub.com/blog/claude-code-secret-commands-cli
