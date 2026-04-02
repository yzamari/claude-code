# Multi-Model Router Setup Guide

> Route different task types to different model providers for cost optimization, offline support, and best-of-breed model selection.

---

## Quick Start: Local Models with Ollama

Get up and running with free local inference in under five minutes.

### 1. Install and start Ollama

```bash
# macOS
brew install ollama
ollama serve

# Linux
curl -fsSL https://ollama.ai/install.sh | sh
ollama serve
```

### 2. Pull a coding model

```bash
ollama pull qwen2.5-coder:7b
```

### 3. Add router config to settings

Edit `~/.claude/settings.json`:

```json
{
  "modelRouter": {
    "enabled": true,
    "default": "claude-opus-4-6",
    "providers": {
      "ollama": {
        "type": "openai-compatible",
        "baseUrl": "http://localhost:11434/v1",
        "models": ["qwen2.5-coder:7b"]
      }
    },
    "routes": [
      { "tasks": ["file_search", "grep", "glob"], "model": "ollama/qwen2.5-coder:7b" }
    ],
    "fallbackChain": ["claude-sonnet-4-6"]
  }
}
```

### 4. Use Claude Code as normal

File searches, glob, and grep operations now route to your local Ollama model. Everything else (complex reasoning, planning, editing) continues using Claude.

---

## Configuration Reference

The `modelRouter` object in `~/.claude/settings.json` controls all routing behavior.

### Full Schema

```json
{
  "modelRouter": {
    "enabled": true,
    "default": "<model-spec>",
    "providers": {
      "<provider-name>": {
        "type": "openai-compatible" | "openai" | "gemini",
        "baseUrl": "<api-endpoint-url>",
        "apiKey": "<api-key-or-env-var-reference>",
        "models": ["<model-id>", ...]
      }
    },
    "routes": [
      {
        "tasks": ["<task-type>", ...],
        "model": "<provider-name>/<model-id>"
      }
    ],
    "fallbackChain": ["<model-spec>", ...]
  }
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | `boolean` | Yes | Enables multi-model routing. When `false`, all queries use `default`. |
| `default` | `string` | Yes | The model to use when no route matches a task type. Use a bare model name for Anthropic (e.g., `claude-opus-4-6`) or `provider/model` for others. |
| `providers` | `object` | No | Map of provider names to their connection configuration. |
| `routes` | `array` | No | Ordered list of task-to-model mappings. First matching route wins. |
| `fallbackChain` | `array` | No | Ordered list of model specs to try when the primary routed model fails. |

### Provider Config Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | One of `openai-compatible`, `openai`, or `gemini`. |
| `baseUrl` | `string` | No | API endpoint URL. Required for `openai-compatible` providers. |
| `apiKey` | `string` | No | API key. Supports `${ENV_VAR}` syntax for environment variable references. |
| `models` | `string[]` | Yes | List of model IDs available from this provider. |

### Model Spec Format

Model specs use the format `<provider-name>/<model-id>`:

- `ollama/qwen2.5-coder:7b` -- routes to the `ollama` provider, model `qwen2.5-coder:7b`
- `openai/gpt-4o` -- routes to the `openai` provider, model `gpt-4o`
- `gemini/gemini-2.5-pro` -- routes to the `gemini` provider, model `gemini-2.5-pro`
- `claude-opus-4-6` -- bare name (no slash) routes to native Anthropic

---

## Provider Setup

### Ollama (Local, Free)

Ollama runs open-source models locally on your machine. No API key required.

```bash
# Install
brew install ollama        # macOS
# or: curl -fsSL https://ollama.ai/install.sh | sh  # Linux

# Start the server
ollama serve

# Pull models
ollama pull qwen2.5-coder:7b       # Fast coding model (4.7 GB)
ollama pull llama3.2:8b             # General purpose (4.9 GB)
ollama pull deepseek-coder-v2:16b   # Larger coding model (9 GB)
```

**Provider config:**

```json
"ollama": {
  "type": "openai-compatible",
  "baseUrl": "http://localhost:11434/v1",
  "models": ["qwen2.5-coder:7b", "llama3.2:8b"]
}
```

### OpenAI

Use GPT-4o, o3, and other OpenAI models alongside Claude.

**Prerequisites:** An OpenAI API key. Set `OPENAI_API_KEY` in your environment.

**Provider config:**

```json
"openai": {
  "type": "openai",
  "apiKey": "${OPENAI_API_KEY}",
  "models": ["gpt-4o", "gpt-4o-mini", "o3"]
}
```

### Google Gemini

Use Gemini models for large-context tasks (up to 2M tokens).

**Prerequisites:** A Google AI API key. Set `GEMINI_API_KEY` in your environment.

**Provider config:**

```json
"gemini": {
  "type": "gemini",
  "apiKey": "${GEMINI_API_KEY}",
  "models": ["gemini-2.5-pro", "gemini-2.5-flash"]
}
```

### OpenRouter

Access many models through a single API endpoint.

**Prerequisites:** An OpenRouter API key. Set `OPENROUTER_API_KEY` in your environment.

**Provider config:**

```json
"openrouter": {
  "type": "openai-compatible",
  "baseUrl": "https://openrouter.ai/api/v1",
  "apiKey": "${OPENROUTER_API_KEY}",
  "models": ["meta-llama/llama-3.3-70b", "mistralai/mixtral-8x22b"]
}
```

### mlx-turboquant (Apple Silicon Local Inference)

High-performance local inference with KV cache compression for Apple Silicon Macs. Runs 32B parameter models on a MacBook with 6x memory compression.

**Prerequisites:** Apple Silicon Mac, Python 3.10+, MLX framework.

```bash
# Install mlx-turboquant server
pip install mlx-tq-server

# Start the server (OpenAI-compatible endpoint)
mlx-tq-server --model qwen2.5-32b-turboquant-3bit --port 8080
```

**Provider config:**

```json
"mlx-tq": {
  "type": "openai-compatible",
  "baseUrl": "http://localhost:8080/v1",
  "models": ["qwen2.5-32b-turboquant-3bit"]
}
```

---

## Task Types

The router classifies each query into a task type based on context signals and routes it to the configured model.

| Task Type | Detection Signal | Typical Route |
|-----------|-----------------|---------------|
| `file_search` | Active tool is GrepTool, GlobTool, or FileReadTool | Local (cheap/free) |
| `grep` | GrepTool invocation | Local (cheap/free) |
| `glob` | GlobTool invocation | Local (cheap/free) |
| `simple_edit` | Active tool is FileEditTool or FileWriteTool | Local or mid-tier |
| `file_read` | FileReadTool invocation | Local (cheap/free) |
| `test_execution` | BashTool running test commands (vitest, jest, pytest, etc.) | Local (cheap/free) |
| `subagent` | AgentTool or TeamCreateTool invocation | Configurable |
| `planning` | Plan mode is active | Claude Opus (high reasoning) |
| `large_context` | Message history exceeds 100K tokens | Gemini 2.5 Pro (2M context) |
| `complex_reasoning` | Default for all other queries | Claude (main model) |
| `user_override` | User explicitly selected a model via `/model` command | Respects user choice |

### Classification Priority

Tasks are classified in this priority order (highest first):

1. `user_override` -- user explicitly chose a model
2. `subagent` -- agent/team spawning detected
3. `planning` -- plan mode is active
4. `test_execution` -- bash command matches test patterns
5. `file_search` -- search tools active
6. `simple_edit` -- edit tools active
7. `large_context` -- token count exceeds 100K threshold
8. `complex_reasoning` -- fallback default

---

## Fallback Chains

When a routed model fails (timeout, rate limit, connection refused, server offline), the router walks the `fallbackChain` in order, trying each model until one succeeds.

```json
"fallbackChain": ["claude-sonnet-4-6", "openai/gpt-4o", "ollama/llama3.2:8b"]
```

**Fallback behavior:**

1. Primary model fails (e.g., Ollama is offline)
2. Router tries `claude-sonnet-4-6` (native Anthropic)
3. If that fails, tries `openai/gpt-4o`
4. If that fails, tries `ollama/llama3.2:8b`
5. If all fail, the error is surfaced to the user

**Common failure scenarios:**

| Failure | Example | Recovery |
|---------|---------|----------|
| Connection refused | Ollama not running | Falls back to cloud provider |
| Rate limit | OpenAI 429 response | Falls back to next provider |
| Timeout | Slow local model | Falls back to faster provider |
| Auth error | Invalid API key | Falls back, logs warning |

---

## Graceful Degradation

When routing to a model that lacks certain capabilities, the router degrades gracefully:

| Missing Capability | Behavior |
|--------------------|----------|
| No thinking support | Strips thinking configuration, omits thinking blocks from response |
| No tool calling | Injects tool descriptions into system prompt as structured text |
| No vision | Converts image references to `[Image: filename]` placeholders |
| No PDF support | Extracts text from PDFs before sending |
| No streaming | Buffers full response, emits synthetic stream events |
| No prompt caching | Strips `cache_control` directives silently |
| Smaller context window | Triggers context compaction before routing |

---

## Example Configurations

### Cost-Optimized: Local + Claude

Route cheap tasks locally, reserve Claude for complex work.

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
      }
    },
    "routes": [
      { "tasks": ["file_search", "grep", "glob", "file_read"], "model": "ollama/qwen2.5-coder:7b" },
      { "tasks": ["test_execution"], "model": "ollama/llama3.2:8b" },
      { "tasks": ["simple_edit"], "model": "ollama/qwen2.5-coder:7b" },
      { "tasks": ["complex_reasoning", "planning"], "model": "claude-opus-4-6" }
    ],
    "fallbackChain": ["claude-sonnet-4-6"]
  }
}
```

### Multi-Cloud: Best Model per Task

Use the best model from each provider for each task type.

```json
{
  "modelRouter": {
    "enabled": true,
    "default": "claude-opus-4-6",
    "providers": {
      "openai": {
        "type": "openai",
        "apiKey": "${OPENAI_API_KEY}",
        "models": ["gpt-4o", "gpt-4o-mini"]
      },
      "gemini": {
        "type": "gemini",
        "apiKey": "${GEMINI_API_KEY}",
        "models": ["gemini-2.5-pro", "gemini-2.5-flash"]
      },
      "ollama": {
        "type": "openai-compatible",
        "baseUrl": "http://localhost:11434/v1",
        "models": ["qwen2.5-coder:7b"]
      }
    },
    "routes": [
      { "tasks": ["file_search", "grep", "glob"], "model": "ollama/qwen2.5-coder:7b" },
      { "tasks": ["large_context"], "model": "gemini/gemini-2.5-pro" },
      { "tasks": ["subagent"], "model": "openai/gpt-4o" },
      { "tasks": ["simple_edit"], "model": "openai/gpt-4o-mini" },
      { "tasks": ["complex_reasoning", "planning"], "model": "claude-opus-4-6" }
    ],
    "fallbackChain": ["claude-sonnet-4-6", "openai/gpt-4o", "ollama/qwen2.5-coder:7b"]
  }
}
```

### Fully Offline: Local Only

Run entirely offline with local models. No cloud API calls.

```json
{
  "modelRouter": {
    "enabled": true,
    "default": "ollama/qwen2.5-coder:7b",
    "providers": {
      "ollama": {
        "type": "openai-compatible",
        "baseUrl": "http://localhost:11434/v1",
        "models": ["qwen2.5-coder:7b", "llama3.2:8b", "deepseek-coder-v2:16b"]
      }
    },
    "routes": [
      { "tasks": ["file_search", "grep", "glob", "file_read", "test_execution"], "model": "ollama/qwen2.5-coder:7b" },
      { "tasks": ["simple_edit", "subagent"], "model": "ollama/deepseek-coder-v2:16b" },
      { "tasks": ["complex_reasoning", "planning"], "model": "ollama/deepseek-coder-v2:16b" }
    ],
    "fallbackChain": ["ollama/llama3.2:8b"]
  }
}
```

### Apple Silicon Power User: mlx-turboquant + Claude

Use mlx-turboquant for fast local inference on Apple Silicon with Claude as the heavy hitter.

```json
{
  "modelRouter": {
    "enabled": true,
    "default": "claude-opus-4-6",
    "providers": {
      "mlx-tq": {
        "type": "openai-compatible",
        "baseUrl": "http://localhost:8080/v1",
        "models": ["qwen2.5-32b-turboquant-3bit"]
      }
    },
    "routes": [
      { "tasks": ["file_search", "grep", "glob", "file_read", "test_execution"], "model": "mlx-tq/qwen2.5-32b-turboquant-3bit" },
      { "tasks": ["simple_edit"], "model": "mlx-tq/qwen2.5-32b-turboquant-3bit" },
      { "tasks": ["complex_reasoning", "planning"], "model": "claude-opus-4-6" }
    ],
    "fallbackChain": ["claude-sonnet-4-6"]
  }
}
```

### OpenRouter Gateway

Use OpenRouter as a single gateway to access many models.

```json
{
  "modelRouter": {
    "enabled": true,
    "default": "claude-opus-4-6",
    "providers": {
      "openrouter": {
        "type": "openai-compatible",
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKey": "${OPENROUTER_API_KEY}",
        "models": ["meta-llama/llama-3.3-70b", "mistralai/mixtral-8x22b", "google/gemini-2.5-pro"]
      }
    },
    "routes": [
      { "tasks": ["file_search", "grep", "glob"], "model": "openrouter/meta-llama/llama-3.3-70b" },
      { "tasks": ["simple_edit", "subagent"], "model": "openrouter/mistralai/mixtral-8x22b" },
      { "tasks": ["large_context"], "model": "openrouter/google/gemini-2.5-pro" },
      { "tasks": ["complex_reasoning", "planning"], "model": "claude-opus-4-6" }
    ],
    "fallbackChain": ["claude-sonnet-4-6"]
  }
}
```

---

## Troubleshooting

### Router is not active

**Symptom:** All queries go to Claude regardless of routes.

**Fix:** Verify `modelRouter.enabled` is set to `true` in `~/.claude/settings.json`. The router is disabled by default.

```json
"modelRouter": {
  "enabled": true,
  ...
}
```

### Connection refused to Ollama

**Symptom:** Error `ECONNREFUSED` when routing to Ollama.

**Fix:**
1. Verify Ollama is running: `ollama list`
2. Start the server: `ollama serve`
3. Check the port matches your config (default: `11434`)
4. Verify the model is pulled: `ollama pull qwen2.5-coder:7b`

### Invalid API key for cloud providers

**Symptom:** 401 Unauthorized errors from OpenAI, Gemini, or OpenRouter.

**Fix:**
1. Verify the environment variable is set: `echo $OPENAI_API_KEY`
2. Check that the `apiKey` field references the correct env var: `"${OPENAI_API_KEY}"`
3. Ensure the key is valid and has not been revoked
4. For OpenRouter, verify your account has credits

### Model not found

**Symptom:** 404 or model-not-found error from the provider.

**Fix:**
1. Verify the model ID matches what the provider expects
2. For Ollama, run `ollama list` to see available models
3. For OpenAI, check the model name against the [OpenAI models page](https://platform.openai.com/docs/models)
4. Ensure the model is listed in the provider's `models` array in your config

### Fallback chain not working

**Symptom:** Error surfaces to user instead of falling back.

**Fix:**
1. Verify `fallbackChain` is set in your config
2. Ensure fallback model specs use correct `provider/model` format
3. Check that fallback providers are configured and reachable
4. For Anthropic fallbacks (bare model names like `claude-sonnet-4-6`), ensure your Anthropic API key is valid

### Unexpected task classification

**Symptom:** Queries are routed to the wrong model.

**Explanation:** The task classifier uses heuristic signals from active tools, token counts, and mode flags. Classification follows a strict priority order (see the Task Types section above). If a query matches multiple signals, the highest-priority classification wins.

**Debugging tip:** Check which tools are active in the current turn. For example, if both a search tool and an edit tool are active, the classifier picks based on priority order (search > edit in the default configuration).

### mlx-turboquant server not responding

**Symptom:** Timeout or connection errors to `localhost:8080`.

**Fix:**
1. Verify the server is running: `curl http://localhost:8080/v1/models`
2. Check that the model is loaded: the first request may take time to load weights
3. Ensure sufficient memory (32B models need ~12 GB with turboquant 3-bit compression)
4. Check the port in your config matches the server's `--port` flag

### Schema validation errors

**Symptom:** Claude Code fails to start or logs config validation errors.

**Fix:**
1. Validate your JSON syntax (trailing commas, missing brackets)
2. Ensure `type` is one of: `openai-compatible`, `openai`, `gemini`
3. Ensure `baseUrl` is a valid URL (include the protocol: `http://` or `https://`)
4. Ensure `tasks` arrays use valid task type names (see the Task Types table)
5. Ensure `models` is a non-empty array of strings

---

## Architecture Overview

For technical details on how the multi-model router integrates with the Claude Code codebase, see the [Multi-Model Router section in the Architecture Guide](architecture.md#multi-model-router).

### Key Source Files

| File | Purpose |
|------|---------|
| `src/services/router/ModelRouter.ts` | Core router: task classification, route matching, fallback resolution |
| `src/services/router/taskClassifier.ts` | Heuristic task type detection from query context |
| `src/services/router/capabilities.ts` | Model feature matrix and capability queries |
| `src/services/router/routerConfig.ts` | Zod schema for router configuration validation |
| `src/services/api/adapters/OpenAIAdapter.ts` | Anthropic-to-OpenAI message and stream format translation |
| `src/services/api/adapters/GeminiAdapter.ts` | Anthropic-to-Gemini message and stream format translation |
| `src/services/api/adapters/StreamTranslator.ts` | SSE event translation (OpenAI chunks to Anthropic events) |
