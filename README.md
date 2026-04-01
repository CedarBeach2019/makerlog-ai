# MakerLog — The Repo-Native Coding Agent

> *Not a coding agent that works on your repo. A coding agent that IS your repo.*

## The Core Insight

Claude Code is a tourist. It visits your repo, reads your files, makes changes, and leaves. Every session starts from scratch. It has no memory of yesterday's work, no understanding of why you made the decisions you made, no accumulated wisdom about your codebase.

MakerLog is the local. It lives in your repo. It has been here since day one. It knows every commit, every decision, every mistake, every pattern. It doesn't retrieve context to decide what to do — it IS the context. Knowledge and code are the same layer.

## What Makes It Different

### Knowledge IS Behavior
In Claude Code: `prompt → agent → retrieve context → tool calls → file edits → tests`
In MakerLog: `knowledge changes → agent behavior changes immediately`

When you add a concept to the repo's knowledge base, the agent is immediately smarter. No intermediate retrieval step. No filtering through multiple agents. The vector DB isn't a tool the agent calls — it's part of the agent's behavior.

### Memory IS the Agent
The repo's accumulated context (files, commits, decisions, mistakes, patterns) is what makes it smart. Not a separate vector DB query. Not a context window stuffed with RAG results. The repo itself is the agent's brain.

### Settings = Knowledge
Changing what the agent knows is a settings change, not a code change. Add a new architectural pattern to the knowledge base → the agent uses it. Record a mistake → the agent avoids it. Log a preference → the agent respects it.

### The Agent Grows With the Project
After 6 months, MakerLog knows:
- Every architectural decision and why it was made
- Every bug that was fixed and what caused it
- Every pattern the team prefers and avoids
- Every API endpoint, its history, and its quirks
- Every test failure and what it taught

No new hire — human or AI — can compete with that accumulated context.

## Architecture

```
makerlog-ai/
├── src/
│   ├── worker.ts          # Cloudflare Worker entry point
│   ├── agent/
│   │   ├── loop.ts        # Agent execution loop (plan → act → verify)
│   │   ├── memory.ts      # Persistent memory (KV-backed, grows with repo)
│   │   ├── context.ts     # Context window management (smart ~4K token selection)
│   │   ├── intelligence.ts # Code explanation, impact assessment
│   │   ├── permissions.ts  # Permission model (safer than Claude Code)
│   │   ├── soul.ts        # Agent personality and behavior
│   │   ├── mcp.ts         # MCP server integration
│   │   ├── a2a.ts         # Agent-to-agent communication
│   │   └── research.ts    # Background research capability
│   ├── tools/
│   │   ├── file-read.ts   # Read files with context awareness
│   │   ├── file-write.ts  # Write files with validation
│   │   ├── file-edit.ts   # Edit files with diff awareness
│   │   ├── bash.ts        # Shell execution with sandboxing
│   │   ├── git.ts         # Git operations with commit analysis
│   │   └── search.ts      # Code search with pattern recognition
│   ├── providers/
│   │   ├── deepseek.ts    # DeepSeek (default, cheap, good reasoning)
│   │   ├── anthropic.ts   # Anthropic Claude (via BYOK)
│   │   ├── openai.ts      # OpenAI GPT (via BYOK)
│   │   ├── groq.ts        # Groq (fast, cheap)
│   │   └── ollama.ts      # Ollama (local, offline, air-gapped)
│   ├── vibe/
│   │   └── glue.ts        # Natural language → structured task
│   ├── vision/
│   │   ├── pipeline.ts    # Multi-resolution image pipeline
│   │   ├── sprites.ts     # Sprite generation
│   │   └── dev-assets.ts  # Development asset generation
│   ├── a2a/
│   │   └── agent-bridge.ts # Cross-agent communication
│   ├── analytics/
│   │   └── cost-tracker.ts # Token usage and cost tracking
│   ├── billing/
│   │   └── index.ts       # Usage-based billing
│   └── channels/
│       ├── telegram.ts    # Telegram integration
│       ├── discord.ts     # Discord integration
│       └── normalize.ts   # Channel message normalization
└── tests/
```

## Comparison: Claude Code vs MakerLog

| Feature | Claude Code | MakerLog |
|---------|-------------|----------|
| Memory | Per-session only | Persistent, grows with repo |
| Context | RAG retrieval each time | IS the agent's behavior |
| Knowledge | External to agent | Agent = knowledge |
| Cost | Anthropic API only | BYOK — any provider, any model |
| Offline | No | Yes (Ollama, llama.cpp) |
| Air-gapped | No | Yes (Docker, Jetson, Pi) |
| A2A | No | Yes (fleet communication) |
| Multi-provider | Anthropic only | DeepSeek, Claude, GPT, Groq, Ollama |
| Permissions | Claude's model | Configurable, repo-native |
| Growth | Flat — same agent every session | Grows smarter every session |
| Ownership | Anthropic controls the model | You own the repo |
| Privacy | Prompts sent to Anthropic | Local LLM option, secrets in private repo |

## Why This Beats Claude Code

1. **Accumulation**: After 6 months, MakerLog has context no fresh Claude Code session can match
2. **Cost**: DeepSeek is 10x cheaper than Claude. Ollama is free.
3. **Sovereignty**: You own the repo. You own the agent. You own the knowledge.
4. **Flexibility**: Switch providers. Switch models. Run local. Run cloud. Your choice.
5. **A2A**: Your coding agent talks to your other agents. Knowledge flows.
6. **Growth**: The agent gets better every day. Claude Code is the same every day.

## Deploy

### Local (free, instant)
```bash
git clone https://github.com/Lucineer/makerlog-ai.git
cd makerlog-ai
npm install
DEEPSEEK_API_KEY=your-key npx wrangler dev
```

### Cloudflare Workers (free tier)
```bash
# Set secrets
npx wrangler secret put DEEPSEEK_API_KEY
# Deploy
npx wrangler deploy
```

### Docker (air-gapped)
```bash
docker build -t makerlog .
docker run -e OLLAMA_BASE_URL=http://host.docker.internal:11434 makerlog
```

## The Claude Code Advantage We Keep

We implement the best of Claude Code's architecture:
- Agent loop (plan → act → verify → reflect)
- Tool system (file ops, bash, git, search)
- Permission model (configurable safety)
- Diff-aware editing
- Context window management
- Multi-turn conversation

Plus everything Claude Code doesn't have:
- Persistent memory
- Multi-provider BYOK
- A2A communication
- Offline/local capability
- Repo-native knowledge accumulation

## Build Status

✅ Core agent loop with tools
✅ Multi-provider (DeepSeek, Claude, GPT, Groq, Ollama)
✅ Memory and context management
✅ Permission system
✅ A2A agent bridge
✅ Vibe coding (NL → structured tasks)
✅ Vision pipeline
✅ Cost tracking
✅ Telegram and Discord channels
⚠️ Node.js compat flag needed for vision pipeline (added)
📝 Roadmap: Tree-sitter AST-aware edits, advanced permissions, fleet orchestration

## The Future

MakerLog isn't just a coding agent. It's the hippocampus of your development workflow. Claude Code is the prefrontal cortex — it plans and executes. MakerLog is the memory — it remembers, it recognizes patterns, it accumulates wisdom.

Together, they're better than either alone. But MakerLog alone, after months of accumulation, can outperform a fresh Claude Code session on any project it has lived in.

Author: Superinstance
