# makerlog.ai

**Your Development Environment. In Your Repo.**

Fork. Configure. Code with AI. Deploy Anywhere.

---

## What is makerlog.ai?

makerlog.ai is a developer-focused AI coding platform where **the repo IS the development environment**. Not a cloud IDE that mounts your code — the repo itself is a living, intelligent agent that understands every line, every commit, every architectural decision.

Built on the [cocapn](https://github.com/CedarBeach2019/cocapn) paradigm: clone it, add your API key, run it. That's it.

### Why repo-first development?

- **Your repo = your data.** No cloud lock-in. Everything lives in Git.
- **Your repo = your agent.** The agent is the repo. It doesn't search your code — it IS your code.
- **Your repo = your deploy.** Local, Docker, Cloudflare Workers, GitHub Codespaces — anywhere.

---

## Quick Start

### 60 Seconds to Running

```bash
# 1. Fork and clone
git clone https://github.com/CedarBeach2019/makerlog-ai.git
cd makerlog-ai

# 2. Configure your provider (just needs one API key)
export ANTHROPIC_API_KEY=sk-ant-...
# OR: export OPENAI_API_KEY=sk-...
# OR: export DEEPSEEK_API_KEY=sk-...
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
npm run deploy
```

---

## Provider Setup (BYOK)

Bring Your Own Key — use any LLM provider. makerlog.ai auto-detects from environment variables:

| Provider | Env Var | Base URL | Cost (input/output per 1M tokens) |
|----------|---------|----------|----------------------------------|
| Anthropic | `ANTHROPIC_API_KEY` | api.anthropic.com | $3 / $15 |
| OpenAI | `OPENAI_API_KEY` | api.openai.com | $2.50 / $10 |
| DeepSeek | `DEEPSEEK_API_KEY` | api.deepseek.com | $0.14 / $0.28 |
| Groq | `GROQ_API_KEY` | api.groq.com | $0.59 / $0.79 |
| Ollama | (none) | localhost:11434 | Free |
| Custom | `COCAPN_BASE_URL` | Any OpenAI-compatible URL | Custom |

Configure in `cocapn/cocapn.json`:

```json
{
  "provider": {
    "primary": "anthropic",
    "model": "claude-sonnet-4-6",
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
primary → fallback → local (Ollama)
```

---

## Runtime Options

| Runtime | Command | Use Case |
|---------|---------|----------|
| Local | `npm run dev` | Development |
| Docker | `docker compose up` | Self-hosted |
| Cloudflare Workers | `npm run deploy` | Production, edge |
| GitHub Codespaces | Open in Codespaces | Cloud dev |

---

## Tool System

The agent has tools, just like Claude Code:

| Tool | Description | Permission |
|------|-------------|------------|
| `file_read(path)` | Read file content | Allow |
| `file_write(path, content)` | Create/overwrite file | Ask |
| `file_edit(path, oldText, newText)` | Diff-based edit | Ask |
| `bash(command)` | Execute shell command | Ask |
| `search(query, path?)` | Search codebase | Allow |
| `git_log(limit?, path?)` | View git history | Allow |
| `git_diff(base?, head?)` | Show diff | Allow |
| `git_commit(message)` | Commit changes | Ask |

### How it works

The agent loop mirrors Claude Code's architecture:

```
User message → Build context → Send to LLM with tools defined
    → LLM responds with tool_use?
        → Yes: Check permission → Execute tool → Add result → Repeat
        → No: Stream text response to user
```

Max turns per conversation: configurable (default 50).

---

## Permission System

Like Claude Code, every tool execution goes through the permission system:

- **Allow**: Always execute (file_read, search)
- **Deny**: Never execute
- **Ask**: Prompt user for approval (file_write, bash, git_commit)

Configure in `cocapn/cocapn.json`:

```json
{
  "permissions": {
    "default": "ask",
    "rules": [
      { "tool": "file_read", "level": "allow" },
      { "tool": "bash", "level": "ask", "commandPattern": "^(git |npm |node |npx |ls |cat )" },
      { "tool": "file_write", "level": "ask", "pattern": "src/**" }
    ]
  }
}
```

For CI, set `dangerouslySkipPermissions: true`.

---

## Agent Intelligence

The agent doesn't just edit code — it understands the repo:

### Code Understanding
- Analyzes repo structure, entry points, dependencies
- Auto-generates `CLAUDE.md` with architecture documentation
- Explains any file, function, or pattern

### MCP (Model Context Protocol)
- Exposes repo tools via MCP for visiting agents
- Agents can visit your repo and walk away experts (kung-fu pattern)
- Resources: file content, search results, repo analysis

### A2A (Agent-to-Agent)
- Coordinate with other agents on multi-agent tasks
- Broadcast capabilities, share knowledge
- Fleet coordination support

### Auto-Research
- When the agent encounters an unknown concept, it auto-researches
- Fetches relevant documentation, summarizes findings
- Stores knowledge in memory for future reference (Karpathy pattern)

---

## Web Interface

### Landing Page (`/`)
Developer-focused landing with animated terminal demo showing the agent coding.

### IDE Interface (`/app`)
Full IDE-like web interface:
- **Left**: File tree (collapsible, file icons)
- **Center**: Code viewer/editor with syntax highlighting
- **Right**: Chat panel with streaming agent responses
- **Bottom**: Terminal output
- **Status bar**: Provider, model, token usage, cost

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

---

## Skill Injection (Kung-Fu Pattern)

makerlog.ai supports skill cartridges from the [I-Know-Kung-Fu](https://github.com/CedarBeach2019/I-Know-Kung-Fu) pattern:

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

## Architecture

```
makerlog-ai/
├── src/
│   ├── worker.ts           # Cloudflare Worker (Hono)
│   ├── agent/              # Agent core
│   │   ├── loop.ts         # Agentic tool_use loop
│   │   ├── permissions.ts  # Permission system
│   │   ├── context.ts      # Context window management
│   │   ├── soul.ts         # Developer soul
│   │   ├── memory.ts       # KV-backed memory
│   │   ├── intelligence.ts # Code understanding
│   │   ├── mcp.ts          # MCP server
│   │   ├── a2a.ts          # Agent-to-agent
│   │   └── research.ts     # Auto-research
│   ├── tools/              # Tool implementations
│   ├── providers/          # BYOK provider system
│   ├── channels/           # Telegram, Discord
│   └── billing/            # Usage billing
├── public/                 # Web interface
├── docker/                 # Docker setup
├── cocapn/                 # Agent config + soul + skills
└── template/               # Templates for new repos
```

---

## API Reference

### Chat
```
POST /api/chat
Body: { message: string, history?: Message[] }
Response: SSE stream of { type: 'text'|'tool_use'|'done', content: string }
```

### Files
```
GET  /api/files?path=          # List directory
GET  /api/files/content?path=  # Read file
PUT  /api/files/content        # Write file { path, content }
```

### Execute
```
POST /api/execute
Body: { command: string }
Response: { stdout: string, stderr: string, exitCode: number }
```

### Status
```
GET /api/status
Response: { provider: string, model: string, connected: boolean }
```

### Webhooks
```
POST /api/webhooks/telegram
POST /api/webhooks/discord
POST /api/webhooks/billing
```

---

## Comparison: makerlog.ai vs Claude Code

| Feature | makerlog.ai | Claude Code |
|---------|-------------|-------------|
| Paradigm | Repo-first (repo IS the agent) | Tool-first (agent works on repo) |
| Provider | BYOK — any provider | Anthropic only |
| Runtime | Local, Docker, Workers, Codespaces | CLI only |
| Data | Your repo, your Git | Cloud-hosted |
| Cost | Your API key, your rate | Claude subscription |
| Intelligence | RepoLearner, MCP, A2A | Built-in |
| Open Source | Fully open | Partially |

---

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a pull request

All commits by agentic workers: `Author: Superinstance`

---

## License

MIT — see [LICENSE](LICENSE).
