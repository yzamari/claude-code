#!/bin/bash
# Claude Code Multi-Model Router
# Usage:
#   ./run.sh                  # Smart routing (Gemini + Claude + Local)
#   ./run.sh gemini           # Force Gemini 3.1 Pro only
#   ./run.sh claude           # Force Claude Opus only
#   ./run.sh ollama           # Force local Ollama only
#   ./run.sh -p "prompt"      # Print mode (non-interactive)

MODEL_ALIAS="${1:-smart}"

case "$MODEL_ALIAS" in
  gemini|gemini-3.1)      MODEL="gemini/gemini-3.1-pro-preview" ;;
  gemini-flash|flash)     MODEL="gemini/gemini-3-flash-preview" ;;
  flash-lite|lite)        MODEL="gemini/gemini-3.1-flash-lite-preview" ;;
  gemini-pro)             MODEL="gemini/gemini-3.1-pro-preview" ;;
  ollama|deepseek)        MODEL="ollama/deepseek-coder-v2" ;;
  qwen)                   MODEL="ollama/qwen2.5:0.5b" ;;
  qwen-opus-gguf)         MODEL="ollama/qwen-opus-distill" ;;
  heretic|uncensored)     MODEL="ollama/gemma4-heretic" ;;
  tq|turboquant)          MODEL="tq/mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit" ;;
  qwen-opus|opus-distill) MODEL="tq/mlx-community/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit" ;;
  claude|opus)            MODEL="claude-opus-4-6" ;;
  sonnet)                 MODEL="claude-sonnet-4-6" ;;
  haiku)                  MODEL="claude-haiku-4-5-20251001" ;;
  smart)                  MODEL="gemini/gemini-3.1-pro-preview" ;;
  -p)                     MODEL="gemini/gemini-3.1-pro-preview"; shift; PROMPT="$*" ;;
  *)                      MODEL="$MODEL_ALIAS" ;;
esac

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
SETTINGS='{"modelRouter":{"enabled":true,"default":"gemini/gemini-3.1-pro-preview","providers":{"gemini":{"type":"openai-compatible","baseUrl":"https://generativelanguage.googleapis.com/v1beta/openai","models":["gemini-3.1-pro-preview","gemini-3-flash-preview","gemini-3.1-flash-lite-preview"]},"ollama":{"type":"openai-compatible","baseUrl":"http://localhost:11434/v1","models":["deepseek-coder-v2","qwen2.5:0.5b","qwen-opus-distill","gemma4-heretic"]},"tq":{"type":"openai-compatible","baseUrl":"http://localhost:8322/v1","models":["mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit","mlx-community/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit"]}},"routes":[{"tasks":["file_search","grep","glob","file_read"],"model":"tq/mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"},{"tasks":["simple_edit"],"model":"tq/mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"},{"tasks":["test_execution"],"model":"gemini/gemini-3.1-flash-lite-preview"},{"tasks":["large_context"],"model":"gemini/gemini-3.1-pro-preview"},{"tasks":["subagent"],"model":"gemini/gemini-3-flash-preview"},{"tasks":["complex_reasoning","planning"],"model":"claude-opus-4-6"}],"fallbackChain":["claude-sonnet-4-6","gemini/gemini-3.1-pro-preview","gemini/gemini-3.1-flash-lite-preview"]}}'

export CLAUDE_CODE_SKIP_VERSION_CHECK=1
export ANTHROPIC_MODEL="$MODEL"

if [ -n "$PROMPT" ]; then
  exec bun dist/cli.mjs --bare --print --dangerously-skip-permissions --settings "$SETTINGS" "$PROMPT"
else
  echo "╭──────────────────────────────────────────────────╮"
  echo "│  Claude Code Multi-Model Router                  │"
  echo "│  Default: $MODEL"
  echo "│                                                  │"
  echo "│  Smart routing:                                  │"
  echo "│    complex reasoning → Claude Opus (best)        │"
  echo "│    planning          → Claude Opus               │"
  echo "│    large context     → Gemini 3.1 Pro            │"
  echo "│    subagents         → Gemini 3 Flash            │"
  echo "│    test execution    → Gemini 3.1 Flash Lite     │"
  echo "│    file search/grep  → MLX TurboQuant (local)    │"
  echo "│    simple edits      → MLX TurboQuant (local)    │"
  echo "│    file reads        → MLX TurboQuant (local)    │"
  echo "│                                                  │"
  echo "│  /model to switch manually                       │"
  echo "│  --debug 2>router.log to see routing decisions   │"
  echo "╰──────────────────────────────────────────────────╯"
  echo ""
  exec bun dist/cli.mjs --dangerously-skip-permissions --settings "$SETTINGS"
fi
