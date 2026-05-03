# Upstream Claude Code Catch-up Report — Feb–May 2026

**Date compiled:** 2026-05-03
**Window:** ~Feb 1 2026 → May 1 2026 (v2.1.86 → v2.1.126, ~40 releases)
**Sources:** Official CHANGELOG, GitHub releases & issues, Anthropic blog/news, docs.claude.com, code.claude.com weekly digests, Reddit (r/ClaudeCode, r/ClaudeAI, r/LocalLLaMA), Hacker News, Anthropic engineering postmortem (Apr 23), independent reviews.

This is a **report, not a plan**. Items are categorized against this fork's customizations (local model routing via gemma4-heretic, multi-model router, custom BashTool prompt, MCP compaction, system-reminder stripping, token-waste fixes).

---

## Quick verdict — what's worth porting

| Tier | Item | Why |
|---|---|---|
| 🟢 Port | 1-hour prompt cache TTL (`ENABLE_PROMPT_CACHING_1H`) | Direct token-cost win, aligns with our token-waste branch |
| 🟢 Port | MCP tool description 2KB cap + concurrent server connect | Same intent as our MCP compaction work |
| 🟢 Port | Bash deny-rule hardening (matches `env`/`sudo`/`watch`; `find -exec` fix) | Security; cheap to lift |
| 🟢 Port | `/usage` (merged `/cost`+`/stats`) with cache-hit breakdown | Visibility into what our router is spending |
| 🟢 Port | `EnterWorktree path:` arg + `PreCompact` hook block decision | Cleanly extends our hooks model |
| 🟢 Port | `MEMORY.md` index 25KB / 200-line truncation | Already partially in our CLAUDE.md spec |
| 🟢 Port | Stream idle timeout fixes (Mac sleep, long thinking pauses) | We've hit this with local models |
| 🟢 Port | Edit tool: shorter `old_string` anchors → fewer output tokens | Token waste reduction |
| 🟢 Port | `@`-mentioned files no longer JSON-escaped | Token waste reduction |
| 🟡 Adapt | Auto Mode (permission classifier) | Useful concept, but our permission flow differs |
| 🟡 Adapt | `xhigh` effort + `/effort` slider | Re-map onto our multi-model router (effort → model picker) |
| 🟡 Adapt | Hooks: `mcp_tool` type, `if` filter, `PermissionDenied`, `PostToolUseFailure`, `duration_ms` | Need to fit our hook dispatcher |
| 🟡 Adapt | `alwaysLoad` MCP option + ToolSearch deferral integration | Our MCP layer is custom; design first |
| 🔴 Skip | `/ultrareview`, `/ultraplan` | Cloud-side multi-agent service, no local equivalent |
| 🔴 Skip | Routines (cron remote agents) | Cloud feature |
| 🔴 Skip | Native binary distribution (v2.1.113) | Big infra change, not aligned with our fork |
| 🔴 Skip | Computer use in CLI | Research preview, brittle |
| 🔴 Skip | Push notifications, Remote Control / claude.ai bridge | Cloud-only |
| ⚠ Investigate | Opus 4.7 token inflation 1.0–1.35× vs 4.6 | Affects our routing math; benchmark before changing defaults |
| ⚠ Investigate | Cache-creation regression in v2.1.100+ (issue #46917) | Avoid replicating |

---

## 1. Features by category

### 1.1 Token / cost / cache
- **`ENABLE_PROMPT_CACHING_1H`** — 1h TTL cache opt-in (v2.1.108). Big win for long sessions; pairs with `FORCE_PROMPT_CACHING_5M`.
- **Edit tool**: shorter `old_string` anchors reduce output tokens.
- **`@`-mentioned files no longer JSON-escaped** — straight token reduction.
- **MCP**: tool schemas no longer re-stringified per-turn for cache key; SSE transport linear (was quadratic on large frames); 2KB cap on tool descriptions.
- **Skill listing cap raised** 250 → 1,536 chars.
- **Status line** cached per-session, refreshes on `refreshInterval`.
- **WebFetch** ~5× faster on large pages; strips `<style>`/`<script>` before HTML→markdown.
- **Startup**: ~18MB memory shaved; LSP grammars on demand (~80MB on huge repos); concurrent MCP startup.
- **Memory leaks fixed (v2.1.121)**: image-heavy sessions unbounded RSS, `/usage` 2GB leak, long-running tool failure leak.
- **Compaction**: thrash-loop detection stops burning API; `/compact` fails cleanly when request itself oversized; nested CLAUDE.md re-injection bug fixed.
- **Rate-limit retries**: exponential backoff is now a *minimum* (was burning 13s).

### 1.2 Hooks
- New events: `PreCompact` (blockable), `PermissionDenied`, `PostToolUseFailure` (with `duration_ms`), `TaskCreated`, `SubagentStop`, `StopFailure`, `CwdChanged`, `FileChanged`, `Setup`, `InstructionsLoaded`, `WorktreeCreate/Remove`, `Elicitation/ElicitationResult`.
- New hook **types**: `mcp_tool`, `prompt`, `agent`, `http` (alongside `command`).
- **`if` field** with permission-rule syntax filters hook execution.
- **PreToolUse `defer`** decision — hands control to external UI; useful for SDK consumers.
- **PostToolUse `updatedToolOutput`** for *all* tools (was MCP-only).
- **Async hooks** (`async`, `asyncRewake`).
- **`disableAllHooks`** master toggle.
- **Plugin `monitors` manifest key** — auto-armed background watchers.
- **Malformed hooks entry no longer invalidates entire `settings.json`**.

### 1.3 MCP
- **`alwaysLoad`** — eager connect at session start, bypass deferral.
- **Per-tool result-size override up to 500K** via `_meta["anthropic/maxResultSizeChars"]`.
- **OAuth**: RFC 9728 Protected Resource Metadata discovery; CIMD/SEP-991 client metadata; client_secret_post on token exchange.
- **Concurrent connections at startup**, parallel reconfig in subagents.
- **`headersHelper`** scripts get `CLAUDE_CODE_MCP_SERVER_NAME`/`URL` env.
- **`${ENV_VAR}` substitution in headers** (v2.1.121).
- **Transient startup errors auto-retry 3×**.
- **MCP `elicitation/create`** events flow through hook lifecycle.
- **`/mcp` shows shadowed connectors**; ToolSearch picks up MCP tools that connect mid-session.
- **`deniedMcpServers`** managed setting.
- **Esc during stdio MCP call** no longer kills entire server (regression in v2.1.105 fixed in v2.1.120).

### 1.4 Slash commands / skills
- **Skills** are the new canonical customization unit (`.claude/skills/<name>/SKILL.md`); commands still work.
- New: `/usage` (replaces `/cost`+`/stats`), `/effort`, `/focus`, `/tui`, `/recap`, `/team-onboarding`, `/autofix-pr`, `/loop`, `/branch`, `/rewind` (alias `/undo`), `/ultrareview`, `/ultraplan`, `/powerup`, `/copy N`, `/release-notes`.
- **Skill frontmatter** new fields: `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `effort`, `context: fork|agent`, `hooks`, `paths` (glob autoload), `shell: bash|powershell`, `keep-coding-instructions`.
- **Template vars**: `${CLAUDE_SKILL_DIR}`, `${CLAUDE_EFFORT}`, `${CLAUDE_SESSION_ID}`, `$ARGUMENTS[N]`/`$N`.
- **Live reload** of skill files mid-session.
- **`Skill(name)` / `Skill(name *)` permission rules**.
- **Built-in commands** invokable from Skill tool (`/init`, `/review`, `/security-review`).

### 1.5 Permissions / settings
- **Auto Mode** GA (no longer requires `--enable-auto-mode`).
- **`--dangerously-skip-permissions`** now bypasses `.claude/`, `.git/`, `.vscode/`, shell config writes (catastrophic `rm` still prompts).
- **`sandbox.network.deniedDomains`** — block specific domains under wildcard allow.
- **`sandbox.failIfUnavailable`** — exit if sandbox can't start.
- **`disableSkillShellExecution`** — block inline shell in skills.
- **`additionalDirectories`** changes apply mid-session.
- **`permissions.deny` now defended against PreToolUse downgrade** (security fix).
- **`managed-settings.d/`** drop-in directory for policy fragments.
- **`forceRemoteSettingsRefresh`** policy: fail-closed on fetch failure.
- **`blockedMarketplaces`** with `hostPattern`/`pathPattern`.
- New env: `DISABLE_UPDATES`, `CLAUDE_CODE_HIDE_CWD`, `CLAUDE_CODE_PERFORCE_MODE`, `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, `CLAUDE_CODE_SCRIPT_CAPS`, `CLAUDE_CODE_FORK_SUBAGENT`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_MANTLE`.

### 1.6 Bash tool
- **Deny rules now match wrappers**: `env`, `sudo`, `watch`, `ionice`, `setsid`.
- **`Bash(find:*)` no longer auto-approves `-exec` / `-delete`**.
- Backslash-escaped flag bypass **fixed (security)**.
- Compound bash bypassing forced prompts in auto/bypass modes **fixed**.
- `/dev/tcp` redirects no longer auto-allowed.
- `cd <project-dir> &&` auto-approved (no-op).
- Read-only commands with glob (`ls *.ts`) no longer prompt.
- `grep -f FILE` / `rg -f FILE` prompt for patterns outside cwd.
- Multiline comments shown in full (UI-spoof fix).
- `find` FD exhaustion fixed (was crashing systems).
- macOS `/private/{etc,var,tmp,home}` treated as dangerous.
- W3C `TRACEPARENT` env var when OTEL tracing enabled.

### 1.7 Models / effort
- **Opus 4.7** with new `xhigh` effort (between high and max). ~71% MRCR v2.
- **Default effort raised to `high`** for Pro/Max/Bedrock/Vertex.
- **`/effort` slider** with arrow nav.
- **`${CLAUDE_EFFORT}`** env var for skills.
- **Gateway `/v1/models`** picker when `ANTHROPIC_BASE_URL` set.
- **`ANTHROPIC_DEFAULT_*_MODEL_NAME`/`_DESCRIPTION`** + **`ANTHROPIC_CUSTOM_MODEL_OPTION`** for custom `/model` entries.
- **Bedrock**: `ANTHROPIC_BEDROCK_SERVICE_TIER` (default/flex/priority); Mantle support.
- **Vertex AI**: X.509 WIF (mTLS ADC); interactive setup wizard.
- ⚠ **Opus 4.7 token inflation 1.0–1.35× vs 4.6** — observed ~40% real-world cost increase.

### 1.8 SDK / subagents
- **Forked subagents** (`CLAUDE_CODE_FORK_SUBAGENT=1`).
- **Agent tool accepts any model string**.
- **Agent frontmatter**: `mcpServers` for main thread, `initialPrompt` auto-submits, `tools`/`disallowedTools`/`permissionMode` honored in `--print`.
- **`isolation: "worktree"`** doesn't leak cwd to parent.
- **`--mcp-config`** servers honored in subagents.
- **Async PostToolUse no-response** no longer writes empty transcript entries.
- **Agent SDK hang on malformed parallel tool call names** fixed.

### 1.9 Auth / OAuth
- **OAuth code paste** in terminal for WSL2/SSH/containers.
- **OAuth refresh on 401** in plain CLI sessions.
- **macOS keychain race on concurrent MCP token refresh** fixed.
- **Bedrock SigV4** no longer breaks with Authorization header set.
- **`--console`** flag for API-key auth via Anthropic Console.
- **OS CA cert store** trusted by default for enterprise TLS proxies.

### 1.10 TUI / rendering
- **`/tui fullscreen`** flicker-free alt-screen mode.
- **Vim visual + visual-line modes** (`v`, `V`).
- **Thinking spinner** with progress hints.
- **Focus view toggle** (`Ctrl+O`).
- **Streaming line-by-line** (was buffered).
- **Custom themes** (`themes/` plugin dir).
- **Image paste** inserts `[Image #N]` chip; auto-downscale to 2000px; oversized history auto-cleaned.
- **Scrollback duplication** on Ctrl+L / redraw across tmux/GNOME/WT/Konsole **fixed**.
- **CJK / Devanagari / Indic** column alignment fixed.
- Dialogs scrollable with arrow keys, mouse wheel.
- Long URL OSC 8 hyperlinks stay clickable when wrapped.
- Slash menu fuzzy search with substring highlighting; `/skills` filter box.

### 1.11 Sessions / resume / workspace
- **`/resume` 67% faster** on 40MB+ sessions; default to current dir, `Ctrl+A` for all.
- **`--from-pr`** accepts GitHub Enterprise / GitLab MR / Bitbucket PR URLs.
- **`--continue`/`--resume` resurrects scheduled tasks**.
- **Transcript chain-break detection** prevents history loss.
- **`.husky` protected** in acceptEdits.
- **`.jj` / `.sl` excluded** from Grep / autocomplete (Jujutsu, Sapling).
- **Partial-clone repos** (Scalar/GVFS) no longer trigger mass blob downloads.
- **`claude project purge`** — wipes all project state.

### 1.12 Plugins
- `claude plugin prune` — remove orphaned auto-installed deps.
- `claude plugin tag` — release tags with version validation.
- `claude plugin validate` accepts `$schema`/`version`/`description`.
- Marketplace plugins: dependency cascade on install/uninstall.
- Plugin options: sensitive values in macOS keychain.
- Plugin `bin/` executables callable as bare commands.
- Plugin frontmatter hooks no longer silently ignored.

### 1.13 Observability
- OTEL: numeric attrs as numbers; `effort.level` / `thinking.enabled` / `rate_limits` in status-line stdin; `tool_use_id`, `tool_input_size_bytes`, `stop_reason`, `gen_ai.response.finish_reasons`; `command_name`/`command_source`; `OTEL_LOG_RAW_API_BODIES` for full bodies; `OTEL_LOG_USER_PROMPTS` for user prompts; W3C TRACEPARENT in Bash.
- `claude_code.skill_activated`, `claude_code.at_mention` events.
- Headless `--output-format stream-json` includes `plugin_errors` on init.

### 1.14 Windows
- **PowerShell tool** (preview) — clipboard no longer leaks via process args; >22KB selections work.
- **Git Bash no longer required**; PowerShell fallback; PS7 from MS Store / MSI / .NET global tool detected.
- **CRLF doubling fixed** in Write tool.
- **Ctrl+Backspace** word delete.
- Drive-letter paths root-anchored; case-insensitive path match.
- Headless PowerShell respects WSL2 inherited Windows policy.

---

## 2. Notable regressions / community pain (avoid replicating)

1. **Six-Week Quality Slide (Mar 4 – Apr 23)** — three overlapping bugs hammered users: silent effort downgrade `high→medium`, thinking-cache clearing every turn, 25-word verbosity constraint between tool calls. Postmortem: https://www.anthropic.com/engineering/april-23-postmortem.
2. **Pro-plan removal flap (Apr 21–22)** — Claude Code briefly pulled from $20 Pro tier; reversed in 24h. Trust damage > policy.
3. **Source map leak (v2.1.88, Mar 31)** — 59.8 MB source map shipped in npm. ~512K LoC exposed (incl. unreleased "KAIROS" mode). HN: #47609294.
4. **Cache-creation regression v2.1.100+** — issue [#46917](https://github.com/anthropics/claude-code/issues/46917): inflates `cache_creation` by ~20K tokens vs v2.1.98 with same payload server-side.
5. **Opus 4.7 token inflation** — 1.0–1.35× vs 4.6.
6. **Third-party harness restriction (Apr 4)** — OpenClaw/Cline/Aider require separate API billing on subscription accounts. Drove the "switch to local" wave.

## 3. Top open community issues (pain points worth solving in our fork)

| # | Issue | 👍 | Note |
|---|---|---|---|
| 1 | [#6235 Support `AGENTS.md`](https://github.com/anthropics/claude-code/issues/6235) | 3777 | Cross-tool memory standard |
| 3 | [#16157 Instantly hitting usage limits with Max](https://github.com/anthropics/claude-code/issues/16157) | 689 | Aligns with our token-waste branch |
| 4 | [#826 Console scrolling top of history](https://github.com/anthropics/claude-code/issues/826) | 685 | TUI |
| 6 | [#1455 Doesn't respect XDG Base Directory](https://github.com/anthropics/claude-code/issues/1455) | 345 | Linux config hygiene |
| 9 | [#1913 Terminal flickering](https://github.com/anthropics/claude-code/issues/1913) | 316 | Mostly addressed by `/tui` |
| 14 | [#1547 IME input perf issues](https://github.com/anthropics/claude-code/issues/1547) | 241 | i18n latency |
| — | [#46917 v2.1.100+ cache_creation inflation](https://github.com/anthropics/claude-code/issues/46917) | 207 | Avoid replicating |
| — | [#28240 `cd` in compound bash falsely prompts](https://github.com/anthropics/claude-code/issues/28240) | 169 | Partly fixed in v2.1.113 |
| — | [#16561 Parse compound Bash and match each component](https://github.com/anthropics/claude-code/issues/16561) | 146 | Security parser |

---

## 4. Recommended porting plan

**Phase 1 — Token/cost wins (aligned with current branch):**
1. Backport `ENABLE_PROMPT_CACHING_1H` semantics into our cache layer.
2. Strip JSON-escaping on `@`-mentioned files.
3. Cap MCP tool descriptions at 2KB; concurrent MCP startup; SSE linear-time framing.
4. Edit tool: shorter `old_string` anchors.
5. Fix any cache-creation regression analogous to #46917.

**Phase 2 — Security parity:**
6. Bash deny-rule wrappers (`env`/`sudo`/`watch`).
7. `find -exec`/`-delete` not auto-approved by `Bash(find:*)`.
8. Compound-bash bypass + backslash-escape bypass.
9. `permissions.deny` not downgradable by PreToolUse.

**Phase 3 — Hooks expansion:**
10. `PreCompact` blocking, `PermissionDenied`, `PostToolUseFailure` with `duration_ms`.
11. `mcp_tool` hook type with `${tool_input.…}` substitution.
12. `if` filter using permission-rule syntax.
13. Malformed hook entry doesn't poison entire settings.

**Phase 4 — Visibility:**
14. Merge `/cost` + `/stats` into `/usage` with cache-hit + per-model breakdown.
15. Status-line `effort.level`/`thinking.enabled`/`rate_limits` stdin fields.

**Phase 5 — Adapt to multi-model router:**
16. Re-purpose `/effort` slider to drive our model-router thresholds.
17. Map `xhigh` semantically onto our gemma4-heretic / Opus tier thresholds.
18. Decide: Auto Mode classifier — port concept or keep our existing flow.

**Skip entirely:** `/ultrareview`, `/ultraplan`, Routines, Push notifications, Remote Control, Native binaries, Computer Use, Claude Buddy.

---

## 5. Sources

- CHANGELOG: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- Releases: https://github.com/anthropics/claude-code/releases
- What's New digests: https://code.claude.com/docs/en/whats-new
- Anthropic postmortem (Apr 23): https://www.anthropic.com/engineering/april-23-postmortem
- Opus 4.7 announcement: https://www.anthropic.com/news/claude-opus-4-7
- Opus 4.6 announcement: https://www.anthropic.com/news/claude-opus-4-6
- Agent SDK: https://docs.claude.com/en/docs/agent-sdk/overview
- HN: "Is Claude Code getting worse?" #47936579 · Pro removal #47855832 · Source leak #47609294
- yurukusa six-week timeline: https://gist.github.com/yurukusa/d66ffbe472df1231b59445f26fd25da9
- boringbot Opus 4.7 review: https://boringbot.substack.com/p/claude-opus-47-heres-what-works-and
