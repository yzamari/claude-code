# Claude Code Architecture

> Comprehensive architecture reference for the Claude Code codebase.

---

## Project Overview

Claude Code is a **terminal-native AI coding assistant** built by Anthropic, shipped as a
single-binary CLI powered by the [Bun](https://bun.sh) runtime. It provides an interactive
REPL where developers converse with an LLM that can read files, write code, run shell
commands, search the web, and invoke 40+ tools -- all rendered in a reactive terminal UI
built with **React + Ink**.

The codebase also includes a **Next.js web frontend** (`web/`), a **backend API server**
(`src/server/`) with Drizzle ORM, a **standalone MCP server** (`mcp-server/`), and a
**multi-model routing system** that can dispatch tasks to Claude, Gemini, OpenAI, and
local Ollama models.

---

## High-Level Architecture Diagram

```
+-------------------------------------------------------------------------+
|                          User Interfaces                                |
|                                                                         |
|  +-------------------+   +------------------+   +--------------------+  |
|  |  Terminal REPL     |   |  Web Frontend    |   |  IDE Bridge        |  |
|  |  (React + Ink)     |   |  (Next.js)       |   |  (VS Code, etc.)  |  |
|  +--------+----------+   +--------+---------+   +--------+-----------+  |
|           |                       |                       |             |
+-----------+-----------------------+-----------------------+-------------+
            |                       |                       |
            v                       v                       v
+-------------------------------------------------------------------------+
|                        Core Engine Layer                                 |
|                                                                         |
|  +--------------------+   +-------------------+   +-----------------+   |
|  |  CLI Entrypoint    |   |  Query Engine     |   |  State Manager  |   |
|  |  (Commander.js)    |   |  (query.ts)       |   |  (AppState)     |   |
|  +--------+-----------+   +--------+----------+   +-----------------+   |
|           |                        |                                    |
|           v                        v                                    |
|  +--------------------+   +-------------------+                         |
|  |  Command System    |   |  Tool System      |                         |
|  |  (103 commands)    |   |  (40+ tools)      |                         |
|  +--------------------+   +-------------------+                         |
+-------------------------------|-------------------------------------+---+
                                |
                                v
+-------------------------------------------------------------------------+
|                     Multi-Model Router                                  |
|                                                                         |
|  +------------------+   +-------------------+   +-------------------+   |
|  | Task Classifier  |   |  Model Router     |   | Capabilities DB   |   |
|  | (heuristic)      |-->|  (route table)    |-->| (per-model caps)  |   |
|  +------------------+   +---------+---------+   +-------------------+   |
|                                   |                                     |
|             +---------------------+---------------------+               |
|             |                     |                     |               |
|             v                     v                     v               |
|  +------------------+  +-------------------+  +-------------------+     |
|  | Anthropic SDK    |  | OpenAI-Compatible |  | Gemini Adapter    |     |
|  | (native)         |  | Stream Client     |  | (OpenAI-compat)   |     |
|  +------------------+  +-------------------+  +-------------------+     |
|                                   |                                     |
|                                   v                                     |
|                        +-------------------+                            |
|                        | Stream Translator |                            |
|                        | (OpenAI -> Anthro)|                            |
|                        +-------------------+                            |
|                                                                         |
|  +--------------------------------------------------------------------+ |
|  |  Fallback Executor -- retries failed calls through fallback chain  | |
|  +--------------------------------------------------------------------+ |
+-------------------------------------------------------------------------+
                                |
                                v
+-------------------------------------------------------------------------+
|                     Supporting Services                                  |
|                                                                         |
|  +------------+  +----------+  +-----------+  +----------+  +---------+ |
|  | MCP Client |  | Skills   |  | Plugins   |  | Bridge   |  | Buddy   | |
|  | Manager    |  | System   |  | System    |  | (IDE)    |  | System  | |
|  +------------+  +----------+  +-----------+  +----------+  +---------+ |
|                                                                         |
|  +------------+  +----------+  +-----------+  +----------+  +---------+ |
|  | Analytics  |  | Compact  |  | Voice     |  | OAuth    |  | Session | |
|  | (OTel/GB)  |  | Service  |  | (STT)     |  | Service  |  | Memory  | |
|  +------------+  +----------+  +-----------+  +----------+  +---------+ |
+-------------------------------------------------------------------------+
                                |
                                v
+-------------------------------------------------------------------------+
|                     Backend & Persistence                                |
|                                                                         |
|  +------------------------+   +------------------+   +--------------+   |
|  | Server API (Hono)      |   | Database Layer   |   | MCP Server   |   |
|  | src/server/api/         |   | (Drizzle ORM)    |   | (standalone) |   |
|  | Routes: conversations,  |   | SQLite/Postgres  |   | mcp-server/  |   |
|  |   exec, files, search,  |   +------------------+   +--------------+   |
|  |   settings, admin, mcp  |                                            |
|  +------------------------+                                             |
+-------------------------------------------------------------------------+
```

---

## Core Modules

### Entrypoint and CLI (`src/main.tsx`, `src/entrypoints/`)

The CLI is built with Commander.js. On startup it:

1. Fires parallel side-effects before heavy imports: MDM settings read, macOS Keychain
   prefetch, and startup profiling.
2. Parses CLI arguments (model selection, effort level, API provider flags, etc.).
3. Initializes OAuth, feature flags (GrowthBook), and policy limits.
4. Launches the React/Ink renderer and hands off to the REPL.

| File | Role |
|------|------|
| `src/entrypoints/cli.tsx` | CLI session orchestration, the main path from launch to REPL |
| `src/entrypoints/init.ts` | Config, telemetry, OAuth, MDM policy initialization |
| `src/entrypoints/mcp.ts` | MCP server mode entrypoint (Claude Code itself as an MCP server) |
| `src/entrypoints/sdk/` | Agent SDK -- programmatic API for embedding Claude Code |

### Query Engine (`src/query.ts`, `src/QueryEngine.ts`)

The central orchestration loop. Responsibilities:

- **Streaming** -- sends messages to the LLM API and processes server-sent events.
- **Tool-call loops** -- when the LLM emits a `tool_use` block, the engine dispatches to
  the matching tool, collects the result, and feeds it back as a `tool_result` message.
- **Thinking mode** -- manages extended thinking budgets and thinking block rendering.
- **Auto-compact** -- when the conversation exceeds token thresholds, triggers context
  compaction (`src/services/compact/`) to summarize older turns.
- **Retry and fallback** -- transient API failures trigger exponential backoff retries;
  external model failures trigger the fallback chain.
- **Cost tracking** -- accumulates input/output token counts per turn.

### Tool System (`src/Tool.ts`, `src/tools/`, `src/tools.ts`)

Every capability the LLM can invoke is a **tool** -- a self-contained module with:

- **Input schema** (Zod validation via `input_schema`)
- **Permission model** (`isReadOnly()`, `needsPermission()`, `isConcurrencySafe()`)
- **Execution logic** (the `call()` method)
- **UI components** (React components for rendering invocation and results in the terminal)

Tools are registered in `src/tools.ts`, which conditionally loads feature-flagged tools via
`bun:bundle` dead code elimination. The 40+ built-in tools include:

| Category | Tools |
|----------|-------|
| **File I/O** | `FileReadTool`, `FileEditTool`, `FileWriteTool`, `GlobTool`, `GrepTool`, `NotebookEditTool` |
| **Execution** | `BashTool`, `PowerShellTool`, `REPLTool` |
| **Agent** | `AgentTool` (sub-agents), `TeamCreateTool`, `TeamDeleteTool`, `SendMessageTool` |
| **Tasks** | `TaskCreateTool`, `TaskGetTool`, `TaskListTool`, `TaskUpdateTool`, `TaskStopTool`, `TaskOutputTool` |
| **Planning** | `EnterPlanModeTool`, `ExitPlanModeTool`, `TodoWriteTool` |
| **MCP** | `MCPTool`, `ListMcpResourcesTool`, `ReadMcpResourceTool`, `McpAuthTool` |
| **Web** | `WebSearchTool`, `WebFetchTool`, `WebBrowserTool` (feature-flagged) |
| **Config** | `ConfigTool`, `ToolSearchTool`, `BriefTool` |
| **Git** | `EnterWorktreeTool`, `ExitWorktreeTool` |
| **Other** | `AskUserQuestionTool`, `LSPTool`, `SkillTool`, `SleepTool`, `SyntheticOutputTool` |

### Command System (`src/commands.ts`, `src/commands/`)

103 user-facing slash commands invoked via `/name` in the REPL. Three types:

| Type | Description | Examples |
|------|-------------|---------|
| **PromptCommand** | Sends a formatted prompt to the LLM | `/commit`, `/review`, `/issue` |
| **LocalCommand** | Runs in-process, returns plain text | `/cost`, `/version`, `/status` |
| **LocalJSXCommand** | Runs in-process, returns React JSX | `/doctor`, `/install`, `/theme` |

Commands span categories including git operations (`/commit`, `/branch`, `/diff`),
session management (`/resume`, `/session`, `/compact`), configuration (`/config`,
`/model`, `/permissions`), debugging (`/doctor`, `/debug-tool-call`), and many more.

### State Management (`src/state/`)

| Component | File | Purpose |
|-----------|------|---------|
| `AppState` | `AppStateStore.ts` | Global mutable state: messages, settings, tasks, tool permissions |
| `store.ts` | `store.ts` | Zustand-style store with subscription support |
| `selectors.ts` | `selectors.ts` | Derived state functions |
| `onChangeAppState.ts` | `onChangeAppState.ts` | Side-effect observers triggered on state transitions |

The `AppState` is threaded through tool contexts, giving every tool access to conversation
history, active settings, and runtime state.

---

## Multi-Model Routing System

### Overview

The router dispatches LLM calls to different providers based on **task type**. It sits
between the Query Engine and the API client layer.

```
Query Engine
     |
     v
resolveModelForQuery()   <-- src/services/router/resolveRouteForQuery.ts
     |
     +-- classifyTask()  <-- src/services/router/taskClassifier.ts
     |       Examines: active tools, token count, plan mode, subagent mode,
     |       bash command patterns (test runners), user model override
     |       Returns: TaskType enum
     |
     +-- ModelRouter.resolve()  <-- src/services/router/ModelRouter.ts
             Looks up route table: TaskType -> "provider/model" spec
             Returns: ResolvedRoute { model, providerName, providerConfig, isNativeAnthropic }
```

### Task Types

The classifier (`taskClassifier.ts`) assigns one of these types to each query turn:

| Task Type | Trigger |
|-----------|---------|
| `user_override` | User explicitly selected a model |
| `subagent` | Running inside a sub-agent or using AgentTool/TeamCreateTool |
| `planning` | Plan mode is active |
| `test_execution` | BashTool running a test command (vitest, jest, pytest, cargo test, etc.) |
| `file_search` | GrepTool, GlobTool, or FileReadTool active |
| `simple_edit` | FileEditTool or FileWriteTool active |
| `large_context` | Message history exceeds 100K tokens |
| `complex_reasoning` | Default fallback for everything else |

### Route Configuration

Routes are configured in `~/.claude/settings.json` under the `modelRouter` key:

```json
{
  "modelRouter": {
    "enabled": true,
    "default": "claude-opus-4-6",
    "providers": {
      "gemini": { "type": "gemini", "models": ["gemini-3.1-flash-lite"] },
      "ollama": { "type": "openai-compatible", "baseUrl": "http://localhost:11434/v1", "models": ["qwen2.5-coder"] }
    },
    "routes": [
      { "tasks": ["file_search", "glob", "grep"], "model": "gemini/gemini-3.1-flash-lite" },
      { "tasks": ["simple_edit"], "model": "ollama/qwen2.5-coder" }
    ],
    "fallbackChain": ["claude-sonnet-4-6"]
  }
}
```

### Capabilities Database (`src/services/router/capabilities.ts`)

Each model has a `ModelCapabilities` record tracking:

- `maxInputTokens` / `maxOutputTokens`
- `supportsTools`, `supportsStreaming`, `supportsVision`, `supportsThinking`
- `supportsEffort`, `supportsCaching`, `supportsPDFs`
- `toolCallStyle`: `'anthropic'` | `'openai'` | `'none'`

The capabilities drive request adaptation -- vision content is stripped for non-vision
models, `max_tokens` is clamped to the model's limit, and tool-less models get tool
descriptions injected into the system prompt instead.

### Fallback Executor (`src/services/router/fallbackExecutor.ts`)

Wraps every external model call with a retry chain. On failure (connection error,
empty response, etc.), it buffers events and tries the next model in `fallbackChain`
sequentially until one succeeds.

---

## Adapter and Stream Translation Layer

### Problem

The entire Claude Code streaming pipeline processes **Anthropic-format stream events**
(`BetaRawMessageStreamEvent`). To support non-Anthropic models, the adapter layer
translates in both directions.

### Request Translation (Anthropic -> OpenAI)

`src/services/api/adapters/OpenAIAdapter.ts`

- Converts Anthropic `messages` (with content blocks, `tool_use`, `tool_result`) into
  OpenAI `ChatCompletion` format (with `tool_calls`, `tool` role messages).
- Translates the `system` parameter into an OpenAI system message.
- Converts Anthropic tool definitions (`input_schema`) into OpenAI function-calling format.
- Strips thinking blocks (non-Anthropic models do not consume them).

### Response Translation (OpenAI -> Anthropic)

`src/services/api/adapters/StreamTranslator.ts`

- Translates OpenAI `ChatCompletionChunk` SSE events into Anthropic stream events:
  `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`,
  `message_delta`, `message_stop`.
- Maps finish reasons: `stop` -> `end_turn`, `tool_calls` -> `tool_use`, `length` -> `max_tokens`.

### OpenAI Stream Client (`src/services/api/adapters/OpenAIStreamClient.ts`)

Creates an Anthropic SDK-shaped client object backed by an OpenAI-compatible HTTP endpoint.
The returned object implements `.beta.messages.create().withResponse()` so it is a drop-in
replacement for the real Anthropic SDK client. Internally it:

1. Translates the request (OpenAIAdapter).
2. Sends a streaming `POST /chat/completions` to the configured `baseUrl`.
3. Parses the SSE response and yields Anthropic-format events (StreamTranslator).
4. For models without native tool support (`toolCallStyle: 'none'`), parses tool calls
   from fenced code blocks in the text output (`toolPromptInjection.ts`).

### Gemini Adapter (`src/services/api/adapters/GeminiAdapter.ts`)

Gemini support reuses the OpenAI adapter because Google provides an OpenAI-compatible
endpoint at `https://generativelanguage.googleapis.com/v1beta/openai/`. The adapter
simply provides the correct base URL and API key (`GEMINI_API_KEY` or `GOOGLE_API_KEY`).

### Tool Prompt Injection (`src/services/api/adapters/toolPromptInjection.ts`)

For models that do not support native tool calling (e.g., some Ollama models), tool
descriptions are injected into the system prompt with instructions to output tool calls
in a fenced `tool_call` code block. The response parser extracts these blocks and
synthesizes Anthropic-format `tool_use` content blocks from them.

---

## Terminal UI Layer (`src/ink/`)

Claude Code embeds a **custom fork of Ink** -- a React renderer for the terminal. The
render pipeline is:

```
React Component Tree
  -> reconciler.ts (React reconciler -> DOMElement/TextNode)
    -> dom.ts (Virtual DOM nodes with Yoga layout nodes)
      -> Yoga layout engine (flexbox -> x/y/width/height)
        -> renderer.ts (DOM tree -> 2D screen buffer)
          -> render-node-to-output.ts (styled text painting)
            -> log-update.ts (diff previous frame, write minimal ANSI escapes)
```

Key design decisions:
- `src/ink.ts` wraps every render call with a `ThemeProvider`.
- Instance cache keyed by stdout allows the IDE bridge to pause/resume rendering.
- ~140 React components in `src/components/` using Ink primitives (`Box`, `Text`).
- ~80 hooks in `src/hooks/` covering permissions, IDE integration, input handling, etc.

See `src/ink/ARCHITECTURE.md` for the full render pipeline documentation.

---

## Web Frontend (`web/`)

A **Next.js** application providing a browser-based interface to Claude Code:

| Path | Purpose |
|------|---------|
| `web/app/page.tsx` | Main chat UI (`<ChatLayout>` component) |
| `web/app/ink-app/page.tsx` | Experimental: renders the terminal Ink UI in the browser via an ink-compat DOM layer |
| `web/app/api/` | API routes: `chat`, `exec`, `files`, `health`, `share`, `analytics`, `cwd`, `env`, `export`, `fs` |
| `web/app/share/` | Shared conversation viewer |
| `web/components/` | React components (chat, sidebar, settings, etc.) |
| `web/lib/` | Client libraries including ink-compat layer |

The ink-compat layer (`web/lib/ink-compat/`) provides DOM-backed replacements for Ink
primitives so the same `<Box>`, `<Text>` component code can run in both terminal and browser.

---

## Backend Server (`src/server/`)

The backend API serves both the web frontend and remote sessions:

| Layer | Path | Technology |
|-------|------|------------|
| **HTTP API** | `src/server/api/` | Hono-based REST routes |
| **Routes** | `src/server/api/routes/` | `conversations`, `exec`, `files`, `search`, `settings`, `admin`, `mcp`, `health` |
| **Auth** | `src/server/auth/` | Session authentication |
| **Database** | `src/server/db/` | Drizzle ORM with SQLite and PostgreSQL schemas |
| **Web Terminal** | `src/server/web/` | PTY-based terminal sessions with WebSocket transport, session management, rate limiting |
| **Observability** | `src/server/observability/` | Server-side telemetry |
| **Security** | `src/server/security/` | Request validation, rate limiting |

The web terminal layer (`src/server/web/`) manages PTY processes (via `node-pty`),
WebSocket connections, scrollback buffers, and per-user session rate limiting.

---

## MCP Server (`mcp-server/`)

A **standalone MCP (Model Context Protocol) server** that exposes the Claude Code source
tree as tools and resources. Transport-agnostic (STDIO and HTTP entrypoints).

Exposes:
- **Tools** for exploring the source code (file listing, reading, searching).
- **Resources** for accessing source files.
- **Prompts** for common analysis tasks.

Separate from the MCP *client* system (`src/services/mcp/`) which connects Claude Code
to external MCP servers.

---

## MCP Client System (`src/services/mcp/`)

Manages connections to external MCP servers that provide additional tools and resources:

| File | Role |
|------|------|
| `MCPConnectionManager.tsx` | React component managing MCP server lifecycle |
| `client.ts` | MCP client implementation |
| `config.ts` | Server configuration loading |
| `auth.ts` | OAuth-based MCP authentication |
| `officialRegistry.ts` | Anthropic's official MCP server registry |
| `InProcessTransport.ts` | In-process MCP transport (no subprocess) |
| `SdkControlTransport.ts` | SDK-controlled transport layer |

---

## Supporting Subsystems

### Companion / Buddy System (`src/buddy/`)

A cosmetic companion character (e.g., "Pebble" the goose) that appears beside the user
input. Each companion is procedurally generated from a seed using a deterministic PRNG
(Mulberry32), with randomized species, hat, eyes, rarity tier, and stats. Custom
characters can be loaded from user configuration.

### Skills System (`src/skills/`)

Skills are modular capability packages (stored as markdown files with instructions) that
extend Claude's behavior for specific domains. They are loaded from `src/skills/bundled/`
and can also be built from MCP server capabilities (`mcpSkillBuilders.ts`).

### Plugin System (`src/plugins/`)

Plugins provide additional commands and tools. Bundled plugins live in
`src/plugins/bundled/`. Plugin lifecycle is managed via the `useManagePlugins` hook.

### Bridge System (`src/bridge/`)

The IDE bridge enables Claude Code to integrate with VS Code and other editors. It
provides bidirectional communication for:
- File diff viewing in the IDE
- Selection sharing from editor to Claude Code
- Permission callbacks
- Session lifecycle coordination

### Remote Sessions (`src/remote/`)

Manages remote Claude Code sessions, including WebSocket-based session transport
(`SessionsWebSocket.ts`) and SDK message adaptation (`sdkMessageAdapter.ts`).

### Context Compaction (`src/services/compact/`)

When conversation history grows too large, the compact service summarizes older turns
to free context window space. Supports auto-compact (triggered by token thresholds),
micro-compact, API-level compact, and time-based configuration.

### Voice Input (`src/voice/`, `src/services/voice.ts`)

Speech-to-text integration for voice-based interaction (feature-flagged via `VOICE_MODE`).

### Analytics and Telemetry (`src/services/analytics/`)

- **GrowthBook** for feature flags and A/B testing
- **OpenTelemetry** for distributed tracing and metrics
- Custom event tracking for usage analytics

### Cost Tracking (`src/cost-tracker.ts`)

Tracks token usage and estimated cost per conversation turn. Accessible via `/cost`.

---

## Key Data Flows

### 1. User Message to LLM Response

```
User types message in REPL
  -> useTextInput hook captures input
    -> AppState.messages updated with UserMessage
      -> QueryEngine.query() called
        -> resolveModelForQuery() picks provider/model
          -> API client sends streaming request
            -> SSE events translated (if non-Anthropic) via StreamTranslator
              -> Events rendered incrementally in terminal UI
```

### 2. Tool Invocation Loop

```
LLM response contains tool_use content block
  -> QueryEngine extracts tool name + input
    -> Permission check (useCanUseTool)
      -> Tool.call() executes
        -> Result wrapped as tool_result message
          -> Appended to messages, sent back to LLM
            -> LLM continues (may invoke more tools or produce final text)
```

### 3. Multi-Model Routing

```
QueryEngine prepares API call
  -> resolveModelForQuery() called with current context
    -> taskClassifier.classifyTask() examines active tools, token count, mode
      -> ModelRouter.resolve() matches TaskType to route config
        -> If external provider: createOpenAICompatibleClient()
           -> OpenAIAdapter translates request format
           -> StreamTranslator translates response events
           -> Fallback executor wraps call with retry chain
        -> If native Anthropic: use Anthropic SDK directly
```

### 4. Context Compaction

```
Token count exceeds threshold
  -> autoCompact triggered
    -> Recent messages summarized via LLM call
      -> Old messages replaced with compact summary
        -> Conversation continues with reduced context
```

---

## Build System

### Bun Runtime

Claude Code runs on Bun (not Node.js). Key implications:
- Native JSX/TSX support
- `bun:bundle` feature flags for dead-code elimination at build time
- ES modules with `.js` extensions

### Feature Flags

```typescript
import { feature } from 'bun:bundle'

// Inactive feature code is stripped entirely at build time
if (feature('VOICE_MODE')) { /* ... */ }
```

Notable flags: `PROACTIVE`, `KAIROS`, `BRIDGE_MODE`, `DAEMON`, `VOICE_MODE`,
`AGENT_TRIGGERS`, `MONITOR_TOOL`, `COORDINATOR_MODE`, `WORKFLOW_SCRIPTS`,
`CONTEXT_COLLAPSE`, `WEB_BROWSER_TOOL`, `UDS_INBOX`, `HISTORY_SNIP`.

### Testing

- **Vitest** for unit and integration tests (`tests/`)
- **Playwright** for web frontend E2E tests (`web/e2e/`)
- **Biome** for linting (`biome.json`)
- **TypeScript** for type checking (`tsconfig.json`)

---

## See Also

- [architecture.md](architecture.md) -- Shorter architecture overview
- [tools.md](tools.md) -- Complete tool catalog
- [commands.md](commands.md) -- Complete slash command catalog
- [subsystems.md](subsystems.md) -- Bridge, MCP, permissions, skills, plugins
- [multi-model-setup.md](multi-model-setup.md) -- Multi-model routing configuration guide
- [exploration-guide.md](exploration-guide.md) -- How to navigate this codebase
- [src/ink/ARCHITECTURE.md](../src/ink/ARCHITECTURE.md) -- Ink render pipeline deep-dive
