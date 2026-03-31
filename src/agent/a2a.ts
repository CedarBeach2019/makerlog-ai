/**
 * A2A Protocol — Agent-to-Agent communication.
 *
 * Enables makerlog-ai to exchange messages with other agents in the fleet,
 * share repo knowledge, and coordinate multi-agent tasks.
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface A2AMessage {
  type: 'request' | 'response' | 'broadcast' | 'heartbeat';
  from: string;        // agent identifier
  to?: string;         // target agent (omitted for broadcasts)
  capability?: string; // requested/advertised capability
  task?: string;       // task description
  payload?: Record<string, unknown>;
  timestamp: number;
  requestId?: string;  // correlation ID for request/response pairing
}

export interface A2AResponse {
  status: 'ok' | 'error' | 'unsupported' | 'busy';
  from: string;
  to: string;
  payload?: Record<string, unknown>;
  error?: string;
  timestamp: number;
}

export interface AgentPeer {
  id: string;
  capabilities: string[];
  lastSeen: number;
  endpoint?: string;
}

// ── Protocol ─────────────────────────────────────────────────────────────

export class A2AProtocol {
  private peers: Map<string, AgentPeer> = new Map();
  private pendingRequests: Map<string, {
    resolve: (response: A2AResponse) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();
  private requestTimeout: number;
  private maxPeers: number;

  constructor(options?: { requestTimeout?: number; maxPeers?: number }) {
    this.requestTimeout = options?.requestTimeout ?? 30_000;
    this.maxPeers = options?.maxPeers ?? 50;
  }

  /**
   * Handle an incoming A2A message and produce a response.
   */
  async handleMessage(
    message: A2AMessage,
    localCapabilities: string[] = [],
  ): Promise<A2AResponse> {
    // Update peer registry
    this.updatePeer(message.from, message.capability ? [message.capability] : []);

    switch (message.type) {
      case 'heartbeat':
        return this.okResponse(message, { capabilities: localCapabilities });

      case 'request':
        return this.handleRequest(message, localCapabilities);

      case 'response':
        this.routeResponse(message);
        return this.okResponse(message);

      case 'broadcast':
        return this.handleBroadcast(message, localCapabilities);

      default:
        return {
          status: 'unsupported',
          from: 'makerlog-ai',
          to: message.from,
          error: `Unknown message type: ${message.type}`,
          timestamp: Date.now(),
        };
    }
  }

  /**
   * Broadcast a task to all peers advertising a given capability.
   * Returns all responses collected within the timeout window.
   */
  async broadcast(
    capability: string,
    task: string,
  ): Promise<A2AResponse[]> {
    const candidates = [...this.peers.values()].filter(
      (p) => p.capabilities.includes(capability),
    );

    if (candidates.length === 0) {
      return [];
    }

    const responses: A2AResponse[] = [];

    // In a real implementation, each request would be sent over the network.
    // Here we build the request messages and return them for the transport
    // layer to dispatch.
    for (const peer of candidates) {
      const request: A2AMessage = {
        type: 'broadcast',
        from: 'makerlog-ai',
        to: peer.id,
        capability,
        task,
        timestamp: Date.now(),
        requestId: this.generateId(),
      };

      // Store for transport layer pickup
      this.pendingRequests.set(request.requestId!, {
        resolve: (resp: A2AResponse) => responses.push(resp),
        timer: setTimeout(() => {
          this.pendingRequests.delete(request.requestId!);
        }, this.requestTimeout),
      });
    }

    // Return the collected responses after timeout
    await this.waitForTimeout(this.requestTimeout);
    return responses;
  }

  /** Get all known peers. */
  getPeers(): AgentPeer[] {
    return [...this.peers.values()];
  }

  /** Get peers advertising a specific capability. */
  getPeersByCapability(capability: string): AgentPeer[] {
    return [...this.peers.values()].filter(
      (p) => p.capabilities.includes(capability),
    );
  }

  // ── Internal handlers ───────────────────────────────────────────────

  private handleRequest(
    message: A2AMessage,
    localCapabilities: string[],
  ): A2AResponse {
    const requested = message.capability ?? '';

    if (!localCapabilities.includes(requested)) {
      return {
        status: 'unsupported',
        from: 'makerlog-ai',
        to: message.from,
        error: `Capability "${requested}" not available`,
        timestamp: Date.now(),
      };
    }

    return {
      status: 'ok',
      from: 'makerlog-ai',
      to: message.from,
      payload: { acknowledged: true, task: message.task },
      timestamp: Date.now(),
    };
  }

  private handleBroadcast(
    message: A2AMessage,
    _localCapabilities: string[],
  ): A2AResponse {
    // Broadcasts are informational; acknowledge receipt
    return this.okResponse(message, { received: true });
  }

  private routeResponse(message: A2AMessage): void {
    if (!message.requestId) return;
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(message.requestId);

    pending.resolve({
      status: 'ok',
      from: message.from,
      to: 'makerlog-ai',
      payload: message.payload,
      timestamp: Date.now(),
    });
  }

  private updatePeer(id: string, capabilities: string[]): void {
    if (this.peers.size >= this.maxPeers && !this.peers.has(id)) {
      // Evict the oldest peer
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [peerId, peer] of this.peers) {
        if (peer.lastSeen < oldestTime) {
          oldestTime = peer.lastSeen;
          oldest = peerId;
        }
      }
      if (oldest) this.peers.delete(oldest);
    }

    const existing = this.peers.get(id);
    this.peers.set(id, {
      id,
      capabilities: existing ? mergeCapabilities(existing.capabilities, capabilities) : capabilities,
      lastSeen: Date.now(),
    });
  }

  private okResponse(
    message: A2AMessage,
    payload?: Record<string, unknown>,
  ): A2AResponse {
    return {
      status: 'ok',
      from: 'makerlog-ai',
      to: message.from,
      payload,
      timestamp: Date.now(),
    };
  }

  private generateId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private waitForTimeout(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function mergeCapabilities(existing: string[], incoming: string[]): string[] {
  const set = new Set([...existing, ...incoming]);
  return [...set];
}
