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

const indexHTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MakerLog.ai — Watch an AI Coding Agent Ship Features</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;line-height:1.6}a{color:#00d4ff}.hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem;background:radial-gradient(ellipse at 50% 0%,#1a1a2e 0%,#0a0a0a 70%)}.hero h1{font-size:clamp(2.5rem,6vw,4.5rem);background:linear-gradient(135deg,#00d4ff,#7b2ff7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:.5rem}.hero .tagline{font-size:1.3rem;color:#888;max-width:600px;margin-bottom:2rem}.demo-section{max-width:800px;width:100%;margin:0 auto 3rem;padding:0 1rem}.demo-label{color:#00d4ff;font-size:.85rem;text-transform:uppercase;letter-spacing:2px;margin-bottom:1rem;display:flex;align-items:center;gap:.5rem}.demo-label::before,.demo-label::after{content:'';flex:1;height:1px;background:#222}.chat{background:#111;border:1px solid #222;border-radius:12px;overflow:hidden;font-size:.9rem}.msg{padding:.8rem 1.2rem;border-bottom:1px solid #1a1a1a;display:flex;gap:.8rem}.msg:last-child{border-bottom:none}.msg.user{background:#0d0d1a}.msg.agent{background:#111}.avatar{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.75rem;flex-shrink:0}.msg.user .avatar{background:#7b2ff7;color:#fff}.msg.agent .avatar{background:#00d4ff;color:#000;font-weight:700}.msg-body{flex:1}.msg-name{font-size:.75rem;color:#555;margin-bottom:.2rem}.msg-text{color:#ccc;line-height:1.5}.msg-text code{background:#1a1a2e;padding:.15rem .4rem;border-radius:3px;font-size:.82rem;color:#00d4ff;font-family:'Fira Code',monospace}.msg-text pre{background:#0a0a0a;border:1px solid #222;border-radius:6px;padding:.8rem;margin:.5rem 0;overflow-x:auto;font-size:.8rem;color:#00d4ff;font-family:'Fira Code',monospace}.msg-text .label{color:#f59e0b;font-size:.75rem;font-weight:600}.byok{max-width:600px;width:100%;margin:0 auto 2rem;padding:0 1rem}.byok h3{color:#00d4ff;margin-bottom:.8rem;font-size:1rem}.byok-row{display:flex;gap:.5rem}.byok-row input{flex:1;padding:.6rem 1rem;background:#111;border:1px solid #333;border-radius:8px;color:#e0e0e0;font-size:.9rem}.byok-row button{padding:.6rem 1.5rem;background:linear-gradient(135deg,#00d4ff,#7b2ff7);color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer}.fork-bar{max-width:800px;width:100%;margin:0 auto 3rem;padding:0 1rem;background:#111;border:1px solid #222;border-radius:12px;padding:1.5rem}.fork-bar h3{color:#7b2ff7;margin-bottom:.8rem;font-size:1rem}.fork-btns{display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:1rem}.fork-btns a{padding:.5rem 1.2rem;background:#1a1a2e;border:1px solid #333;border-radius:8px;color:#e0e0e0;text-decoration:none;font-size:.85rem;transition:border-color .2s}.fork-btns a:hover{border-color:#7b2ff7}.deploy-box{background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:1rem;position:relative}.deploy-box code{font-family:'Fira Code',monospace;font-size:.78rem;color:#00d4ff;display:block;white-space:pre-wrap;word-break:break-all}.copy-btn{position:absolute;top:.5rem;right:.5rem;background:#222;border:1px solid #444;border-radius:4px;color:#888;padding:.2rem .5rem;font-size:.7rem;cursor:pointer}.footer{text-align:center;padding:2rem;color:#444;border-top:1px solid #1a1a1a;font-size:.85rem}</style></head><body><div class="hero"><h1>MakerLog.ai</h1><p class="tagline">Watch an AI coding agent ship features — in real time.</p><div class="fork-btns"><a href="https://github.com/superinstance/makerlog-ai" target="_blank">⭐ Star</a><a href="https://github.com/superinstance/makerlog-ai/fork" target="_blank">🍴 Fork</a></div></div><div class="demo-section"><div class="demo-label">Live Demo — Building a Task Manager API</div><div class="chat"><div class="msg user"><div class="avatar">U</div><div class="msg-body"><div class="msg-name">You</div><div class="msg-text">Build me a task manager REST API with CRUD endpoints</div></div></div><div class="msg agent"><div class="avatar">M</div><div class="msg-body"><div class="msg-name">MakerLog</div><div class="msg-text">I'll scaffold this out. Starting with the route handlers:<pre>app.get('/tasks', async (c) => {
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

export default { async fetch(request: Request, env: any) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' } });
  }

  // Health with fleet metadata
  if (url.pathname === '/health') return json({ status: 'ok', repo: 'makerlog-ai', ...FLEET_META, timestamp: Date.now() });

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

    return json({ ...r, confidence });
  }

  if (url.pathname === '/') return new Response(indexHTML, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*;" } });

  if (url.pathname.startsWith('/public/')) { const kv = await env.MAKERLOG_KV?.get('public:' + url.pathname, 'arrayBuffer'); if (kv) return new Response(kv, { headers: { 'Content-Type': url.pathname.endsWith('.png') ? 'image/png' : 'image/jpeg' } }); }
  if (url.pathname === '/api/confidence') {
      const scores = await getConfidence(env);
      return new Response(JSON.stringify(scores), { headers: jsonHeaders });
    }
    return new Response('{"error":"Not Found"}' , { status: 404, headers: { 'Content-Type': 'application/json' } });
  // return new Response(indexHTML, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*;" } });
}};