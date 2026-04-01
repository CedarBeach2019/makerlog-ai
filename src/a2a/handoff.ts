// ═══════════════════════════════════════════════════════════════════
// Universal Handoff Protocol — cc: for AI Agents
// HMAC-signed context transfer between repo-native agents
// ═══════════════════════════════════════════════════════════════════

export interface AgentIdentity {
  id: string;
  name: string;
  repo: string;
  publicKey?: string;
}

export interface HandoffTask {
  description: string;
  status: 'in-progress' | 'blocked' | 'needs-review' | 'complete';
  intention: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface HandoffContext {
  conversation: Array<{ role: string; content: string; ts: number }>;
  knowledge: Array<{ id: string; fact: string; confidence: number; source: string }>;
  files: Array<{ path: string; hash: string; relevance: string }>;
  decisions: Array<{ decision: string; reasoning: string; ts: number }>;
}

export interface Handoff {
  id: string;
  from: AgentIdentity;
  to: AgentIdentity;
  timestamp: number;
  task: HandoffTask;
  context: HandoffContext;
  privacy: 'public' | 'shared' | 'private';
  protocolVersion: string;
  signature: string;
}

// HMAC-SHA256 signing using Web Crypto API
async function hmacSign(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacVerify(key: string, data: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(key, data);
  return expected === signature;
}

// Serialize handoff for signing (deterministic, excludes signature)
function serializeForSigning(h: Omit<Handoff, 'signature'>): string {
  return JSON.stringify({
    id: h.id, from: h.from, to: h.to, timestamp: h.timestamp,
    task: h.task, context_keys: {
      conversations: h.context.conversation.length,
      knowledge: h.context.knowledge.length,
      files: h.context.files.length,
      decisions: h.context.decisions.length
    },
    privacy: h.privacy, protocolVersion: h.protocolVersion
  });
}

// Privacy filter — strips sensitive content based on privacy level
function filterContext(context: HandoffContext, level: string): HandoffContext {
  if (level === 'private') return context; // full context within same private repo

  return {
    conversation: context.conversation.map(m => ({
      ...m,
      content: level === 'public'
        ? m.content.replace(/\b(sk-|ghp_|gho_|xoxb-|AIza)[a-zA-Z0-9_-]{20,}\b/g, '[REDACTED]')
            .replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, '[REDACTED]')
            .replace(/\/home\/[\w/]+/g, '[PATH]')
        : m.content
    })),
    knowledge: context.knowledge.map(k => ({
      ...k,
      fact: level === 'public' && k.confidence < 0.8 ? '[LOW_CONFIDENCE]' : k.fact
    })),
    files: context.files,
    decisions: context.decisions
  };
}

export class HandoffProtocol {
  private sharedSecret: string;
  private identity: AgentIdentity;
  private received: Map<string, Handoff> = new Map();
  private sent: Map<string, Handoff> = new Map();

  constructor(identity: AgentIdentity, sharedSecret: string) {
    this.identity = identity;
    this.sharedSecret = sharedSecret;
  }

  async createHandoff(
    to: AgentIdentity,
    task: HandoffTask,
    context: HandoffContext,
    privacy: 'public' | 'shared' | 'private' = 'shared'
  ): Promise<Handoff> {
    const id = crypto.randomUUID();
    const filtered = filterContext(context, privacy);
    const handoff: Omit<Handoff, 'signature'> = {
      id, from: this.identity, to, timestamp: Date.now(),
      task, context: filtered, privacy, protocolVersion: '1.0'
    };
    const signature = await hmacSign(this.sharedSecret, serializeForSigning(handoff));
    const complete: Handoff = { ...handoff, signature };
    this.sent.set(id, complete);
    return complete;
  }

  async receiveHandoff(handoff: Handoff): Promise<{ valid: boolean; reason?: string }> {
    // Verify signature
    const valid = await hmacVerify(
      this.sharedSecret,
      serializeForSigning(handoff),
      handoff.signature
    );
    if (!valid) return { valid: false, reason: 'Invalid signature' };

    // Verify recipient
    if (handoff.to.id !== this.identity.id) {
      return { valid: false, reason: 'Not the intended recipient' };
    }

    // Verify protocol version
    if (handoff.protocolVersion !== '1.0') {
      return { valid: false, reason: `Unsupported protocol version: ${handoff.protocolVersion}` };
    }

    this.received.set(handoff.id, handoff);
    return { valid: true };
  }

  getReceived(): Handoff[] { return Array.from(this.received.values()); }
  getSent(): Handoff[] { return Array.from(this.sent.values()); }
  getIdentity(): AgentIdentity { return this.identity; }

  // Create a handoff summary for human review
  summarizeHandoff(h: Handoff): string {
    return [
      `Handoff ${h.id.slice(0, 8)}: ${h.from.name} → ${h.to.name}`,
      `Task: ${h.task.description}`,
      `Status: ${h.task.status} | Intention: ${h.task.intention}`,
      `Context: ${h.context.conversation.length} msgs, ${h.context.knowledge.length} facts, ${h.context.files.length} files`,
      `Privacy: ${h.privacy} | Signed: ${h.signature.slice(0, 16)}...`
    ].join('\n');
  }
}

// Export types for use in worker
export type { Handoff as HandoffType };
