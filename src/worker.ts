import { loadBYOKConfig, callLLM, generateSetupHTML } from './lib/byok.js';
import { softActualize, confidenceScore } from './lib/soft-actualize.js';

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

const indexHTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MakerLog.ai — Your Code, Your Agent, Your Way</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;line-height:1.6}.hero{min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;background:radial-gradient(ellipse at 50% 0%,#1a1a2e 0%,#0a0a0a 70%)}.hero h1{font-size:clamp(2.5rem,6vw,4.5rem);background:linear-gradient(135deg,#00d4ff,#7b2ff7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1rem}.hero p{font-size:1.25rem;color:#888;max-width:600px;margin:0 auto 2rem}.cta{display:inline-block;padding:.8rem 2rem;background:linear-gradient(135deg,#00d4ff,#7b2ff7);color:#fff;border:none;border-radius:8px;font-size:1.1rem;cursor:pointer;text-decoration:none}.cta:hover{transform:scale(1.05)}.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:2rem;padding:4rem 2rem;max-width:1200px;margin:0 auto}.card{background:#111;border:1px solid #222;border-radius:12px;padding:2rem}.card:hover{border-color:#7b2ff7}.card h3{color:#00d4ff;margin-bottom:.5rem}.card p{color:#666;font-size:.95rem}.gallery{padding:4rem 2rem;text-align:center}.gallery h2{margin-bottom:2rem;color:#00d4ff}.gallery-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1.5rem;max-width:1200px;margin:0 auto}.gallery-grid img{width:100%;border-radius:8px;border:1px solid #222}.footer{text-align:center;padding:2rem;color:#444;border-top:1px solid #1a1a1a;font-size:.85rem}.tag{display:inline-block;padding:.2rem .6rem;background:#1a1a2e;border:1px solid #333;border-radius:4px;font-size:.75rem;color:#7b2ff7;margin:.2rem}</style></head><body><div class="hero"><div><h1>MakerLog.ai</h1><p>The AI coding agent that builds itself. Your code, your knowledge, your way.</p><a href="/setup" class="cta">Get Started</a><br><br><span class="tag">Self-Building</span><span class="tag">BYOK</span><span class="tag">Zero Deps</span><span class="tag">Open Source</span></div></div><div class="features"><div class="card"><h3>🧠 Self-Building Agent</h3><p>Analyzes its own code and writes improvements.</p></div><div class="card"><h3>📁 File Manager</h3><p>Virtual filesystem with search and tree view.</p></div><div class="card"><h3>💻 Terminal</h3><p>20 built-in commands with tab completion.</p></div><div class="card"><h3>🔗 Dependency Graph</h3><p>Visualize modules, detect cycles, optimize builds.</p></div><div class="card"><h3>📦 Config System</h3><p>Hierarchical layers: default → user → project → env.</p></div><div class="card"><h3>🔑 BYOK</h3><p>OpenAI, Anthropic, Google, DeepSeek, Groq, Mistral.</p></div></div><div class="gallery"><h2>How It Looks</h2><div class="gallery-grid"><img src="/public/code_editor_dark_theme.png" alt="Code Editor"><img src="/public/terminal_with_neon_green_text.png" alt="Terminal"><img src="/public/git_branch_visualization.png" alt="Git"><img src="/public/AI_assistant_helping_developer.png" alt="AI"><img src="/public/build_pipeline_success.png" alt="Build"><img src="/public/code_review_interface.png" alt="Review"></div></div><div class="footer"><p>MakerLog.ai — Part of the <a href="https://cocapn.ai" style="color:#7b2ff7">Cocapn</a> ecosystem.</p></div></body></html>`;

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export default { async fetch(request: Request, env: any) {
  const url = new URL(request.url);

  // Health with fleet metadata
  if (url.pathname === '/health') return json({ status: 'ok', repo: 'makerlog-ai', ...FLEET_META, timestamp: Date.now() });

  // Seed route
  if (url.pathname === '/api/seed') return json(SEED);

  if (url.pathname === '/setup') return new Response(generateSetupHTML('MakerLog', '#00d4ff'), { headers: { 'Content-Type': 'text/html' } });
  if (url.pathname === '/api/byok') { if (request.method === 'POST') { const d = await request.json(); env.MAKERLOG_KV?.put('byok-config', JSON.stringify(d)); return json({ ok: true }); } const c = await env.MAKERLOG_KV?.get('byok-config'); return new Response(c || '{}', { headers: { 'Content-Type': 'application/json' } }); }

  // Chat with confidence scoring and memory persistence
  if (url.pathname === '/api/chat') {
    const config = await softActualize(() => loadBYOKConfig(request, env), null, 'loadBYOKConfig');
    if (!config) return json({ error: 'No LLM configured', confidence: 0 }, 400);
    const body = await request.json();
    const messages = body.messages || [];
    const confidence = confidenceScore(messages[messages.length - 1]?.content || '', true, !!config);
    const r = await softActualize(() => callLLM(config, messages, { system: SEED.systemPrompt }), { content: 'I could not generate a response.', ok: false }, 'callLLM');

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

  if (url.pathname.startsWith('/public/')) { const kv = await env.MAKERLOG_KV?.get('public:' + url.pathname, 'arrayBuffer'); if (kv) return new Response(kv, { headers: { 'Content-Type': url.pathname.endsWith('.png') ? 'image/png' : 'image/jpeg' } }); }
  return new Response(indexHTML, { headers: { 'Content-Type': 'text/html' } });
}};
