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
  gemini-flash)           MODEL="gemini/gemini-2.5-flash" ;;
  flash-lite|lite)        MODEL="gemini/gemini-3.1-flash-lite-preview" ;;
  gemini-pro)             MODEL="gemini/gemini-2.5-pro" ;;
  ollama|deepseek)        MODEL="ollama/deepseek-coder-v2" ;;
  qwen)                   MODEL="ollama/qwen2.5:0.5b" ;;
  tq|turboquant)          MODEL="tq/mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit" ;;
  claude|opus)            MODEL="claude-opus-4-6" ;;
  sonnet)                 MODEL="claude-sonnet-4-6" ;;
  haiku)                  MODEL="claude-haiku-4-5-20251001" ;;
  smart)                  MODEL="gemini/gemini-3.1-pro-preview" ;;
  -p)                     MODEL="gemini/gemini-3.1-pro-preview"; shift; PROMPT="$*" ;;
  *)                      MODEL="$MODEL_ALIAS" ;;
esac

# Smart routing: each task type goes to the best model for it
#
#   Task Type          → Model              → Why
#   ─────────────────────────────────────────────────────
#   file_search/grep   → Ollama local       → Free, fast, offline
#   simple_edit        → Ollama local       → Free, fast, offline
#   test_execution     → Ollama local       → Free, no API cost
#   large_context      → Gemini 2.5 Pro     → 2M token context window
#   complex_reasoning  → Claude Opus        → Best quality reasoning
#   planning           → Claude Opus        → Best for architecture
#   subagent           → Gemini 2.5 Flash   → Fast, parallel agents
#
#   Fallback: Claude → Gemini → Ollama
#
SETTINGS='{"modelRouter":{"enabled":true,"default":"gemini/gemini-3.1-pro-preview","providers":{"gemini":{"type":"openai-compatible","baseUrl":"https://generativelanguage.googleapis.com/v1beta/openai","models":["gemini-3.1-pro-preview","gemini-2.5-flash","gemini-2.5-pro","gemini-3.1-flash-lite-preview"]},"ollama":{"type":"openai-compatible","baseUrl":"http://localhost:11434/v1","models":["deepseek-coder-v2","qwen2.5:0.5b"]},"tq":{"type":"openai-compatible","baseUrl":"http://localhost:8322/v1","models":["mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"]}},"routes":[{"tasks":["file_search","grep","glob"],"model":"gemini/gemini-3.1-flash-lite-preview"},{"tasks":["simple_edit","test_execution"],"model":"gemini/gemini-3.1-flash-lite-preview"},{"tasks":["large_context"],"model":"gemini/gemini-3.1-pro-preview"},{"tasks":["subagent"],"model":"gemini/gemini-2.5-flash"},{"tasks":["complex_reasoning","planning"],"model":"claude-opus-4-6"}],"fallbackChain":["claude-sonnet-4-6","gemini/gemini-3.1-pro-preview","gemini/gemini-3.1-flash-lite-preview"]}}'

export CLAUDE_CODE_SKIP_VERSION_CHECK=1
export ANTHROPIC_MODEL="$MODEL"

if [ -n "$PROMPT" ]; then
  exec bun dist/cli.mjs --bare --print --settings "$SETTINGS" "$PROMPT"
else
  echo "╭──────────────────────────────────────────────╮"
  echo "│  Claude Code Multi-Model Router              │"
  echo "│  Default: $MODEL"
  echo "│                                              │"
  echo "│  Smart routing:                              │"
  echo "│    complex reasoning → Claude Opus (best)    │"
  echo "│    planning          → Claude Opus           │"
  echo "│    large context     → Gemini 2.5 Pro (2M)   │"
  echo "│    subagents         → Gemini 2.5 Flash       │"
  echo "│    file search/grep  → Gemini 3.1 Flash Lite  │"
  echo "│    simple edits      → Gemini 3.1 Flash Lite  │"
  echo "│                                              │"
  echo "│  /model to switch manually                   │"
  echo "╰──────────────────────────────────────────────╯"
  echo ""
  exec bun dist/cli.mjs --settings "$SETTINGS"
fi
