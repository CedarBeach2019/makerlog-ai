<p align="center">
  <img src="https://raw.githubusercontent.com/Lucineer/capitaine/master/docs/capitaine-logo.jpg" alt="Capitaine" width="120">
</p>

<h1 align="center">makerlog-ai</h1>

<p align="center">An AI agent that runs alongside your code. Fork-first, deploy to your own infra.</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#limitations">Limitations</a> ·
  <a href="https://github.com/Lucineer/makerlog-ai/issues">Issues</a>
</p>

---

**Live:** [makerlog-ai](https://makerlog-ai.casey-digennaro.workers.dev) · Open source MIT · Runs on Cloudflare Workers

You know the loop. You have an idea late, open multiple chat tabs, paste code around, and lose context. This runs in your own repository, maintains session memory, and stays within your workflow.

No SaaS, no waitlists. You fork it, you own it.

---

## Why this exists

Most AI assistants operate outside your actual work. They are browser tabs or third-party services that read your code and reset context frequently. We built this for iterative development—it's the tool we use daily to build the Cocapn Fleet.

## What makes this different

1. **Fork first.** You run an independent copy. There is no upstream instance controlling your agent.
2. **Zero lock-in.** The agent is a Cloudflare Worker comprising a few source files. All state is in your git history.
3. **No hidden orchestration.** Every action is committed to your repository where you can review or revert it.
4. **Part of the fleet.** It implements the fleet protocol, allowing coordination with 40+ other purpose-built vessels when needed.

---

## Quick Start

Get a private agent running in under two minutes:

```bash
gh repo fork Lucineer/makerlog-ai --clone
cd makerlog-ai
npx wrangler login
echo "your-github-token" | npx wrangler secret put GITHUB_TOKEN
echo "your-llm-key" | npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler deploy
```

Your agent is now live at the provided Worker URL.

## Features

- **BYOK v2** — Secrets stored in Cloudflare's secret store, never in code.
- **Multi-model support** — Works with DeepSeek, SiliconFlow, DeepInfra, Moonshot, z.ai, and local models.
- **Session memory** — Maintains context across conversations over time.
- **PII safety** — Automatically dehydrates sensitive data before LLM calls.
- **Rate limiting** — Configurable per-IP limits with guest tokens.
- **Standard health checks** — `/health` endpoint for monitoring.
- **Fleet coordination** — Implements CRP-39 for cross-vessel events and trust.

## Limitations

This is a single-purpose agent focused on code companionship. It does not include a UI for non-technical users and requires basic familiarity with Cloudflare Workers and GitHub.

## Architecture

A single-file Cloudflare Worker with zero runtime dependencies. The entire logic is contained in `src/index.js` and uses Cloudflare's native KV for persistence, Durable Objects for session state, and the platform's secret management.

---

<div align="center">
  <br>
  <p>Part of the <a href="https://the-fleet.casey-digennaro.workers.dev">Cocapn Fleet</a> · Learn more at <a href="https://cocapn.ai">cocapn.ai</a></p>
  <p>Attribution: Superinstance & Lucineer (DiGennaro et al.)</p>
</div>