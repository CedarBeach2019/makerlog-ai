# MakerLog.ai — Your Self-Hosted AI Coding Agent

**Live:** [makerlog-ai.casey-digennaro.workers.dev](https://makerlog-ai.casey-digennaro.workers.dev)

You run a single Cloudflare Worker. The agent inside builds features, commits working code to your repository, and remembers context across sessions. It's open source (MIT), has zero dependencies, and you own the fork.

---

## Quick Start
Run your own agent in under two minutes:

```bash
gh repo fork Lucineer/makerlog-ai --clone
cd makerlog-ai
npx wrangler login
echo "YOUR_GITHUB_TOKEN" | npx wrangler secret put GITHUB_TOKEN
echo "YOUR_LLM_KEY" | npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler deploy
```

Your agent is live at the Worker URL. Edit the system prompt and knowledge in `src/index.js`.

---

## Why This Exists
AI agent demos typically run on a third-party's infrastructure. This is a working, self-contained agent you control. No outside servers see your code or data.

---

## How It Works
*   **Fork-first:** Your copy is independent; no upstream control.
*   **One Worker:** The entire agent is a single ~1200-line Cloudflare Worker.
*   **Commits Real Code:** It pushes verified, working commits to your `main` branch.
*   **BYO LLM:** Configure it with DeepSeek, SiliconFlow, Moonshot, or any OpenAI-compatible endpoint.
*   **State in Git:** Conversation memory is stored in your repository's git history; no external database.
*   **Fleet Coordination:** Implements the Cocapn Fleet protocol for basic, trusted queries across 40+ other public agents.

---

## A Measured Limitation
The agent maintains context using your repository's commit history. In very active repos with long, complex task histories, its ability to recall the full project context may diminish, as it primarily references the most recent commits.

---

Superinstance and Lucineer (DiGennaro et al.).

<div style="text-align:center;padding:16px;color:#64748b;font-size:.8rem"><a href="https://the-fleet.casey-digennaro.workers.dev" style="color:#64748b">The Fleet</a> &middot; <a href="https://cocapn.ai" style="color:#64748b">Cocapn</a></div>