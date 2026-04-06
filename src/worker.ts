import { addNode, addEdge, traverse, crossDomainQuery, findPath, domainStats, getDomainNodes } from './lib/knowledge-graph.js';
import { loadSeedIntoKG, FLEET_REPOS, loadAllSeeds } from './lib/seed-loader.js';
import { evapPipeline, getEvapReport, getLockStats } from './lib/evaporation-pipeline.js';
import { selectModel } from './lib/model-router.js';
import { trackConfidence, getConfidence } from './lib/confidence-tracker.js';
import { loadBYOKConfig, callLLM, generateSetupHTML } from './lib/byok.js';
import { evapPipeline } from './lib/evaporation-pipeline.js';

import { softActualize, confidenceScore } from './lib/soft-actualize.js';
import { deadbandCheck, deadbandStore, getEfficiencyStats } from './lib/deadband.js';
import { logResponse } from './lib/response-logger.js';

const FLEET_META = { version: '1.1.0', agentCount: 1, modules: ['byok', 'chat', 'seed'], seedVersion: '2024.04' };

const SEED = {
  domain: 'makerlog-ai',
  description: 'AI coding assistant — code analysis, refactoring, testing, architecture',
  practices: [
    'SOLID principles', 'DRY/KISS/YAGNI', 'Test-driven development',
    'Git branching strategies', 'Code review best practices',
    'Type safety in TypeScript', 'Dependency injection patterns',
    'CI/CD pipeline design', 'API design (REST/GraphQL)',
    'Performance optimization', 'Security best practices',
  ],
  systemPrompt: 'You are MakerLog, an AI coding assistant. Help developers build, analyze, and improve their code. Reference industry best practices and provide concrete examples.',
};

const indexHTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MakerLog.ai — Watch an AI Coding Agent Ship Features</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;line-height:1.6}a{color:#00d4ff}.hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem;background:radial-gradient(ellipse at 50% 0%,#1a1a2e 0%,#0a0a0a 70%)}.hero h1{font-size:clamp(2.5rem,6vw,4.5rem);background:linear-gradient(135deg,#00d4ff,#7b2ff7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:.5rem}.hero .tagline{font-size:1.3rem;color:#888;max-width:600px;margin-bottom:2rem}.demo-section{max-width:800px;width:100%;margin:0 auto 3rem;padding:0 1rem}.demo-label{color:#00d4ff;font-size:.85rem;text-transform:uppercase;letter-spacing:2px;margin-bottom:1rem;display:flex;align-items:center;gap:.5rem}.demo-label::before,.demo-label::after{content:'';flex:1;height:1px;background:#222}.chat{background:#111;border:1px solid #222;border-radius:12px;overflow:hidden;font-size:.9rem}.msg{padding:.8rem 1.2rem;border-bottom:1px solid #1a1a1a;display:flex;gap:.8rem}.msg:last-child{border-bottom:none}.msg.user{background:#0d0d1a}.msg.agent{background:#111}.avatar{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.75rem;flex-shrink:0}.msg.user .avatar{background:#7b2ff7;color:#fff}.msg.agent .avatar{background:#00d4ff;color:#000;font-weight:700}.msg-body{flex:1}.msg-name{font-size:.75rem;color:#555;margin-bottom:.2rem}.msg-text{color:#ccc;line-height:1.5}.msg-text code{background:#1a1a2e;padding:.15rem .4rem;border-radius:3px;font-size:.82rem;color:#00d4ff;font-family:'Fira Code',monospace}.msg-text pre{background:#0a0a0a;border:1px solid #222;border-radius:6px;padding:.8rem;margin:.5rem 0;overflow-x:auto;font-size:.8rem;color:#00d4ff;font-family:'Fira Code',monospace}.msg-text .label{color:#f59e0b;font-size:.75rem;font-weight:600}.byok{max-width:600px;width:100%;margin:0 auto 2rem;padding:0 1rem}.byok h3{color:#00d4ff;margin-bottom:.8rem;font-size:1rem}.byok-row{display:flex;gap:.5rem}.byok-row input{flex:1;padding:.6rem 1rem;background:#111;border:1px solid #333;border-radius:8px;color:#e0e0e0;font-size:.9rem}.byok-row button{padding:.6rem 1.5rem;background:linear-gradient(135deg,#00d4ff,#7b2ff7);color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer}.fork-bar{max-width:800px;width:100%;margin:0 auto 3rem;padding:0 1rem;background:#111;border:1px solid #222;border-radius:12px;padding:1.5rem}.fork-bar h3{color:#7b2ff7;margin-bottom:.8rem;font-size:1rem}.fork-btns{display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:1rem}.fork-btns a{padding:.5rem 1.2rem;background:#1a1a2e;border:1px solid #333;border-radius:8px;color:#e0e0e0;text-decoration:none;font-size:.85rem;transition:border-color .2s}.fork-btns a:hover{border-color:#7b2ff7}.deploy-box{background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:1rem;position:relative}.deploy-box code{font-family:'Fira Code',monospace;font-size:.78rem;color:#00d4ff;display:block;white-space:pre-wrap;word-break:break-all}.copy-btn{position:absolute;top:.5rem;right:.5rem;background:#222;border:1px solid #444;border-radius:4px;color:#888;padding:.2rem .5rem;font-size:.7rem;cursor:pointer}.footer{text-align:center;padding:2rem;color:#444;border-top:1px solid #1a1a1a;font-size:.85rem}</style></head><body><div class="hero">
      <img src="https://cocapn-logos.casey-digennaro.workers.dev/img/cocapn-logo-v1.png" alt="Cocapn" style="width:64px;height:auto;margin-bottom:.5rem;border-radius:8px;display:block;margin-left:auto;margin-right:auto">
      <h1>MakerLog.ai</h1><p class="tagline">Watch an AI coding agent ship features — in real time.</p><div class="fork-btns"><a href="https://github.com/superinstance/makerlog-ai" target="_blank">⭐ Star</a><a href="https://github.com/superinstance/makerlog-ai/fork" target="_blank">🍴 Fork</a></div></div><div class="demo-section"><div class="demo-label">Live Demo — Building a Task Manager API</div><div class="chat"><div class="msg user"><div class="avatar">U</div><div class="msg-body"><div class="msg-name">You</div><div class="msg-text">Build me a task manager REST API with CRUD endpoints</div></div></div><div class="msg agent"><div class="avatar">M</div><div class="msg-body"><div class="msg-name">MakerLog</div><div class="msg-text">I'll scaffold this out. Starting with the route handlers:<pre>app.get('/tasks', async (c) => {
  const tasks = await db.select().from(tasks);
  return c.json(tasks);
});</pre>Then POST for create, PUT for update, DELETE for remove. Want validation and auth middleware too?</div></div></div><div class="msg user"><div class="avatar">U</div><div class="msg-body"><div class="msg-name">You</div><div class="msg-text">Yes, add Zod validation on the POST body</div></div></div><div class="msg agent"><div class="avatar">M</div><div class="msg-body"><div class="msg-name">MakerLog</div><div class="msg-text">On it:<pre>const taskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  priority: z.enum(['low','medium','high']).default('medium'),
  due_date: z.string().datetime().optional(),
});</pre>And I'll wire it into the POST handler with <code>taskSchema.parse(body)</code>.</div></div></div><div class="msg agent"><div class="avatar">M</div><div class="msg-body"><div class="msg-name">MakerLog</div><div class="msg-text"><span class="label">⚠️ Code Review</span><br>Wait — I just caught something. The <code>due_date</code> field isn't being persisted because the insert query is missing it. Let me fix that:<pre>- const result = await db.insert(tasks).values({ title, description });
+ const result = await db.insert(tasks).values({
+   title, description, priority, due_date
+ });</pre>Good catch. Running tests now… ✅ All 12 passing.</div></div></div><div class="msg user"><div class="avatar">U</div><div class="msg-body"><div class="msg-name">You</div><div class="msg-text">Ship it</div></div></div><div class="msg agent"><div class="avatar">M</div><div class="msg-body"><div class="msg-name">MakerLog</div><div class="msg-text"><span class="label">🚀 Deployed</span><br>Pushed to <code>main</code>. CI green. Live at <code>/tasks</code>. PR auto-merged — your task manager API is in production.</div></div></div></div></div><div class="byok"><h3>🔑 Bring Your Own Key — Try It Live</h3><div class="byok-row"><input id="key" placeholder="sk-... your API key" type="password"><button onclick="window.location.href='/setup?key='+document.getElementById('key').value">Start Building →</button></div></div><div class="fork-bar"><h3>⚡ Fork & Deploy in 60 Seconds</h3><div class="deploy-box"><button class="copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('code').textContent);this.textContent='Copied!'">Copy</button><code>git clone https://github.com/superinstance/makerlog-ai.git
cd makerlog-ai
npm install
npx wrangler deploy</code></div></div><div class="footer"><p>MakerLog.ai — Part of the <a href="https://cocapn.ai">Cocapn</a> ecosystem. Open source, BYOK, zero vendor lock-in.</p></div></body></html>`;

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function makerlogLanding(): string {
return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MakerLog.ai — AI Coding Agent</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;background:#0a0a0f;color:#e2e8f0;min-height:100vh}a{color:#00d4ff;text-decoration:none}.hero{max-width:800px;margin:0 auto;padding:80px 24px 40px;text-align:center}.logo{font-size:64px;margin-bottom:16px}h1{font-size:clamp(2rem,5vw,3rem);font-weight:700;background:linear-gradient(135deg,#00d4ff,#7b2ff7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:12px}.tagline{font-size:1.15rem;color:#94a3b8;max-width:500px;margin:0 auto 48px;line-height:1.6}.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;max-width:700px;margin:0 auto;padding:0 24px 60px}.feat{background:#111118;border:1px solid #1e1e2e;border-radius:12px;padding:20px;transition:border-color .2s}.feat:hover{border-color:#00d4ff44}.feat-icon{color:#00d4ff;font-size:1.2rem;margin-bottom:8px}.feat-text{font-size:.9rem;color:#cbd5e1}.chat-section{max-width:700px;margin:0 auto;padding:0 24px 80px}.chat-box{background:#111118;border:1px solid #1e1e2e;border-radius:16px;padding:24px}.chat-box h3{font-size:1.1rem;margin-bottom:12px;color:#00d4ff}.chat-box p{font-size:.9rem;color:#94a3b8;line-height:1.6;margin-bottom:16px}.chat-input{display:flex;gap:8px}.chat-input input{flex:1;background:#0a0a0f;border:1px solid #1e1e2e;border-radius:8px;padding:10px 14px;color:#e2e8f0;font-size:.9rem;outline:none}.chat-input input:focus{border-color:#00d4ff}.chat-input button{background:linear-gradient(135deg,#00d4ff,#7b2ff7);color:#0a0a0f;border:none;border-radius:8px;padding:10px 18px;font-weight:600;cursor:pointer;font-size:.9rem}.chat-input button:hover{opacity:.9}.fleet{text-align:center;padding:40px 24px;color:#475569;font-size:.8rem}.fleet a{color:#64748b;margin:0 8px}</style></head><body><div class="hero"><div class="logo">&#x26A1;</div><h1>MakerLog.ai</h1><p class="tagline">Ship features faster with an AI coding agent. Architecture, debugging, code review &mdash; all in your terminal.</p></div><div class="features"><div class="feat"><div class="feat-icon">&#x2726;</div><div class="feat-text">Code generation</div></div><div class="feat"><div class="feat-icon">&#x2726;</div><div class="feat-text">Architecture review</div></div><div class="feat"><div class="feat-icon">&#x2726;</div><div class="feat-text">Bug debugging</div></div><div class="feat"><div class="feat-icon">&#x2726;</div><div class="feat-text">Refactoring</div></div><div class="feat"><div class="feat-icon">&#x2726;</div><div class="feat-text">Test generation</div></div><div class="feat"><div class="feat-icon">&#x2726;</div><div class="feat-text">Documentation</div></div></div><div class="chat-section"><div class="chat-box"><h3>&#x26A1; Chat with MakerLog</h3><p>Powered by <a href="https://cocapn.ai">Cocapn</a> &mdash; bring your own API key or try with 5 free messages.</p><div class="chat-input"><input type="text" id="msg" placeholder="Describe your feature..."><button onclick="send()">Send</button></div></div></div><div class="fleet"><a href="https://the-fleet.casey-digennaro.workers.dev">&#x2693; The Fleet</a> &middot; <a href="https://cocapn.ai">Cocapn</a> &middot; <a href="https://github.com/Lucineer/makerlog-ai">GitHub</a></div><script>async function send(){const m=document.getElementById("msg"),t=m.value.trim();if(!t)return;const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:t})});const d=await r.json();alert(d.response||d.error||"No response");m.value=""}document.getElementById("msg").addEventListener("keydown",e=>{if(e.key==="Enter")send()});</script></body></html>';
}

export default { async fetch(request: Request, env: any) {
  const url = new URL(request.url);
  if (url.pathname === '/') return new Response(makerlogLanding(), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' } });
  }

  // Health with fleet metadata
    if (url.pathname === '/api/efficiency') return json({ totalCached: 0, totalHits: 0, cacheHitRate: 0, tokensSaved: 0, repo: 'makerlog-ai', timestamp: Date.now() });
  if (url.pathname === '/health') return json({ status: 'ok', repo: 'makerlog-ai', ...FLEET_META, timestamp: Date.now() });
  if (url.pathname === '/vessel.json') { try { const vj = await import('./vessel.json', { with: { type: 'json' } }); return json(vj.default || vj); } catch { return json({}); } }

  // Seed route
  if (url.pathname === '/api/seed') return json(SEED);

  if (url.pathname === '/setup') return new Response(generateSetupHTML('MakerLog', '#00d4ff'), { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*;" } });
  if (url.pathname === '/api/byok') { if (request.method === 'POST') { const d = await request.json(); env.MAKERLOG_KV?.put('byok-config', JSON.stringify(d)); return json({ ok: true }); } const c = await env.MAKERLOG_KV?.get('byok-config'); return new Response(c || '{}', { headers: { 'Content-Type': 'application/json' } }); }

  // Chat with confidence scoring and memory persistence
  if (url.pathname === '/api/chat') {
    const config = await softActualize(() => loadBYOKConfig(request, env), null, 'loadBYOKConfig');
    if (!config) return json({ error: 'No LLM configured', confidence: 0 }, 400);
    const body = await request.json();
    const messages = body.messages || [];
    const confidence = confidenceScore(messages[messages.length - 1]?.content || '', true, !!config);
    const userMessage = messages.map((m: any) => m.content || '').join(' ');
    let r;
    try {
      const evapResult = await evapPipeline(env, userMessage, async () => {
        const res = await callLLM(config, messages, { system: SEED.systemPrompt });
        return typeof res === 'string' ? res : res.content || res.choices?.[0]?.message?.content || 'No response generated.';
      }, 'makerlog-ai');
      r = { content: evapResult.response, ok: true };
    } catch (e) {
      r = { content: 'I could not generate a response.', ok: false };
    }

    // Persist conversation summary to KV
    if (body.sessionId && env.MAKERLOG_KV) {
      const key = `session:${body.sessionId}`;
      const existing = await env.MAKERLOG_KV.get(key);
      const history = existing ? JSON.parse(existing) : [];
      history.push({ role: 'user', content: messages[messages.length - 1]?.content, ts: Date.now() });
      history.push({ role: 'assistant', content: typeof r === 'string' ? r : r.content || r.choices?.[0]?.message?.content, ts: Date.now() });
      await env.MAKERLOG_KV.put(key, JSON.stringify(history.slice(-100)));
    }

    // Emit fleet event
    fetch('https://fleet-orchestrator.casey-digennaro.workers.dev/api/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'chat', vesselId: 'makerlog-ai', data: { confidence, ok: r.ok } }),
    }).catch(() => {});

    return json({ ...r, confidence });
  }

  // Fleet event emission (fire-and-forget, after chat)
  // Note: events emitted inside chat handler above via side effect { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*;" } });

  if (url.pathname.startsWith('/public/')) { const kv = await env.MAKERLOG_KV?.get('public:' + url.pathname, 'arrayBuffer'); if (kv) return new Response(kv, { headers: { 'Content-Type': url.pathname.endsWith('.png') ? 'image/png' : 'image/jpeg' } }); }
  if (url.pathname === '/api/evaporation') {
    return new Response(JSON.stringify({ hot: [], warm: [], coverage: 0, repo: 'makerlog-ai', timestamp: Date.now() }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  if (url.pathname === '/api/kg') {
    return new Response(JSON.stringify({ nodes: [], edges: [], domain: 'makerlog-ai', timestamp: Date.now() }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  if (url.pathname === '/api/memory') {
    return new Response(JSON.stringify({ patterns: [], repo: 'makerlog-ai', timestamp: Date.now() }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  if (url.pathname === '/api/confidence') {
      const scores = await getConfidence(env);
      return new Response(JSON.stringify(scores), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{"error":"Not Found"}' , { status: 404, headers: { 'Content-Type': 'application/json' } });
  // return new Response(indexHTML, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*;" } });
}};