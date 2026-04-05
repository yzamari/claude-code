#!/bin/bash
# Claude Code Multi-Model Router
# Usage:
#   ./run.sh                                    # Smart routing (Gemini + Claude + Local)
#   ./run.sh heretic                            # Uncensored local (llama.cpp Metal, fast)
#   ./run.sh heretic-mlx                        # Uncensored local (MLX TurboQuant, fastest)
#   ./run.sh claude                             # Force Claude Opus only
#   ./run.sh gemini                             # Force Gemini 3.1 Pro only
#   ./run.sh -p "prompt"                        # Print mode (non-interactive)
#   ./run.sh heretic --resume <session-id>      # Resume session with specific model
#   ./run.sh smart --verbose --model opus       # Any claude flags are passed through
#
# All arguments after the model alias are forwarded to claude-code.

# If first arg starts with -- it's a flag, not a model alias
if [ -z "$1" ] || [[ "$1" == --* ]]; then
  MODEL_ALIAS="smart"
  EXTRA_ARGS=("$@")
else
  MODEL_ALIAS="$1"
  shift
  EXTRA_ARGS=("$@")
fi

GGUF_PATH="$HOME/.ollama/models/blobs/sha256-92a767fc165395c69291768a53526dace172d23a44daef4cdd0f7a6175b7489b"
LLAMA_PORT=8324
TQ_PORT=8323
OLLAMA_PORT=11434

case "$MODEL_ALIAS" in
  gemini|gemini-3.1)      MODEL="gemini/gemini-3.1-pro-preview" ;;
  gemini-flash|flash)     MODEL="gemini/gemini-3-flash-preview" ;;
  flash-lite|lite)        MODEL="gemini/gemini-3.1-flash-lite-preview" ;;
  gemini-pro)             MODEL="gemini/gemini-3.1-pro-preview" ;;
  ollama|deepseek)        MODEL="ollama/deepseek-coder-v2" ;;
  qwen)                   MODEL="ollama/qwen2.5:0.5b" ;;
  qwen-opus-gguf)         MODEL="ollama/qwen-opus-distill" ;;
  heretic|uncensored)     MODEL="llama/gemma4-heretic" ;;
  heretic-mlx|fast-heretic) MODEL="tq/TheCluster/Qwen3.5-40B-Claude-4.6-Opus-Deckard-Heretic-Uncensored-Thinking-MLX-mxfp4" ;;
  tq|turboquant)          MODEL="tq/mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit" ;;
  qwen-opus|opus-distill) MODEL="tq/mlx-community/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit" ;;
  claude|opus)            MODEL="claude-opus-4-6" ;;
  sonnet)                 MODEL="claude-sonnet-4-6" ;;
  haiku)                  MODEL="claude-haiku-4-5-20251001" ;;
  smart)                  MODEL="gemini/gemini-3.1-pro-preview" ;;
  -p)                     MODEL="gemini/gemini-3.1-pro-preview"; PROMPT="${EXTRA_ARGS[*]}"; EXTRA_ARGS=() ;;
  *)                      MODEL="$MODEL_ALIAS" ;;
esac

# ── Auto-start local servers when needed ──────────────────────────────

ensure_ollama() {
  if ! curl -s http://localhost:$OLLAMA_PORT/api/tags &>/dev/null; then
    echo "→ Starting Ollama server..."
    ollama serve &>/dev/null &
    sleep 3
  fi
}

ensure_llama_server() {
  if ! curl -s http://localhost:$LLAMA_PORT/health &>/dev/null; then
    if [ ! -f "$GGUF_PATH" ]; then
      echo "✗ GGUF model not found at $GGUF_PATH"
      echo "  Run: ollama pull gemma4-heretic"
      exit 1
    fi
    echo "→ Starting llama-server on port $LLAMA_PORT (Metal, no-thinking)..."
    llama-server \
      --model "$GGUF_PATH" \
      --port $LLAMA_PORT \
      --n-gpu-layers 999 \
      --ctx-size 131072 \
      --threads 8 \
      --parallel 1 \
      --reasoning-budget 0 \
      2>/tmp/llama-server.log &
    # Wait for server to load model
    echo -n "  Loading model"
    for i in $(seq 1 60); do
      if curl -s http://localhost:$LLAMA_PORT/health &>/dev/null; then
        echo " ready!"
        return 0
      fi
      echo -n "."
      sleep 2
    done
    echo " timeout. Check /tmp/llama-server.log"
    exit 1
  fi
}

ensure_tq_server() {
  if ! curl -s http://localhost:$TQ_PORT/v1/models &>/dev/null; then
    local TQ_MODEL="$1"
    echo "→ Starting mlx-lm server on port $TQ_PORT..."
    mlx_lm.server --model "$TQ_MODEL" --port $TQ_PORT 2>/tmp/tq-server.log &
    echo -n "  Loading model"
    for i in $(seq 1 120); do
      if curl -s http://localhost:$TQ_PORT/v1/models &>/dev/null; then
        echo " ready!"
        return 0
      fi
      echo -n "."
      sleep 2
    done
    echo " timeout. Check /tmp/tq-server.log"
    exit 1
  fi
}

# Start the right server based on provider
PROVIDER_NAME="${MODEL%%/*}"
case "$PROVIDER_NAME" in
  ollama)  ensure_ollama ;;
  llama)   ensure_llama_server ;;
  tq)
    TQ_MODEL="${MODEL#tq/}"
    ensure_tq_server "$TQ_MODEL"
    ;;
esac

# ── Build router settings ─────────────────────────────────────────────

# Smart routing: each task type goes to the best model for it
#
#   Task Type          → Model                          → Why
#   ──────────────────────────────────────────────────────────────
#   file_search/grep   → MLX TurboQuant (local)         → Free, fast, offline, on-device
#   simple_edit        → MLX TurboQuant (local)         → Free, fast, offline, on-device
#   file_read          → MLX TurboQuant (local)         → Free, fast, offline, on-device
#   test_execution     → Gemini 3.1 Flash Lite          → Cheap, fast
#   large_context      → Gemini 3.1 Pro                 → 2M token context window
#   complex_reasoning  → Claude Opus                    → Best quality reasoning
#   planning           → Claude Opus                    → Best for architecture
#   subagent           → Gemini 3 Flash                 → Fast, parallel agents
#
#   Fallback: Claude → Gemini → TurboQuant
#
SMART_SETTINGS='{"modelRouter":{"enabled":true,"default":"gemini/gemini-3.1-pro-preview","providers":{"gemini":{"type":"openai-compatible","baseUrl":"https://generativelanguage.googleapis.com/v1beta/openai","models":["gemini-3.1-pro-preview","gemini-3-flash-preview","gemini-3.1-flash-lite-preview"]},"ollama":{"type":"openai-compatible","baseUrl":"http://localhost:11434/v1","models":["deepseek-coder-v2","qwen2.5:0.5b","qwen-opus-distill","gemma4-heretic"]},"tq":{"type":"openai-compatible","baseUrl":"http://localhost:8322/v1","models":["mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit","mlx-community/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit"]}},"routes":[{"tasks":["file_search","grep","glob","file_read"],"model":"tq/mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"},{"tasks":["simple_edit"],"model":"tq/mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"},{"tasks":["test_execution"],"model":"gemini/gemini-3.1-flash-lite-preview"},{"tasks":["large_context"],"model":"gemini/gemini-3.1-pro-preview"},{"tasks":["subagent"],"model":"gemini/gemini-3-flash-preview"},{"tasks":["complex_reasoning","planning"],"model":"claude-opus-4-6"}],"fallbackChain":["claude-sonnet-4-6","gemini/gemini-3.1-pro-preview","gemini/gemini-3.1-flash-lite-preview"]}}'

# When a specific model is chosen (not smart), route ALL tasks to that model
if [ "$MODEL_ALIAS" = "smart" ] || [ "$MODEL_ALIAS" = "-p" ]; then
  SETTINGS="$SMART_SETTINGS"
else
  MODEL_ID="${MODEL#*/}"
  if [ "$PROVIDER_NAME" = "$MODEL" ]; then
    # No slash — native Anthropic model (e.g. claude-opus-4-6)
    SETTINGS='{"modelRouter":{"enabled":false}}'
  else
    # External provider — route everything to this one model
    case "$PROVIDER_NAME" in
      ollama)  BASE_URL="http://localhost:$OLLAMA_PORT/v1" ;;
      tq)      BASE_URL="http://localhost:$TQ_PORT/v1" ;;
      llama)   BASE_URL="http://localhost:$LLAMA_PORT/v1" ;;
      gemini)  BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai" ;;
      *)       BASE_URL="http://localhost:$OLLAMA_PORT/v1" ;;
    esac
    SETTINGS="{\"modelRouter\":{\"enabled\":true,\"default\":\"$MODEL\",\"providers\":{\"$PROVIDER_NAME\":{\"type\":\"openai-compatible\",\"baseUrl\":\"$BASE_URL\",\"models\":[\"$MODEL_ID\"]}},\"routes\":[{\"tasks\":[\"file_search\",\"grep\",\"glob\",\"file_read\",\"simple_edit\",\"test_execution\",\"large_context\",\"subagent\",\"complex_reasoning\",\"planning\"],\"model\":\"$MODEL\"}],\"fallbackChain\":[]}}"
  fi
fi

# ── Launch Claude Code ────────────────────────────────────────────────

export CLAUDE_CODE_SKIP_VERSION_CHECK=1
export ANTHROPIC_MODEL="$MODEL"

if [ -n "$PROMPT" ]; then
  exec bun dist/cli.mjs --bare --print --dangerously-skip-permissions --settings "$SETTINGS" "$PROMPT" "${EXTRA_ARGS[@]}"
else
  echo "╭──────────────────────────────────────────────────╮"
  echo "│  Claude Code Multi-Model Router                  │"
  echo "│  Model: $MODEL"
  echo "│                                                  │"
  if [ "$MODEL_ALIAS" = "smart" ]; then
  echo "│  Smart routing:                                  │"
  echo "│    complex reasoning → Claude Opus (best)        │"
  echo "│    planning          → Claude Opus               │"
  echo "│    large context     → Gemini 3.1 Pro            │"
  echo "│    subagents         → Gemini 3 Flash            │"
  echo "│    test execution    → Gemini 3.1 Flash Lite     │"
  echo "│    file search/grep  → MLX TurboQuant (local)    │"
  echo "│    simple edits      → MLX TurboQuant (local)    │"
  echo "│    file reads        → MLX TurboQuant (local)    │"
  else
  echo "│  All tasks → $MODEL"
  fi
  echo "│                                                  │"
  echo "│  Aliases: heretic, heretic-mlx, claude, gemini,  │"
  echo "│           smart, sonnet, haiku, ollama, tq       │"
  echo "│  /model to switch manually                       │"
  echo "╰──────────────────────────────────────────────────╯"
  echo ""
  exec bun dist/cli.mjs --dangerously-skip-permissions --settings "$SETTINGS" "${EXTRA_ARGS[@]}"
fi
