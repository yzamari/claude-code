#!/bin/bash
# Claude Code Multi-Model Runner
# Usage:
#   ./run.sh                  # Interactive REPL with smart routing (default)
#   ./run.sh smart            # Smart routing: different model per task type
#   ./run.sh gemini           # Gemini 3.1 Pro for everything
#   ./run.sh claude           # Real Claude Opus for everything
#   ./run.sh ollama           # Ollama DeepSeek for everything
#   ./run.sh tq               # TurboQuant local for everything
#   ./run.sh -p "prompt"      # Print mode (non-interactive)

MODEL_ALIAS="${1:-smart}"

case "$MODEL_ALIAS" in
  gemini|gemini-3.1)
    MODEL="gemini/gemini-3.1-pro-preview"
    ;;
  gemini-flash)
    MODEL="gemini/gemini-2.5-flash"
    ;;
  gemini-pro)
    MODEL="gemini/gemini-2.5-pro"
    ;;
  ollama|deepseek)
    MODEL="ollama/deepseek-coder-v2"
    ;;
  ollama-qwen|qwen)
    MODEL="ollama/qwen2.5:0.5b"
    ;;
  tq|turboquant)
    MODEL="tq/mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"
    ;;
  claude|opus)
    MODEL="claude-opus-4-6"
    ;;
  sonnet)
    MODEL="claude-sonnet-4-6"
    ;;
  haiku)
    MODEL="claude-haiku-4-5-20251001"
    ;;
  smart)
    # Smart mode: Gemini for complex work, Ollama for cheap tasks
    MODEL="gemini/gemini-3.1-pro-preview"
    ;;
  -p)
    MODEL="gemini/gemini-3.1-pro-preview"
    shift
    PROMPT="$*"
    ;;
  *)
    MODEL="$MODEL_ALIAS"
    ;;
esac

# All providers configured + task-based routing rules
# Routes:
#   file_search/grep/glob → Ollama (free, local, fast for simple lookups)
#   simple_edit           → Ollama (free, local)
#   test_execution        → Ollama (free, local)
#   large_context (>100K) → Gemini 2.5 Pro (2M context window)
#   complex_reasoning     → Gemini 3.1 Pro (best quality free cloud)
#   planning              → Gemini 3.1 Pro
#   subagent              → Gemini 2.5 Flash (fast, cheap for parallel agents)
#
# Fallback chain: if a provider fails, try next in order
SETTINGS='{"modelRouter":{"enabled":true,"default":"gemini/gemini-3.1-pro-preview","providers":{"gemini":{"type":"openai-compatible","baseUrl":"https://generativelanguage.googleapis.com/v1beta/openai","models":["gemini-3.1-pro-preview","gemini-2.5-flash","gemini-2.5-pro"]},"ollama":{"type":"openai-compatible","baseUrl":"http://localhost:11434/v1","models":["deepseek-coder-v2","qwen2.5:0.5b"]},"tq":{"type":"openai-compatible","baseUrl":"http://localhost:8322/v1","models":["mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"]}},"routes":[{"tasks":["file_search","grep","glob"],"model":"ollama/deepseek-coder-v2"},{"tasks":["simple_edit","test_execution"],"model":"ollama/deepseek-coder-v2"},{"tasks":["large_context"],"model":"gemini/gemini-2.5-pro"},{"tasks":["subagent"],"model":"gemini/gemini-2.5-flash"},{"tasks":["complex_reasoning","planning"],"model":"gemini/gemini-3.1-pro-preview"}],"fallbackChain":["gemini/gemini-3.1-pro-preview","gemini/gemini-2.5-flash","ollama/deepseek-coder-v2"]}}'

export CLAUDE_CODE_SKIP_VERSION_CHECK=1
export ANTHROPIC_MODEL="$MODEL"

if [ -n "$PROMPT" ]; then
  exec bun dist/cli.mjs --bare --print --settings "$SETTINGS" "$PROMPT"
else
  echo "╭─────────────────────────────────────────────╮"
  echo "│  Claude Code Multi-Model Router             │"
  echo "│  Model: $MODEL"
  echo "│                                             │"
  echo "│  Smart routing active:                      │"
  echo "│    file_search/grep → Ollama (local, free)  │"
  echo "│    complex reasoning → Gemini 3.1 Pro       │"
  echo "│    large context     → Gemini 2.5 Pro (2M)  │"
  echo "│    subagents         → Gemini 2.5 Flash      │"
  echo "│                                             │"
  echo "│  /model to switch manually                  │"
  echo "│  /model claude-opus-4-6 for real Claude     │"
  echo "╰─────────────────────────────────────────────╯"
  echo ""
  exec bun dist/cli.mjs --bare --settings "$SETTINGS"
fi
