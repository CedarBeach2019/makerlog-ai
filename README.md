# makerlog.ai

**Your Development Environment. Living in Your Repo.**

Fork. Configure. Code with AI. Deploy Anywhere.

---

## What is makerlog.ai?

makerlog.ai is a developer-focused AI coding platform where **the repo IS the development environment**. Not a cloud IDE that mounts your code — the repo itself is a living, intelligent agent that understands every line, every commit, every architectural decision.

Built on the [cocapn](https://github.com/Lucineer/cocapn) paradigm: clone it, add your API key, run it. That's it.

### Why repo-first development?

- **Your repo = your data.** No cloud lock-in. Everything lives in Git.
- **Your repo = your agent.** The agent is the repo. It doesn't search your code — it IS your code.
- **Your repo = your deploy.** Local, Docker, Cloudflare Workers, GitHub Codespaces — anywhere.
- **Your repo = your cost.** BYOK — bring any LLM provider. You control pricing.

---

## Architecture Overview

```
                    makerlog.ai Architecture
                    ======================

    ┌─────────────────────────────────────────────────┐
    │                   Browser                        │
    │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
    │  │ Landing   │  │ IDE      │  │ Settings     │  │
    │  │ Page      │  │ (app.js) │  │ Modal        │  │
    │  └─────┬─────┘  └────┬─────┘  └──────┬───────┘  │
    └────────┼─────────────┼───────────────┼──────────┘
             │             │               │
             ▼             ▼               ▼
    ┌─────────────────────────────────────────────────┐
    │              Hono Router (worker.ts)              │
    │  ┌─────────┐ ┌────────┐ ┌──────┐ ┌──────────┐  │
    │  │ /api/   │ │ /api/  │ │/api/ │ │ /api/    │  │
    │  │ chat    │ │ files  │ │exec  │ │ webhooks │  │
    │  └────┬────┘ └───┬────┘ └──┬───┘ └────┬─────┘  │
    └───────┼──────────┼─────────┼──────────┼────────┘
            │          │         │          │
            ▼          ▼         ▼          ▼
    ┌─────────────────────────────────────────────────┐
    │                Agent Core                         │
    │  ┌──────────┐ ┌───────────┐ ┌────────────────┐  │
    │  │ Agent    │ │ Permission│ │ Context        │  │
    │  │ Loop     │ │ Manager   │ │ Manager        │  │
    │  └────┬─────┘ └───────────┘ └────────────────┘  │
    │       │                                          │
    │  ┌────▼─────┐ ┌───────────┐ ┌────────────────┐  │
    │  │ Memory   │ │ Soul      │ │ Intelligence   │  │
    │  │ Store    │ │ Engine    │ │ Engine         │  │
    │  └──────────┘ └───────────┘ └────────────────┘  │
    └────────┬──────────────────────────┬──────────────┘
             │                          │
             ▼                          ▼
    ┌─────────────────┐     ┌──────────────────────────┐
    │  BYOK Providers  │     │  Tools                   │
    │ ┌─────────────┐ │     │ ┌──────┐ ┌─────────────┐ │
    │ │ Anthropic   │ │     │ │ file │ │ bash        │ │
    │ │ OpenAI      │ │     │ │ read │ │ execute     │ │
    │ │ DeepSeek    │ │     │ ├──────┤ ├─────────────┤ │
    │ │ Groq        │ │     │ │ file │ │ search      │ │
    │ │ Ollama      │ │     │ │ write│ │ codebase    │ │
    │ │ Custom URL  │ │     │ ├──────┤ ├─────────────┤ │
    │ └──────┬──────┘ │     │ │ file │ │ git_log     │ │
    │        │        │     │ │ edit │ │ git_diff    │ │
    └────────┘        │     │ └──────┘ │ git_commit  │ │
         Fallback     │     └──────────┴─────────────┘ │
         Chain        │     └──────────────────────────┘
    └─────────────────┘
```

---

## Quick Start

### 60 Seconds to Running

```bash
# 1. Fork and clone
git clone https://github.com/Lucineer/makerlog-ai.git
cd makerlog-ai

# 2. Configure your provider (just needs one API key)
export ANTHROPIC_API_KEY=sk-ant-...
# OR: export OPENAI_API_KEY=sk-...
# OR: export DEEPSEEK_API_KEY=sk-...
# OR: export GROQ_API_KEY=gsk_...
# OR: nothing (uses Ollama locally)

# 3. Run
npm install
npm run dev
# → Open http://localhost:8787
```

### Docker

```bash
docker compose -f docker/docker-compose.yml up
```

### Cloudflare Workers

```bash
# Set secrets in wrangler.toml or via dashboard
npm run deploy
```

### GitHub Codespaces

Open the repo in Codespaces — it just works. Set your API key as a Codespace secret.

---

## Provider Setup (BYOK)

Bring Your Own Key — use any LLM provider. makerlog.ai auto-detects from environment variables:

| Provider | Env Var | Default Model | Cost (input/output per 1M tokens) |
|----------|---------|---------------|----------------------------------|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` | $3.00 / $15.00 |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o` | $2.50 / $10.00 |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-chat` | $0.14 / $0.28 |
| Groq | `GROQ_API_KEY` | `llama-3.1-70b-versatile` | $0.59 / $0.79 |
| Ollama | `OLLAMA_HOST` | `llama3` (auto-detect) | Free |
| Custom | `COCAPN_BASE_URL` | Any | Custom |

Auto-detection priority: `COCAPN_PROVIDER` > `ANTHROPIC_API_KEY` > `OPENAI_API_KEY` > `DEEPSEEK_API_KEY` > `GROQ_API_KEY` > `OLLAMA_HOST` > default Ollama.

### Configuration

Configure in `cocapn/cocapn.json`:

```json
{
  "provider": {
    "primary": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "fallback": {
      "provider": "deepseek",
      "model": "deepseek-coder"
    }
  }
}
```

### Fallback Chain

If your primary provider is down or rate-limited, makerlog automatically falls back:
```
primary → fallback → error (with both failure messages)
```

### Custom Base URL

Point at any OpenAI-compatible endpoint (Together, Mistral, local vLLM, etc.):

```json
{
  "provider": {
    "primary": "custom",
    "baseUrl": "http://localhost:8000/v1/chat/completions",
    "model": "my-model",
    "apiKey": "optional-key"
  }
}
```

### Token Counting

Each provider reports exact token usage when available (Anthropic, OpenAI, DeepSeek). For providers that don't report tokens, the system uses a heuristic estimate (~4 chars per token). All usage is tracked in the status bar and available via `/api/status`.

---

## Runtime Options

| Runtime | Command | Use Case | Git-backed Memory |
|---------|---------|----------|------------------|
| Local | `npm run dev` | Development | Full |
| Docker | `docker compose up` | Self-hosted | Full |
| Cloudflare Workers | `npm run deploy` | Production, edge | D1/KV fallback |
| GitHub Codespaces | Open in Codespaces | Cloud dev | Full |
| Air-gapped | `OLLAMA_HOST=http://localhost:11434` | Secure environments | Full |

Environment auto-detects: `CLOUDFLARE_ACCOUNT_ID` → Workers, `DOCKER_CONTAINER` → Docker, `AIR_GAPPED=1` → local models only.

---

## Tool System

The agent has tools, just like Claude Code:

| Tool | Description | Default Permission |
|------|-------------|-------------------|
| `file_read(path)` | Read file content | Allow |
| `file_write(path, content)` | Create/overwrite file | Ask |
| `file_edit(path, oldText, newText)` | Diff-based edit | Ask |
| `bash(command)` | Execute shell command | Ask |
| `search(query, path?)` | Search codebase (ripgrep-style) | Allow |
| `git_log(limit?, path?)` | View git history | Allow |
| `git_diff(base?, head?)` | Show diff between refs | Allow |
| `git_commit(message)` | Commit staged changes | Ask |

### How the Agent Loop Works

The agent loop mirrors Claude Code's architecture:

```
User message
    │
    ▼
Build context (system prompt + history + repo state)
    │
    ▼
Send to LLM with tool definitions
    │
    ▼
LLM responds
    ├── tool_use: Check permission → Execute tool → Add result → Repeat
    └── text only: Stream response to user → Done
```

Max turns per conversation: configurable (default 50). Streaming mode yields text chunks in real-time while processing tool calls internally.

### Streaming Mode

The agent supports two modes:
1. **`run()`** — Returns the complete response after all turns finish.
2. **`runStream()`** — Yields text chunks as they arrive, processing tool calls between turns. Ideal for the web IDE chat panel.

---

## Permission System

Every tool execution goes through the permission system:

- **Allow**: Always execute without prompting (file_read, search, git_log, git_diff)
- **Deny**: Never execute, return error to agent
- **Ask**: Prompt user for approval (file_write, file_edit, bash, git_commit)

### Resolution Order

1. `dangerouslySkipPermissions: true` → allow everything (CI mode)
2. Bash-specific: check deny list (rm -rf /, mkfs, fork bombs) → check allow list (git status, ls, cat, npm test) → fall through to rules
3. Walk rules in order (last match wins)
4. Default: deny

### Configuration

```json
{
  "permissions": {
    "dangerouslySkipPermissions": false,
    "rules": [
      { "tool": "file_read", "level": "allow" },
      { "tool": "search", "level": "allow" },
      { "tool": "git_log", "level": "allow" },
      { "tool": "git_diff", "level": "allow" },
      { "tool": "file_write", "level": "ask", "pattern": "src/**" },
      { "tool": "file_edit", "level": "ask" },
      { "tool": "bash", "level": "ask", "commandPattern": "^(git |npm |node |npx |ls |cat )" },
      { "tool": "git_commit", "level": "ask" }
    ]
  }
}
```

### Bash Command Lists

**Always allowed**: `git status`, `git log`, `git diff`, `git branch`, `ls`, `cat`, `head`, `tail`, `echo`, `pwd`, `which`, `node --version`, `npm --version`, `npx vitest`, `npx tsc`

**Always denied**: `rm -rf /`, `rm -rf ..`, `rm -rf ~`, `mkfs`, `dd`, fork bombs

---

## Agent Intelligence

The agent doesn't just edit code — it understands the repo through multiple intelligence layers:

### Code Understanding
- Analyzes repo structure, entry points, dependencies
- Detects architecture patterns (Workers, Next.js, monorepo, Go, Rust, Python)
- Auto-generates `CLAUDE.md` with architecture documentation
- Explains any file, function, or pattern on request

### MCP (Model Context Protocol)
- Exposes repo tools via MCP for visiting agents
- Agents can visit your repo and walk away experts (kung-fu pattern)
- Resources: file content, search results, repo analysis
- Zero external dependencies

### A2A (Agent-to-Agent)
- Coordinate with other agents on multi-agent tasks
- Broadcast capabilities, share knowledge
- Fleet coordination support
- Zero external dependencies

### Auto-Research (Karpathy Pattern)
- When the agent encounters an unknown concept, it auto-researches
- Fetches relevant documentation, summarizes findings
- Stores knowledge in persistent memory for future reference

### Persistent Memory
- KV-backed store with confidence decay
- Five source types: explicit (1.0), preference (0.9), error-pattern (0.8), implicit (0.7), git-derived (0.6)
- Max 1000 entries, pruned by confidence
- Decay runs every 6 hours, explicit entries never decay

---

## Web Interface

### Landing Page (`/`)
Developer-focused landing with:
- Animated terminal demo showing agent coding in real-time
- Feature grid (BYOK, Multi-Runtime, Agent Intelligence, MCP/A2A, Billing, Open Source)
- Comparison table vs Claude Code, Aider, Cursor
- 3-step quick start
- Tech stack badges

### IDE Interface (`/app`)
Full IDE-like web interface:
- **Left**: File tree with expandable folders, file type icons, context menu
- **Center**: Code viewer with line numbers and syntax highlighting (JS, TS, JSON, MD, CSS, HTML)
- **Right**: Chat panel with streaming agent responses, slash commands (`/help`, `/clear`, `/model`, `/provider`, `/compare-branches`)
- **Bottom**: Terminal output panel with command history
- **Status bar**: Provider, model, token usage, cost, connection status
- **Split view**: Side-by-side file comparison
- **Settings modal**: Provider, model, API key, custom endpoint

---

## Billing (Optional)

Public repos can enable billing for cloud compute:

```json
{
  "billing": {
    "enabled": true,
    "hourlyRate": 0.50,
    "perTokenRate": 0.002
  }
}
```

- Hourly rate for cloud compute (Cloudflare Docker)
- Per-token rate for premium AI models
- Usage tracking per user via D1 database
- Webhook notifications for billing events
- Access gate: returns 429 when quota exceeded

---

## Skill Injection (Kung-Fu Pattern)

makerlog.ai supports skill cartridges from the [I-Know-Kung-Fu](https://github.com/Lucineer/I-Know-Kung-Fu) pattern:

1. Create a skill in `cocapn/skills/`
2. Each skill has: `injection_payload` (system prompt addon + context knowledge)
3. The agent auto-primes skills based on the task
4. Visiting agents can download skills and walk away experts

```bash
cocapn/skills/
├── README.md           # How to add skills
├── react-expert/       # Example skill
│   ├── skill.json      # Skill definition
│   └── knowledge.md    # Context knowledge
└── devops/             # Another skill
    ├── skill.json
    └── knowledge.md
```

---

## API Reference

### Chat (Streaming SSE)
```
POST /api/chat
Body: { message: string, history?: Array<{ role: string, content: string }>, userId?: string }
Response: SSE stream
  event: token
  data: { content: string, done: boolean }
  event: done
  data: { totalTokens: number }
```

### Files
```
GET  /api/files?path=           # List directory (R2-backed)
Response: { files: [{key, size, modified}], folders: [{key, type}] }

GET  /api/files/content?path=   # Read file content
Response: { path, content, size, modified }

PUT  /api/files/content         # Write file
Body: { path: string, content: string }
Response: { ok: true, path }
```

### Execute (Local Bridge Required)
```
POST /api/execute
Body: { command: string }
Response: { stdout: string, stderr: string, exitCode: number }
Note: Returns 501 on Cloudflare Workers — requires local bridge.
```

### Status
```
GET /api/status
Response: { status, provider, providers: {anthropic, openai, deepseek, groq, ollama}, billingEnabled, timestamp }
```

### MCP Discovery
```
GET /api/mcp
Response: { name, version, capabilities: { tools, resources }, endpoint }
```

### Usage
```
GET /api/usage?userId=xxx
Response: { enabled, report?, access? }
```

### Webhooks
```
POST /api/webhooks/telegram     # Telegram bot webhook
POST /api/webhooks/discord      # Discord interaction webhook
POST /api/webhooks/billing      # Billing event webhook
```

---

## Comparison

### makerlog.ai vs Claude Code

| Feature | makerlog.ai | Claude Code |
|---------|-------------|-------------|
| Paradigm | Repo-first (repo IS the agent) | Tool-first (agent works on repo) |
| LLM Provider | BYOK — any provider | Anthropic only |
| Runtime | Local, Docker, Workers, Codespaces | CLI only |
| Data Ownership | Your repo, your Git | Cloud-hosted sessions |
| Cost | Your API key, your rate | Claude subscription ($20-200/mo) |
| Memory | Persistent, confidence decay | Session-based |
| Agent Protocols | MCP + A2A built-in | MCP client |
| Web Interface | Full IDE in browser | CLI only |
| Open Source | Fully open (MIT) | Closed source |

### makerlog.ai vs Aider

| Feature | makerlog.ai | Aider |
|---------|-------------|-------|
| Interface | Web IDE + CLI | CLI only |
| Memory | Persistent KV store with decay | None (stateless) |
| Multi-provider | 5+ built-in + custom URL | BYOK (multiple) |
| Deployment | Local, Docker, Workers, air-gapped | CLI only |
| Agent protocols | MCP server + A2A | None |
| Repo understanding | Architecture detection, auto CLAUDE.md | Git-based context |
| Skill system | Kung-Fu injection cartridges | Custom instructions |
| Open Source | MIT | Apache 2.0 |

### makerlog.ai vs Cursor

| Feature | makerlog.ai | Cursor |
|---------|-------------|--------|
| Paradigm | Repo-first, portable | Editor-first, desktop app |
| LLM Provider | BYOK — any provider | Own models + limited BYOK |
| Cost | Your API key | $20-40/mo subscription |
| Deployment | Docker, Workers, air-gapped | Desktop app only |
| Data | Your repo, your Git | Cloud + local |
| Web access | Browser-based IDE | Desktop editor |
| Agent protocols | MCP + A2A | None |
| Open Source | Fully open (MIT) | Closed source |

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run type checking: `npm run typecheck`
5. Run tests: `npm test`
6. Commit: conventional commits preferred
7. Push and submit a pull request

All commits by agentic workers: `Author: Superinstance`

### Development Setup

```bash
git clone https://github.com/Lucineer/makerlog-ai.git
cd makerlog-ai
npm install
npm run dev        # Start dev server on :8787
npm run typecheck  # Type check all TS files
npm test           # Run vitest
```

### Project Structure

```
makerlog-ai/
├── src/
│   ├── worker.ts           # Cloudflare Worker (Hono) — main entry point
│   ├── agent/              # Agent core
│   │   ├── loop.ts         # Agentic tool_use loop (run + runStream)
│   │   ├── permissions.ts  # Permission system (allow/deny/ask)
│   │   ├── context.ts      # Context window management + pruning
│   │   ├── soul.ts         # Developer soul (soul.md parser)
│   │   ├── memory.ts       # KV-backed persistent memory with decay
│   │   ├── intelligence.ts # Repo analysis + CLAUDE.md generation
│   │   ├── mcp.ts          # MCP server for visiting agents
│   │   ├── a2a.ts          # Agent-to-agent protocol
│   │   └── research.ts     # Auto-research (Karpathy pattern)
│   ├── tools/              # Tool implementations
│   │   ├── file-read.ts    # Read file content
│   │   ├── file-write.ts   # Create/overwrite files
│   │   ├── file-edit.ts    # Diff-based file editing
│   │   ├── bash.ts         # Shell command execution
│   │   ├── search.ts       # Codebase search
│   │   ├── git.ts          # Git operations (log, diff, commit)
│   │   └── index.ts        # Tool registry
│   ├── providers/          # BYOK provider system
│   │   ├── anthropic.ts    # Anthropic Messages API (streaming)
│   │   ├── openai.ts       # OpenAI-compatible (streaming)
│   │   ├── deepseek.ts     # DeepSeek via OpenAI-compat
│   │   ├── groq.ts         # Groq ultra-fast inference
│   │   ├── ollama.ts       # Local models (auto-detect)
│   │   └── index.ts        # Provider registry + fallback chain
│   ├── channels/           # External integrations
│   │   ├── telegram.ts     # Telegram bot channel
│   │   ├── discord.ts      # Discord bot channel
│   │   └── normalize.ts    # Message normalization
│   └── billing/            # Usage billing
│       └── index.ts        # Billing manager + D1
├── public/                 # Web interface
│   ├── index.html          # Landing page
│   ├── app.html            # IDE interface
│   ├── css/style.css       # Monokai dev theme
│   └── js/app.js           # Vanilla JS IDE (no deps)
├── docker/                 # Docker setup
├── cocapn/                 # Agent config + soul + skills
│   ├── cocapn.json         # Main config
│   ├── soul.md             # Agent personality
│   └── skills/             # Skill cartridges
├── template/               # Templates for new repos
├── wrangler.toml           # Cloudflare Workers config
├── tsconfig.json           # TypeScript strict config
└── package.json            # ESM, Hono, Vitest
```

---

## License

MIT — see [LICENSE](LICENSE).

---

Built with [cocapn](https://github.com/Lucineer/cocapn) — the repo-first agent paradigm.
