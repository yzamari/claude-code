# Multi-Model Router Design

**Date:** 2026-04-02
**Author:** Yahav Zamari
**Status:** Approved

## Problem Statement

Claude Code is tightly coupled to Anthropic's API. All 512K lines of code depend on the `@anthropic-ai/sdk` types, streaming format, and tool calling protocol. This creates three problems:

1. **Cost** — Every query (including simple file searches) goes through expensive cloud API calls
2. **Vendor lock-in** — No way to run offline or use alternative models
3. **Suboptimal routing** — No ability to leverage models with specific strengths (Gemini for large context, local models for cheap tasks)

## Goal

Build a multi-model orchestration system that enables:
- **Task-based routing** — Route different task types to different model providers
- **Cost optimization** — Use free local models for cheap tasks, reserve Claude for complex reasoning
- **Vendor independence** — Run fully offline with local models when needed
- **Best-of-breed selection** — Use the best model for each task type

## Architecture

### Core Principle: Adapter Pattern with Anthropic as Internal Lingua Franca

The existing codebase expects Anthropic SDK types everywhere (`BetaMessage`, `BetaRawMessageStreamEvent`, tool_use/tool_result protocol). Rather than rewriting 512K lines, we create **adapters** that make non-Anthropic providers look like Anthropic to the rest of the codebase.

```
┌──────────────────────────────────────────────────────────┐
│                    Existing Codebase (untouched)          │
│  queryModel() → anthropic.beta.messages.create()          │
│  Expects: BetaRawMessageStreamEvent, BetaMessage, etc.    │
└───────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────┐
│              ModelRouter (NEW)                             │
│  Classifies task type → selects model → selects provider  │
└───────────────────────┬──────────────────────────────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
   ┌─────────┐  ┌────────────┐  ┌──────────┐
   │Anthropic│  │OpenAI-Compat│  │ Gemini   │
   │  SDK    │  │  Adapter    │  │ Adapter  │
   │(native) │  │             │  │          │
   └─────────┘  └──────┬─────┘  └────┬─────┘
                       │              │
                ┌──────┼──────┐       │
                ▼      ▼      ▼       ▼
             Ollama  OpenAI  mlx-tq  Gemini
             local   cloud   server  cloud
```

### Provider Types

| Provider Type | SDK | Covers |
|---------------|-----|--------|
| `anthropic` (existing) | `@anthropic-ai/sdk` | Claude API, Bedrock, Vertex, Foundry |
| `openai-compatible` (new) | `openai` | Ollama, LM Studio, vLLM, OpenRouter, Together, Groq |
| `openai` (new) | `openai` | OpenAI API (GPT-4o, o1, o3) |
| `gemini` (new) | `@google/generative-ai` | Google Gemini (2.5 Pro, 2.5 Flash) |

### Message Format Translation

The OpenAI adapter translates bidirectionally:

| Anthropic Format | OpenAI Format |
|---|---|
| `messages.create()` | `chat.completions.create()` |
| `role: "assistant"`, `content: [{type: "tool_use", id, name, input}]` | `tool_calls: [{id, type: "function", function: {name, arguments}}]` |
| `role: "user"`, `content: [{type: "tool_result", tool_use_id, content}]` | `role: "tool"`, `tool_call_id`, `content` |
| `system: [{type: "text", text}]` | `messages[0]: {role: "system", content}` |
| `BetaRawMessageStreamEvent` (message_start, content_block_delta, etc.) | `ChatCompletionChunk` (choices[0].delta) |
| `thinking` blocks | Omitted (graceful degradation) |
| `cache_control` directives | Omitted |
| `tool_choice: {type: "auto"}` | `tool_choice: "auto"` |

### Stream Event Translation

Anthropic SSE events must be synthesized from OpenAI chunks:

```
OpenAI chunk: {choices: [{delta: {content: "Hello"}}]}
  → Anthropic: {type: "content_block_delta", delta: {type: "text_delta", text: "Hello"}}

OpenAI chunk: {choices: [{delta: {tool_calls: [{...}]}}]}
  → Anthropic: {type: "content_block_delta", delta: {type: "input_json_delta", partial_json: "..."}}

OpenAI chunk: {choices: [{finish_reason: "stop"}]}
  → Anthropic: {type: "message_delta", delta: {stop_reason: "end_turn"}}
```

## ModelRouter — Task-Based Routing

### Task Classification

The router classifies each query into a task type based on context signals:

| Signal | Task Type | Default Route |
|--------|-----------|---------------|
| Active tool: GrepTool, GlobTool, FileReadTool | `file_search` | Local (cheap) |
| Active tool: FileEditTool, FileWriteTool | `simple_edit` | Local or Sonnet |
| Active tool: BashTool with test commands | `test_execution` | Local (cheap) |
| Agent/Team spawning (AgentTool, TeamCreateTool) | `subagent` | Configurable |
| Plan mode active | `planning` | Claude Opus |
| Message history > 100K tokens | `large_context` | Gemini 2.5 Pro |
| User override via `/model` command | `user_override` | Respect choice |
| Default (all other queries) | `complex_reasoning` | Claude (main model) |

### Routing Configuration

```json
{
  "modelRouter": {
    "enabled": true,
    "default": "claude-opus-4-6",
    "providers": {
      "ollama": {
        "type": "openai-compatible",
        "baseUrl": "http://localhost:11434/v1",
        "models": ["qwen2.5-coder:7b", "llama3.2:8b"]
      },
      "mlx-tq": {
        "type": "openai-compatible",
        "baseUrl": "http://localhost:8080/v1",
        "models": ["qwen2.5-32b-turboquant-3bit"]
      },
      "openai": {
        "type": "openai",
        "apiKey": "${OPENAI_API_KEY}",
        "models": ["gpt-4o", "gpt-4o-mini", "o3"]
      },
      "gemini": {
        "type": "gemini",
        "apiKey": "${GEMINI_API_KEY}",
        "models": ["gemini-2.5-pro", "gemini-2.5-flash"]
      },
      "openrouter": {
        "type": "openai-compatible",
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKey": "${OPENROUTER_API_KEY}",
        "models": ["meta-llama/llama-3.3-70b"]
      }
    },
    "routes": [
      { "tasks": ["file_search", "grep", "glob"], "model": "ollama/qwen2.5-coder:7b" },
      { "tasks": ["simple_edit"], "model": "mlx-tq/qwen2.5-32b-turboquant-3bit" },
      { "tasks": ["large_context"], "model": "gemini/gemini-2.5-pro" },
      { "tasks": ["subagent"], "model": "openai/gpt-4o" },
      { "tasks": ["complex_reasoning", "planning"], "model": "claude-opus-4-6" }
    ],
    "fallbackChain": ["claude-sonnet-4-6", "openai/gpt-4o", "ollama/llama3.2:8b"]
  }
}
```

### Fallback Behavior

When a routed model fails (timeout, rate limit, connection refused, offline):
1. Log the failure with model + error type
2. Walk `fallbackChain` in order, trying each model
3. If all fallbacks fail, surface error to user
4. Track failure patterns to suggest routing adjustments

## Model Capability Matrix

```typescript
interface ModelCapabilities {
  maxInputTokens: number
  maxOutputTokens: number
  supportsTools: boolean
  supportsStreaming: boolean
  supportsVision: boolean
  supportsThinking: boolean   // Claude-specific
  supportsEffort: boolean     // Claude Opus-specific
  supportsCaching: boolean    // Claude-specific
  supportsPDFs: boolean
  toolCallStyle: 'anthropic' | 'openai' | 'none'
}
```

### Graceful Degradation Rules

When routing to a model that lacks a feature:
- **No thinking** → Strip `thinking` config, omit thinking blocks from response
- **No tools** → Inject tool descriptions into system prompt as structured text
- **No vision** → Convert image references to "[Image: filename]" placeholder
- **No PDF** → Extract text before sending
- **Smaller context** → Trigger compaction before routing
- **No streaming** → Buffer full response, emit synthetic stream events
- **No prompt caching** → Strip `cache_control` directives silently

## TurboQuant Integration (Local Inference)

For Apple Silicon users, the `mlx-turboquant` server provides high-performance local inference with KV cache compression:

```
turboQuantPlayground (algorithm library)
  └── mlx-turboquant (serving layer)
       └── mlx-tq-server (OpenAI-compatible API)
            └── ModelRouter connects via "openai-compatible" adapter
```

**Benefits:**
- 6x KV cache memory compression → run 32B models on MacBook
- 39% speedup on long-context inference
- Zero accuracy loss at 3-bit precision
- Metal GPU acceleration on Apple Silicon

## File Map

### New Files (~2500 lines)

| File | Lines | Purpose |
|------|-------|---------|
| `src/services/router/ModelRouter.ts` | ~400 | Task classification + route matching + fallback |
| `src/services/router/routerConfig.ts` | ~150 | Zod schema for router settings validation |
| `src/services/router/taskClassifier.ts` | ~200 | Heuristic task type detection from query context |
| `src/services/api/adapters/BaseAdapter.ts` | ~100 | Abstract adapter interface (Anthropic-compatible surface) |
| `src/services/api/adapters/OpenAIAdapter.ts` | ~500 | Anthropic ↔ OpenAI message + stream translation |
| `src/services/api/adapters/GeminiAdapter.ts` | ~400 | Anthropic ↔ Gemini message + stream translation |
| `src/services/api/adapters/StreamTranslator.ts` | ~300 | SSE event format translation (OpenAI chunks → Anthropic events) |
| `src/utils/model/capabilities.ts` | ~200 | Model feature matrix + capability queries |
| `src/utils/model/multiModelConfig.ts` | ~150 | Multi-model settings types + Zod schema |

### Modified Files (~200 lines of changes)

| File | Changes |
|------|---------|
| `src/utils/model/providers.ts` | Add new provider types to `APIProvider` union |
| `src/services/api/client.ts` | Add adapter branches in `getAnthropicClient()` |
| `src/services/api/claude.ts` | Hook ModelRouter before API call dispatch |
| `src/utils/model/configs.ts` | Support external model config entries |
| `src/utils/settings/settings.ts` | Add `modelRouter` to settings schema |

### Untouched (99.5% of codebase)

All 45 tools, 104 commands, 140 components, query engine, message types, hook system, bridge, MCP, coordinator, skills, web app.

## Implementation Phases

| Phase | Scope | Deliverable |
|-------|-------|-------------|
| 1 | OpenAI Adapter + StreamTranslator | Any OpenAI-compatible endpoint works as drop-in |
| 2 | Capability System | Feature detection + graceful degradation |
| 3 | ModelRouter + TaskClassifier | Task-based routing with settings config |
| 4 | Gemini Adapter | Native Gemini support for large-context |
| 5 | mlx-tq Integration | Docs + launch scripts for local TurboQuant inference |
| 6 | UI/Commands | `/model router` config, status display, cost tracking |

## Constraints

- **DO NOT** modify message types, tool definitions, or query engine internals
- **DO NOT** add adapters for models that lack basic chat completion capability
- **DO NOT** attempt to emulate thinking mode on non-Claude models
- **DO NOT** route security-sensitive operations (permission checks) to non-Claude models
- **DO NOT** add any new npm dependencies beyond `openai` SDK and `@google/generative-ai`

## Success Criteria

1. `ANTHROPIC_BASE_URL=http://localhost:11434/v1 ANTHROPIC_MODEL=qwen2.5-coder:7b` works out of the box
2. Task-based routing reduces API costs by >50% for typical coding sessions
3. Full offline mode works with Ollama + local models
4. Gemini handles >500K token context queries that would fail on Claude
5. Fallback chains recover from provider failures within 5 seconds
6. Zero regressions in existing Claude functionality
