#!/bin/bash
# Setup gemma4-heretic (uncensored local model) for Claude Code
#
# This script:
#   1. Installs Ollama + llama.cpp if not present
#   2. Pulls gemma4-heretic model via Ollama
#   3. Installs llama.cpp for fast Metal inference
#   4. Builds Claude Code
#
# Usage:
#   chmod +x setup-heretic.sh
#   ./setup-heretic.sh
#
# After setup, just run:
#   ./run.sh heretic
#   (run.sh auto-starts llama-server with Metal + no-thinking)

set -e

echo "╭──────────────────────────────────────────────────╮"
echo "│  gemma4-heretic Setup for Claude Code            │"
echo "│  Uncensored local model, Metal GPU, no filters   │"
echo "╰──────────────────────────────────────────────────╯"
echo ""

# ── Step 1: Ollama ────────────────────────────────────────────────────

if command -v ollama &>/dev/null; then
  echo "✓ Ollama installed"
else
  echo "→ Installing Ollama..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install ollama
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    curl -fsSL https://ollama.ai/install.sh | sh
  else
    echo "✗ Unsupported OS. Install Ollama manually: https://ollama.com"
    exit 1
  fi
fi

# Start Ollama if not running
if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
  echo "→ Starting Ollama..."
  ollama serve &>/dev/null &
  sleep 3
fi

# ── Step 2: Pull gemma4-heretic ───────────────────────────────────────

if ollama list 2>/dev/null | grep -q "gemma4-heretic"; then
  echo "✓ gemma4-heretic already pulled"
else
  echo "→ Pulling gemma4-heretic (~16 GB)..."
  ollama pull gemma4-heretic
fi

# ── Step 3: llama.cpp ─────────────────────────────────────────────────

if command -v llama-server &>/dev/null; then
  echo "✓ llama.cpp installed"
else
  echo "→ Installing llama.cpp (Metal GPU support)..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install llama.cpp
  else
    echo "✗ Install llama.cpp manually: https://github.com/ggml-org/llama.cpp"
    exit 1
  fi
fi

# ── Step 4: Verify GGUF file ─────────────────────────────────────────

GGUF_PATH="$HOME/.ollama/models/blobs/sha256-92a767fc165395c69291768a53526dace172d23a44daef4cdd0f7a6175b7489b"
if [ -f "$GGUF_PATH" ]; then
  echo "✓ GGUF model file found ($(du -h "$GGUF_PATH" | awk '{print $1}'))"
else
  echo "✗ GGUF file not found. Re-pull: ollama pull gemma4-heretic"
  exit 1
fi

# ── Step 5: Build Claude Code ─────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ]; then
  echo "→ Building Claude Code..."
  cd "$SCRIPT_DIR"
  npm run build 2>&1 | tail -1
  echo "✓ Build complete"
fi

# ── Done ──────────────────────────────────────────────────────────────

echo ""
echo "╭──────────────────────────────────────────────────╮"
echo "│  ✓ Setup complete!                               │"
echo "│                                                  │"
echo "│  Run:                                            │"
echo "│    ./run.sh heretic                              │"
echo "│                                                  │"
echo "│  run.sh will auto-start llama-server with:       │"
echo "│    • Metal GPU acceleration                      │"
echo "│    • Thinking disabled (fast responses)          │"
echo "│    • 128K context window                         │"
echo "│    • DRY anti-loop sampling (code-tuned)         │"
echo "│    • Content safety filter                       │"
echo "│    • All Claude Code tools available              │"
echo "╰──────────────────────────────────────────────────╯"
