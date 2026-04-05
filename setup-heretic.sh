#!/bin/bash
# Setup gemma4-heretic (uncensored local model) for Claude Code
#
# This script:
#   1. Installs Ollama if not present
#   2. Pulls gemma4-heretic model
#   3. Verifies the model is running and accessible
#   4. Builds Claude Code with safety layer stripping for local models
#
# Usage:
#   chmod +x setup-heretic.sh
#   ./setup-heretic.sh
#
# After setup, run:
#   ./run.sh heretic

set -e

echo "╭──────────────────────────────────────────────────╮"
echo "│  gemma4-heretic Setup for Claude Code            │"
echo "│  Uncensored local model, no content filters      │"
echo "╰──────────────────────────────────────────────────╯"
echo ""

# ── Step 1: Check/Install Ollama ──────────────────────────────────────

if command -v ollama &>/dev/null; then
  echo "✓ Ollama is installed: $(ollama --version 2>/dev/null || echo 'unknown version')"
else
  echo "→ Installing Ollama..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install ollama
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    curl -fsSL https://ollama.ai/install.sh | sh
  else
    echo "✗ Unsupported OS: $OSTYPE"
    echo "  Install Ollama manually from https://ollama.com"
    exit 1
  fi
  echo "✓ Ollama installed"
fi

# ── Step 2: Ensure Ollama server is running ───────────────────────────

if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
  echo "→ Starting Ollama server..."
  ollama serve &>/dev/null &
  sleep 3
  if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
    echo "✗ Failed to start Ollama server"
    echo "  Try running 'ollama serve' manually in another terminal"
    exit 1
  fi
fi
echo "✓ Ollama server is running"

# ── Step 3: Pull gemma4-heretic ───────────────────────────────────────

if ollama list 2>/dev/null | grep -q "gemma4-heretic"; then
  echo "✓ gemma4-heretic is already pulled"
else
  echo "→ Pulling gemma4-heretic (this may take a while, ~16 GB)..."
  ollama pull gemma4-heretic
  echo "✓ gemma4-heretic pulled"
fi

# ── Step 4: Verify model is accessible via OpenAI-compatible API ──────

MODEL_CHECK=$(curl -s http://localhost:11434/v1/models 2>/dev/null)
if echo "$MODEL_CHECK" | grep -q "gemma4-heretic"; then
  echo "✓ gemma4-heretic is accessible via OpenAI-compatible API"
else
  echo "✗ Model not found in API response"
  echo "  Response: $MODEL_CHECK"
  exit 1
fi

# ── Step 5: Build Claude Code ─────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR/package.json" ]; then
  echo "→ Building Claude Code..."
  cd "$SCRIPT_DIR"
  npm run build 2>&1 | tail -1
  echo "✓ Claude Code built"
else
  echo "⚠ Not in Claude Code directory, skipping build"
fi

# ── Step 6: Quick smoke test ──────────────────────────────────────────

echo ""
echo "→ Running smoke test..."
RESPONSE=$(curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma4-heretic",
    "messages": [{"role": "user", "content": "Say hello in one word"}],
    "max_tokens": 10
  }' 2>/dev/null)

if echo "$RESPONSE" | grep -q "choices"; then
  echo "✓ Smoke test passed — model is responding"
else
  echo "✗ Smoke test failed"
  echo "  Response: $RESPONSE"
  exit 1
fi

# ── Done ──────────────────────────────────────────────────────────────

echo ""
echo "╭──────────────────────────────────────────────────╮"
echo "│  ✓ Setup complete!                               │"
echo "│                                                  │"
echo "│  Run with:                                       │"
echo "│    ./run.sh heretic                              │"
echo "│                                                  │"
echo "│  Features:                                       │"
echo "│    • Uncensored local model (gemma4-heretic)     │"
echo "│    • No safety layer in system prompt            │"
echo "│    • All Claude Code tools available             │"
echo "│    • DuckDuckGo web search via MCP               │"
echo "│    • Playwright browser via MCP                  │"
echo "│    • No permission prompts                       │"
echo "│    • Fully offline, no cloud API needed          │"
echo "│                                                  │"
echo "│  Other aliases:                                  │"
echo "│    ./run.sh uncensored   (same as heretic)       │"
echo "│    ./run.sh qwen-opus    (MLX Opus-distilled)    │"
echo "│    ./run.sh smart        (multi-model routing)   │"
echo "╰──────────────────────────────────────────────────╯"
