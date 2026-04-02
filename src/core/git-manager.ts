interface Commit { hash: string; message: string; author: string; date: string; files: string[]; additions: number; deletions: number; branch: string }
interface Branch { name: string; head: string; isDefault: boolean }
export class GitManager {
  private commits: Commit[] = [];
  private branches: Branch[] = [{ name: 'main', head: '', isDefault: true }];
  private currentBranch = 'main';
  private async hash(s: string): Promise<string> { const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12); }
  async commit(message: string, author: string = 'user', files: string[] = []): Promise<Commit> {
    const c: Commit = { hash: await this.hash(message + Date.now()), message, author, date: new Date().toISOString(), files, additions: Math.floor(Math.random() * 100), deletions: Math.floor(Math.random() * 30), branch: this.currentBranch };
    this.commits.push(c); const b = this.branches.find(b => b.name === this.currentBranch); if (b) b.head = c.hash; return c;
  }
  log(limit = 10, branch?: string): Commit[] { const b = branch || this.currentBranch; return this.commits.filter(c => c.branch === b).slice(-limit).reverse(); }
  branch(name: string): Branch { const b: Branch = { name, head: this.branches.find(b => b.name === this.currentBranch)?.head || '', isDefault: false }; this.branches.push(b); return b; }
  checkout(name: string): void { if (this.branches.find(b => b.name === name)) this.currentBranch = name; else throw new Error(`Branch ${name} not found`); }
  getStats(): { commits: number; authors: number; files: number; additions: number; deletions: number } {
    const authors = new Set(this.commits.map(c => c.author));
    return { commits: this.commits.length, authors: authors.size, files: new Set(this.commits.flatMap(c => c.files)).size, additions: this.commits.reduce((s, c) => s + c.additions, 0), deletions: this.commits.reduce((s, c) => s + c.deletions, 0) };
  }
  getFileHistory(path: string): Commit[] { return this.commits.filter(c => c.files.includes(path)); }
  getContributors(): Array<{ author: string; commits: number; additions: number }> {
    const map = new Map<string, { commits: number; additions: number }>();
    for (const c of this.commits) { const e = map.get(c.author) || { commits: 0, additions: 0 }; e.commits++; e.additions += c.additions; map.set(c.author, e); }
    return [...map.entries()].map(([author, d]) => ({ author, ...d })).sort((a, b) => b.commits - a.commits);
  }
  searchCommits(query: string): Commit[] { const q = query.toLowerCase(); return this.commits.filter(c => c.message.toLowerCase().includes(q)); }
  getRecent(days: number): Commit[] { const cutoff = Date.now() - days * 86400000; return this.commits.filter(c => new Date(c.date).getTime() >= cutoff).reverse(); }
  getChangelog(from = 0, to?: number): string {
    const slice = this.commits.slice(from, to);
    return slice.map(c => `- ${c.message} (${c.hash.slice(0, 7)})`).join('\n');
  }
  getCommit(hash: string): Commit | null { return this.commits.find(c => c.hash === hash || c.hash.startsWith(hash)) || null; }
  getBranches(): Branch[] { return [...this.branches]; }
  getCurrentBranch(): string { return this.currentBranch; }
  serialize(): string { return JSON.stringify({ commits: this.commits, branches: this.branches, currentBranch: this.currentBranch }); }
  deserialize(data: string): void { const d = JSON.parse(data); this.commits = d.commits; this.branches = d.branches; this.currentBranch = d.currentBranch; }
}
