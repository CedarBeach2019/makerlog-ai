#!/usr/bin/env bash
# init.sh — One-command makerlog-ai setup
# Usage: npx makerlog-ai init  OR  curl -sL https://makerlog.ai/init.sh | bash
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

info()  { echo -e "${CYAN}[makerlog]${RESET} $*"; }
ok()    { echo -e "${GREEN}[makerlog]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[makerlog]${RESET} $*"; }
err()   { echo -e "${RED}[makerlog]${RESET} $*" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────

need_cmd() {
  command -v "$1" &>/dev/null || err "Requires '$1'. Install it first: https://nodejs.org"
}

need_cmd node
need_cmd npm
need_cmd git

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js 18+ required (you have v$(node -v)). Upgrade: https://nodejs.org"
fi

echo ""
echo -e "${BOLD}  makerlog.ai — init${RESET}"
echo -e "  ${CYAN}Your development environment. In your repo.${RESET}"
echo ""

# ── Provider Selection ───────────────────────────────────────────────────

echo -e "  ${BOLD}Which LLM provider?${RESET}"
echo "    1) Anthropic (Claude)"
echo "    2) DeepSeek"
echo "    3) OpenAI"
echo "    4) Ollama (local, free)"
echo "    5) Groq"
echo ""
read -rp "  Choice [1-5]: " PROVIDER_CHOICE

case "${PROVIDER_CHOICE:-1}" in
  1) PROVIDER="anthropic"; ENV_VAR="ANTHROPIC_API_KEY"; DEFAULT_MODEL="claude-sonnet-4-20250514" ;;
  2) PROVIDER="deepseek";  ENV_VAR="DEEPSEEK_API_KEY";  DEFAULT_MODEL="deepseek-chat" ;;
  3) PROVIDER="openai";    ENV_VAR="OPENAI_API_KEY";    DEFAULT_MODEL="gpt-4o" ;;
  4) PROVIDER="ollama";    ENV_VAR="OLLAMA_HOST";       DEFAULT_MODEL="llama3" ;;
  5) PROVIDER="groq";      ENV_VAR="GROQ_API_KEY";      DEFAULT_MODEL="llama-3.1-70b-versatile" ;;
  *) PROVIDER="anthropic"; ENV_VAR="ANTHROPIC_API_KEY"; DEFAULT_MODEL="claude-sonnet-4-20250514" ;;
esac

read -rp "  Model [${DEFAULT_MODEL}]: " MODEL_INPUT
MODEL="${MODEL_INPUT:-$DEFAULT_MODEL}"

if [ "$PROVIDER" != "ollama" ]; then
  read -rp "  ${ENV_VAR}: " API_KEY
  if [ -z "$API_KEY" ]; then
    warn "No API key entered. Set ${ENV_VAR} before running 'npm run dev'."
  fi
fi

# ── Install Dependencies ─────────────────────────────────────────────────

info "Installing dependencies..."
npm install --silent 2>/dev/null || npm install

# ── Create .makerlog/config.json ─────────────────────────────────────────

mkdir -p .makerlog

cat > .makerlog/config.json <<CONFIGEOF
{
  "provider": {
    "primary": "${PROVIDER}",
    "model": "${MODEL}"
  },
  "permissions": {
    "dangerouslySkipPermissions": false,
    "rules": [
      { "tool": "file_read", "level": "allow" },
      { "tool": "search", "level": "allow" },
      { "tool": "git_log", "level": "allow" },
      { "tool": "git_diff", "level": "allow" },
      { "tool": "file_write", "level": "ask", "pattern": "src/**" },
      { "tool": "file_edit", "level": "ask" },
      { "tool": "bash", "level": "ask" },
      { "tool": "git_commit", "level": "ask" }
    ]
  },
  "maxTurns": 50,
  "memory": {
    "maxEntries": 1000,
    "decayIntervalHours": 6
  }
}
CONFIGEOF

ok "Created .makerlog/config.json"

# ── Set API key as env var (not committed) ───────────────────────────────

if [ "$PROVIDER" != "ollama" ] && [ -n "$API_KEY" ]; then
  # Add to .dev.vars (Cloudflare Workers) and .env (local)
  if ! grep -q "$ENV_VAR" .dev.vars 2>/dev/null; then
    echo "${ENV_VAR}=${API_KEY}" >> .dev.vars
  fi
  if ! grep -q "$ENV_VAR" .env 2>/dev/null; then
    echo "${ENV_VAR}=${API_KEY}" >> .env
  fi
  ok "API key saved to .dev.vars and .env (gitignored)"
fi

# ── Create soul.md ───────────────────────────────────────────────────────

if [ ! -f cocapn/soul.md ]; then
  mkdir -p cocapn
  cat > cocapn/soul.md <<'SOULEOF'
# soul.md

This file defines your agent's personality and behavior.
Edit it freely — it's version-controlled, so changes are tracked.

## Instructions

Write in first person. Describe who you are, how you communicate,
and what you care about. The agent reads this on every startup.

## Example

> I am a concise, helpful coding partner. I prefer minimal diffs,
> clear commit messages, and tested code. I explain my reasoning
> when asked, but default to doing over discussing.
SOULEOF
  ok "Created cocapn/soul.md (edit to customize your agent)"
fi

# ── Create CLAUDE.md ─────────────────────────────────────────────────────

if [ ! -f CLAUDE.md ]; then
  cat > CLAUDE.md <<'CLAUDEEOF'
# CLAUDE.md — Repo-Agent Configuration

> This repo is a living agent powered by makerlog.ai.
> The repo IS the agent — not "an agent that works on a repo."

## How It Works

1. **soul.md** defines the agent's personality (edit to customize)
2. **.makerlog/config.json** holds provider and permission settings
3. **Memory** persists across sessions (stored in cocapn/)
4. **Tools** let the agent read, write, search, and execute code

## Getting Started

```bash
npm run dev          # Start the dev server on :8787
npm run typecheck    # Type check all TypeScript
npm test             # Run tests with vitest
```

## Key Concepts

- **BYOK**: Bring your own LLM API key (Anthropic, OpenAI, DeepSeek, Groq, Ollama)
- **Repo-first**: All data lives in Git. No cloud lock-in.
- **Multi-runtime**: Local, Docker, Cloudflare Workers, GitHub Codespaces

## Project Structure

- `src/worker.ts` — Main entry point (Hono on Cloudflare Workers)
- `src/agent/` — Agent core (loop, permissions, context, memory, soul)
- `src/tools/` — Tool implementations (file, bash, search, git)
- `src/providers/` — BYOK provider system
- `src/vision/` — Asset generation pipeline
- `src/vibe/` — Vibe coding glue (parse, generate, validate)
- `src/a2a/` — Cross-agent communication bridge
- `public/` — Web IDE and landing page
CLAUDEEOF
  ok "Created CLAUDE.md"
fi

# ── Ensure .gitignore covers secrets ─────────────────────────────────────

for f in .env .dev.vars .makerlog/; do
  if ! grep -q "$f" .gitignore 2>/dev/null; then
    echo "$f" >> .gitignore
  fi
done

# ── Run first test ───────────────────────────────────────────────────────

info "Running first test..."
if npx vitest run 2>/dev/null; then
  ok "All tests pass."
else
  warn "Some tests skipped or failed (expected for fresh init)."
fi

# ── Done ──────────────────────────────────────────────────────────────────

echo ""
echo -e "  ${GREEN}${BOLD}Your dev environment is alive. Start coding.${RESET}"
echo ""
echo -e "  ${CYAN}npm run dev${RESET}    → Open http://localhost:8787"
echo -e "  ${CYAN}Edit soul.md${RESET}   → Customize your agent"
echo -e "  ${CYAN}Edit CLAUDE.md${RESET}  → Update repo instructions"
echo ""
