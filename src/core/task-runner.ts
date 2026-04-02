interface Task { id:string; name:string; type:'build'|'test'|'lint'|'deploy'|'custom'; command:string; status:'queued'|'running'|'completed'|'failed'|'cancelled'; progress:number; output:string; error?:string; startedAt?:number; completedAt?:number; retries:number; maxRetries:number; timeout:number; priority:number; deps:string[] }
const uid = () => crypto.randomUUID();
export class TaskRunner {
  private queue: Task[] = []; private running: Task[] = []; private done: Task[] = []; private maxConcurrent = 2;
  enqueue(name: string, type: Task['type'], command: string, opts: Partial<Task> = {}): Task {
    const t: Task = { id: uid(), name, type, command, status: 'queued', progress: 0, output: '', retries: 0, maxRetries: opts.maxRetries || 2, timeout: opts.timeout || 30000, priority: opts.priority || 0, deps: opts.deps || [] };
    this.queue.push(t); this.queue.sort((a, b) => b.priority - a.priority); return t;
  }
  private pickNext(): Task | null {
    if (this.running.length >= this.maxConcurrent) return null;
    const ready = this.queue.filter(t => t.status === 'queued' && t.deps.every(d => { const dep = [...this.queue, ...this.done].find(x => x.id === d); return dep?.status === 'completed'; }));
    return ready.shift() || null;
  }
  runNext(): Task | null {
    const t = this.pickNext(); if (!t) return null;
    t.status = 'running'; t.startedAt = Date.now();
    this.queue = this.queue.filter(x => x.id !== t.id); this.running.push(t); return t;
  }
  complete(id: string, output: string): void {
    const t = this.running.find(x => x.id === id) || this.queue.find(x => x.id === id); if (!t) return;
    t.status = 'completed'; t.output = output; t.progress = 100; t.completedAt = Date.now();
    this.running = this.running.filter(x => x.id !== id); this.done.push(t);
  }
  fail(id: string, error: string): void {
    const t = this.running.find(x => x.id === id); if (!t) return;
    t.retries++; if (t.retries <= t.maxRetries) { t.status = 'queued'; this.running = this.running.filter(x => x.id !== id); this.queue.push(t); return; }
    t.status = 'failed'; t.error = error; t.completedAt = Date.now();
    this.running = this.running.filter(x => x.id !== id); this.done.push(t);
  }
  cancel(id: string): void { const t = [...this.queue, ...this.running].find(x => x.id === id); if (t) t.status = 'cancelled'; this.queue = this.queue.filter(x => x.id !== id); this.running = this.running.filter(x => x.id !== id); }
  getQueue(): Task[] { return this.queue.filter(t => t.status === 'queued'); }
  getRunning(): Task[] { return this.running; }
  getCompleted(limit = 20): Task[] { return this.done.filter(t => t.status === 'completed').slice(-limit).reverse(); }
  getFailed(): Task[] { return this.done.filter(t => t.status === 'failed'); }
  getTask(id: string): Task | null { return [...this.queue, ...this.running, ...this.done].find(t => t.id === id) || null; }
  getProgress() { return { queued: this.getQueue().length, running: this.running.length, completed: this.done.filter(t => t.status === 'completed').length, failed: this.done.filter(t => t.status === 'failed').length }; }
  setConcurrency(n: number): void { this.maxConcurrent = n; }
  getAvgDuration(): number { const c = this.done.filter(t => t.status === 'completed' && t.startedAt && t.completedAt); return c.length ? c.reduce((s, t) => s + (t.completedAt! - t.startedAt!), 0) / c.length : 0; }
  serialize(): string { return JSON.stringify({ queue: this.queue, running: this.running, done: this.done, maxConcurrent: this.maxConcurrent }); }
  deserialize(data: string): void { const d = JSON.parse(data); this.queue = d.queue; this.running = d.running; this.done = d.done; this.maxConcurrent = d.maxConcurrent; }
}
