#!/bin/bash
# Claude Code Multi-Model Router — Full Installation
#
# Installs everything needed to run Claude Code with multi-model routing:
#   - Node.js / Bun runtime
#   - Ollama (local GGUF models)
#   - MLX-LM (local MLX models for Apple Silicon)
#   - DuckDuckGo MCP (web search for local models)
#   - Playwright MCP (browser automation)
#   - Environment variables (API keys)
#   - Builds Claude Code
#
# Usage:
#   chmod +x install.sh
#   ./install.sh
#
# After install:
#   ./run.sh              # Smart routing (default)
#   ./run.sh heretic      # Uncensored local model (Ollama)
#   ./run.sh heretic-mlx  # Uncensored local model (MLX, fast)
#   ./run.sh claude       # Claude Opus only
#   ./run.sh gemini       # Gemini only

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "╭──────────────────────────────────────────────────╮"
echo "│  Claude Code Multi-Model Router — Installation   │"
echo "╰──────────────────────────────────────────────────╯"
echo ""

# ── Step 1: Check system ──────────────────────────────────────────────

echo "── Step 1: System check ──"

if [[ "$OSTYPE" != "darwin"* ]]; then
  echo "⚠  Not macOS. Some features (MLX, Metal) won't be available."
fi

ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
  echo "✓ Apple Silicon detected ($ARCH)"
  HAS_APPLE_SILICON=true
else
  echo "⚠ Intel Mac detected. MLX models won't run (Apple Silicon only)."
  HAS_APPLE_SILICON=false
fi

# ── Step 2: Node.js / Bun ────────────────────────────────────────────

echo ""
echo "── Step 2: Runtime ──"

if command -v bun &>/dev/null; then
  echo "✓ Bun: $(bun --version)"
else
  echo "→ Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  echo "✓ Bun installed"
fi

if command -v node &>/dev/null; then
  echo "✓ Node.js: $(node --version)"
else
  echo "→ Installing Node.js..."
  if command -v brew &>/dev/null; then
    brew install node
  else
    echo "✗ Please install Node.js: https://nodejs.org"
    exit 1
  fi
fi

# ── Step 3: npm dependencies ─────────────────────────────────────────

echo ""
echo "── Step 3: Dependencies ──"

if [ -f package.json ]; then
  echo "→ Installing npm packages..."
  npm install --silent 2>&1 | tail -1
  echo "✓ npm packages installed"
fi

# ── Step 4: Ollama ────────────────────────────────────────────────────

echo ""
echo "── Step 4: Ollama (local GGUF models) ──"

if command -v ollama &>/dev/null; then
  echo "✓ Ollama installed"
else
  echo "→ Installing Ollama..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install ollama
  else
    curl -fsSL https://ollama.ai/install.sh | sh
  fi
  echo "✓ Ollama installed"
fi

# Start Ollama if not running
if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
  echo "→ Starting Ollama server..."
  ollama serve &>/dev/null &
  sleep 3
fi

if curl -s http://localhost:11434/api/tags &>/dev/null; then
  echo "✓ Ollama server running"
else
  echo "⚠ Ollama server not responding. Run 'ollama serve' manually."
fi

# ── Step 5: MLX-LM (Apple Silicon only) ──────────────────────────────

echo ""
echo "── Step 5: MLX-LM (Apple Silicon local inference) ──"

if [ "$HAS_APPLE_SILICON" = true ]; then
  if python3 -c "import mlx_lm" 2>/dev/null; then
    MLX_VER=$(python3 -c "import mlx_lm; print(mlx_lm.__version__)" 2>/dev/null)
    echo "✓ mlx-lm: $MLX_VER"
  else
    echo "→ Installing mlx-lm..."
    pip install mlx-lm hf_transfer 2>&1 | tail -1
    echo "✓ mlx-lm installed"
  fi
else
  echo "⊘ Skipped (not Apple Silicon)"
fi

# ── Step 6: Environment variables ─────────────────────────────────────

echo ""
echo "── Step 6: API Keys ──"

SHELL_RC="$HOME/.zshrc"
[ -f "$HOME/.bashrc" ] && SHELL_RC="$HOME/.bashrc"

NEED_KEYS=false

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo ""
  read -p "Enter your Anthropic API key (or press Enter to skip): " ANTHROPIC_KEY
  if [ -n "$ANTHROPIC_KEY" ]; then
    echo "export ANTHROPIC_API_KEY=\"$ANTHROPIC_KEY\"" >> "$SHELL_RC"
    export ANTHROPIC_API_KEY="$ANTHROPIC_KEY"
    echo "✓ ANTHROPIC_API_KEY saved to $SHELL_RC"
  else
    echo "⊘ Skipped. Set ANTHROPIC_API_KEY later for Claude models."
  fi
else
  echo "✓ ANTHROPIC_API_KEY is set"
fi

if [ -z "$GEMINI_API_KEY" ]; then
  echo ""
  read -p "Enter your Google Gemini API key (or press Enter to skip): " GEMINI_KEY
  if [ -n "$GEMINI_KEY" ]; then
    echo "export GEMINI_API_KEY=\"$GEMINI_KEY\"" >> "$SHELL_RC"
    export GEMINI_API_KEY="$GEMINI_KEY"
    echo "✓ GEMINI_API_KEY saved to $SHELL_RC"
  else
    echo "⊘ Skipped. Set GEMINI_API_KEY later for Gemini models."
  fi
else
  echo "✓ GEMINI_API_KEY is set"
fi

# ── Step 7: Pull default models ───────────────────────────────────────

echo ""
echo "── Step 7: Pull local models (optional) ──"

read -p "Pull gemma4-heretic for uncensored local inference? (~16GB) [y/N]: " PULL_HERETIC
if [[ "$PULL_HERETIC" =~ ^[Yy] ]]; then
  echo "→ Pulling gemma4-heretic..."
  ollama pull gemma4-heretic
  echo "✓ gemma4-heretic ready"
fi

if [ "$HAS_APPLE_SILICON" = true ]; then
  read -p "Download Qwen3.5-40B heretic MLX for fast uncensored inference? (~20GB) [y/N]: " PULL_MLX
  if [[ "$PULL_MLX" =~ ^[Yy] ]]; then
    echo "→ Downloading (this takes a while)..."
    HF_HUB_ENABLE_HF_TRANSFER=1 python3 -c "
from huggingface_hub import snapshot_download
path = snapshot_download('TheCluster/Qwen3.5-40B-Claude-4.6-Opus-Deckard-Heretic-Uncensored-Thinking-MLX-mxfp4', max_workers=8)
print('Downloaded to:', path)
"
    echo "✓ Qwen3.5-40B heretic MLX ready"
  fi
fi

# ── Step 8: Build Claude Code ─────────────────────────────────────────

echo ""
echo "── Step 8: Build ──"

echo "→ Building Claude Code..."
npm run build 2>&1 | tail -1
echo "✓ Build complete"

# ── Step 9: Make scripts executable ───────────────────────────────────

chmod +x run.sh setup-heretic.sh 2>/dev/null

# ── Done ──────────────────────────────────────────────────────────────

echo ""
echo "╭──────────────────────────────────────────────────╮"
echo "│  ✓ Installation complete!                        │"
echo "│                                                  │"
echo "│  Quick start:                                    │"
echo "│    ./run.sh              Smart routing            │"
echo "│    ./run.sh heretic      Uncensored (Ollama)      │"
echo "│    ./run.sh heretic-mlx  Uncensored (MLX, fast)   │"
echo "│    ./run.sh claude       Claude Opus only         │"
echo "│    ./run.sh gemini       Gemini Pro only          │"
echo "│    ./run.sh smart        Multi-model routing      │"
echo "│                                                  │"
echo "│  Models available:                               │"
if ollama list 2>/dev/null | grep -q heretic; then
echo "│    ✓ gemma4-heretic (Ollama)                     │"
fi
if [ -d ~/.cache/huggingface/hub/models--TheCluster--Qwen3.5-40B-* ]; then
echo "│    ✓ Qwen3.5-40B heretic (MLX)                   │"
fi
echo "│                                                  │"
echo "│  Docs: docs/multi-model-setup.md                 │"
echo "╰──────────────────────────────────────────────────╯"
