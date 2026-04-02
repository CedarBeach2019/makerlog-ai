export interface TestResult { name:string; status:'pass'|'fail'|'skip'; duration:number; error?:string }
export interface TestSuite { name:string; tests:{name:string;fn:()=>Promise<void>|void;skip?:boolean}[]; beforeEach?:()=>void; afterEach?:()=>void }
export class TestRunner {
  private suites: TestSuite[] = [];
  private results: TestResult[] = [];
  describe(name: string, fn: (suite: TestSuite) => void): TestRunner {
    const suite: TestSuite = { name, tests: [], beforeEach: undefined, afterEach: undefined };
    fn(suite); this.suites.push(suite); return this;
  }
  it(name: string, fn: () => Promise<void>|void, skip = false): void { const s = this.suites[this.suites.length - 1]; if (s) s.tests.push({ name, fn, skip }); }
  async run(): Promise<TestResult[]> { this.results = []; for (const suite of this.suites) await this.runSuite(suite); return this.results; }
  private async runSuite(suite: TestSuite): Promise<void> {
    for (const test of suite.tests) {
      if (test.skip) { this.results.push({ name: `${suite.name} > ${test.name}`, status: 'skip', duration: 0 }); continue; }
      const start = Date.now();
      try { suite.beforeEach?.(); await test.fn(); suite.afterEach?.(); this.results.push({ name: `${suite.name} > ${test.name}`, status: 'pass', duration: Date.now() - start }); }
      catch (e: any) { this.results.push({ name: `${suite.name} > ${test.name}`, status: 'fail', duration: Date.now() - start, error: e.message }); }
    }
  }
  assert(cond: boolean, msg = 'Assertion failed'): void { if (!cond) throw new Error(msg); }
  assertEquals(a: any, b: any, msg?: string): void { if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`); }
  assertTrue(v: any, msg?: string): void { if (!v) throw new Error(msg || `Expected truthy, got ${v}`); }
  assertFalse(v: any, msg?: string): void { if (v) throw new Error(msg || `Expected falsy, got ${v}`); }
  assertNotNull(v: any, msg?: string): void { if (v == null) throw new Error(msg || `Expected not null`); }
  assertThrows(fn: () => void): void { let threw = false; try { fn(); } catch { threw = true; } if (!threw) throw new Error('Expected throw'); }
  getResults(): TestResult[] { return this.results; }
  getSummary(): {total:number;passed:number;failed:number;skipped:number;duration:number} {
    const p = this.results.filter(r => r.status === 'pass').length;
    const f = this.results.filter(r => r.status === 'fail').length;
    const s = this.results.filter(r => r.status === 'skip').length;
    return { total: this.results.length, passed: p, failed: f, skipped: s, duration: this.results.reduce((a, r) => a + r.duration, 0) };
  }
}
