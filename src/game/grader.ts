/**
 * Grading runs in Web Workers. When a decision appears, every option gets a first pass (N1 games each) while the
 * player thinks. After the pick, the leading options, the player's pick and the AI coach's pick get a second,
 * larger pass (N2 more games) so the grade is not decided by simulation noise.
 */
import { addStat, evaluate, type OptStat } from '../engine/evaluate';
import { hash } from '../engine/rng';
import type { Choice, State } from '../engine/types';
import { makeGrade, type Grade } from './grade';
import type { Decision, Opt } from './session';

export const N1 = 1000;
export const N2 = 4000;
const REFINE_TOP = 4;

interface Job { id: number; s: State; choices: Choice[]; n: number; seed: number; from: number }
interface Pending { resolve: (st: OptStat[]) => void; job: Job; w: Worker }

export class Pool {
  private workers: Worker[] = [];
  private pending = new Map<number, Pending>();
  private seq = 0;

  constructor() {
    const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
    const size = Math.max(1, Math.min(3, hc - 1));
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<{ id: number; stats: OptStat[] }>) => {
          const p = this.pending.get(e.data.id);
          if (p) { this.pending.delete(e.data.id); p.resolve(e.data.stats); }
        };
        // a worker that fails (load error, crash) must not leave a grade waiting forever: its jobs finish here
        w.onerror = (e) => { e.preventDefault?.(); this.retire(w); };
        this.workers.push(w);
      }
    } catch {
      this.workers = [];   // no workers (old browser, file://): evaluate on the main thread
    }
  }

  private call(w: Worker, s: State, choices: Choice[], n: number, seed: number, from: number): Promise<OptStat[]> {
    const id = ++this.seq;
    const job: Job = { id, s, choices, n, seed, from };
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, job, w });
      try { w.postMessage(job); } catch { this.retire(w); }
    });
  }

  /** Stop using a broken worker; run whatever it still owed on the main thread. */
  private retire(w: Worker) {
    this.workers = this.workers.filter((x) => x !== w);
    try { w.terminate(); } catch { /* already gone */ }
    for (const [id, p] of [...this.pending]) {
      if (p.w !== w) continue;
      this.pending.delete(id);
      setTimeout(() => p.resolve(evaluate(p.job.s, p.job.choices, p.job.n, p.job.seed, p.job.from)), 0);
    }
  }

  async run(s: State, choices: Choice[], n: number, seed: number, from = 0): Promise<OptStat[]> {
    if (!choices.length) return [];
    if (!this.workers.length) {
      await new Promise((r) => setTimeout(r, 0));
      return evaluate(s, choices, n, seed, from);
    }
    const W = this.workers.length;
    const parts = this.workers.map((_, w) => choices.map((_, i) => i).filter((i) => i % W === w));
    const res = await Promise.all(parts.map((idx, w) => (idx.length ? this.call(this.workers[w], s, idx.map((i) => choices[i]), n, seed, from) : Promise.resolve([]))));
    const out: OptStat[] = new Array(choices.length);
    parts.forEach((idx, w) => idx.forEach((i, j) => (out[i] = res[w][j])));
    return out;
  }
}

let pool: Pool | null = null;
export const getPool = () => (pool ??= new Pool());

export class GradeJob {
  stats = new Map<string, OptStat>();
  ready: Promise<void>;
  done = false;
  private seed: number;

  constructor(public dec: Decision, seedBase: number) {
    this.seed = hash(seedBase, dec.state.k, dec.step, 'eval');
    this.ready = getPool()
      .run(dec.state, dec.options.map((o) => o.choice), N1, this.seed)
      .then((st) => {
        dec.options.forEach((o, i) => this.stats.set(o.key, st[i]));
        this.done = true;
      });
  }

  /** Win chance of the best option after the first pass. */
  bestWp(): number | null {
    if (!this.done) return null;
    let b = 0;
    this.stats.forEach((v) => (b = Math.max(b, v.wp / v.n)));
    return b;
  }

  wpOf(key: string): number | null {
    const v = this.stats.get(key);
    return v ? v.wp / v.n : null;
  }

  async grade(opt: Opt): Promise<Grade> {
    await this.ready;
    const custom = !!(opt.choice.target || opt.choice.route || opt.choice.routes || opt.choice.side || opt.choice.mods);
    const ranked = [...this.stats.entries()].sort((a, b) => b[1].wp - a[1].wp).map(([k]) => k);
    const keys = new Set(ranked.slice(0, REFINE_TOP));
    if (!custom) keys.add(opt.key);
    if (this.stats.has(this.dec.aiKey)) keys.add(this.dec.aiKey);
    const list = [...keys];
    const choices = list.map((k) => this.dec.options.find((o) => o.key === k)!.choice);
    const pool = getPool();
    const [more, mineCustom] = await Promise.all([
      pool.run(this.dec.state, choices, N2, this.seed, N1),
      custom ? pool.run(this.dec.state, [opt.choice], N1 + N2, this.seed, 0) : Promise.resolve(null),
    ]);
    list.forEach((k, i) => this.stats.set(k, addStat(this.stats.get(k)!, more[i])));
    const mineStat = custom ? mineCustom![0] : this.stats.get(opt.key)!;
    return makeGrade(this.dec, opt, mineStat, this.stats);
  }
}
