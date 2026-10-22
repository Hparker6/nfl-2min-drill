/**
 * Grading runs in Web Workers. When a decision appears, every option gets a first pass (N1 games each) while the
 * player thinks. After the pick, the leading options, the player's pick and the AI coach's pick get a second,
 * larger pass (N2 more games) so the grade is not decided by simulation noise.
 */
import { addPairs, addStat, evaluate, evaluatePaired, pairSe, type OptStat, type PairStat } from '../engine/evaluate';
import { hash } from '../engine/rng';
import type { Choice, State } from '../engine/types';
import { makeGrade, nearEdge, type Grade } from './grade';
import type { Decision, Opt } from './session';

export const N1 = 1000;
export const N2 = 4000;
/** More paired simulations for the pick and the best option when the grade sits near a boundary. */
export const N3 = 12000;
const REFINE_TOP = 4;

interface Job { id: number; s: State; choices: Choice[]; n: number; seed: number; from: number; paired?: boolean }
interface Result { stats: OptStat[]; pairs?: PairStat }
interface Pending { resolve: (r: Result) => void; reject: (e: Error) => void; job: Job; w: Worker; timer: ReturnType<typeof setTimeout> }
const JOB_TIMEOUT_MS = 90_000;   // a grade this slow is stuck, not slow
const onMain = (j: Job): Result => (j.paired ? evaluatePaired(j.s, j.choices, j.n, j.seed, j.from) : { stats: evaluate(j.s, j.choices, j.n, j.seed, j.from) });

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
        w.onmessage = (e: MessageEvent<{ id: number; stats?: OptStat[]; pairs?: PairStat; error?: string }>) => {
          const p = this.pending.get(e.data.id);
          if (!p) return;
          this.pending.delete(e.data.id); clearTimeout(p.timer);
          if (e.data.error || !e.data.stats) p.reject(new Error(e.data.error ?? 'evaluation failed'));
          else p.resolve({ stats: e.data.stats, pairs: e.data.pairs });
        };
        // a worker that fails (load error, crash) must not leave a grade waiting forever: its jobs finish here
        w.onerror = (e) => { e.preventDefault?.(); this.retire(w); };
        this.workers.push(w);
      }
    } catch {
      this.workers = [];   // no workers (old browser, file://): evaluate on the main thread
    }
  }

  private call(w: Worker, s: State, choices: Choice[], n: number, seed: number, from: number, paired = false): Promise<Result> {
    const id = ++this.seq;
    const job: Job = { id, s, choices, n, seed, from, paired };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error('grade timed out')); }, JOB_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, job, w, timer });
      try { w.postMessage(job); } catch { this.retire(w); }
    });
  }

  /** Stop using a broken worker; run whatever it still owed on the main thread. */
  private retire(w: Worker) {
    this.workers = this.workers.filter((x) => x !== w);
    try { w.terminate(); } catch { /* already gone */ }
    for (const [id, p] of [...this.pending]) {
      if (p.w !== w) continue;
      this.pending.delete(id); clearTimeout(p.timer);
      setTimeout(() => { try { p.resolve(onMain(p.job)); } catch (e) { p.reject(e instanceof Error ? e : new Error('evaluation failed')); } }, 0);
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
    const res = await Promise.all(parts.map((idx, w) => (idx.length ? this.call(this.workers[w], s, idx.map((i) => choices[i]), n, seed, from).then((x) => x.stats) : Promise.resolve([]))));
    const out: OptStat[] = new Array(choices.length);
    parts.forEach((idx, w) => idx.forEach((i, j) => (out[i] = res[w][j])));
    return out;
  }

  /**
   * Every choice over the same simulations, measuring paired differences. Split by simulation range (not by choice) so
   * each worker sees every pair; the totals are the same simulations a by-choice split would run.
   */
  async runPaired(s: State, choices: Choice[], n: number, seed: number, from = 0): Promise<Result & { pairs: PairStat }> {
    if (!this.workers.length) {
      await new Promise((r) => setTimeout(r, 0));
      return evaluatePaired(s, choices, n, seed, from);
    }
    const W = this.workers.length, chunk = Math.ceil(n / W);
    const res = await Promise.all(this.workers.map((w, i) => {
      const a = from + i * chunk, m = Math.max(0, Math.min(chunk, from + n - a));
      return m ? this.call(w, s, choices, m, seed, a, true) : Promise.resolve(null);
    }));
    const parts = res.filter((x): x is Result => !!x && !!x.pairs);
    return {
      stats: choices.map((_, j) => parts.map((p) => p.stats[j]).reduce(addStat)),
      pairs: parts.map((p) => p.pairs!).reduce(addPairs),
    };
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
    // a custom call (edited routes, a side, a signal) is compared over the same refine simulations too
    if (custom) choices.push(opt.choice);
    const pool = getPool();
    const [more, mineCustom] = await Promise.all([
      pool.runPaired(this.dec.state, choices, N2, this.seed, N1),
      custom ? pool.run(this.dec.state, [opt.choice], N1 + N2, this.seed, 0) : Promise.resolve(null),
    ]);
    list.forEach((k, i) => this.stats.set(k, addStat(this.stats.get(k)!, more.stats[i])));
    const mineStat = custom ? mineCustom![0] : this.stats.get(opt.key)!;
    const mineIdx = custom ? list.length : list.indexOf(opt.key);
    // the noise in "best minus mine", in points: measured over the refine simulations, scaled to all of them
    const seVs = (bestKey: string) => { const b = list.indexOf(bestKey); return b < 0 || mineIdx < 0 ? 0 : pairSe(more.pairs, b, mineIdx, N1 + N2); };
    const minN = (N1 + N2) * 0.9;
    const g = makeGrade(this.dec, opt, mineStat, this.stats, seVs, minN);
    if (g.bestKey === opt.key || !nearEdge(g.lost, g.se ?? 0)) return g;
    // close to a grade boundary: settle it with more simulations of just the two calls being compared
    const bestChoice = this.dec.options.find((o) => o.key === g.bestKey)!.choice;
    const ext = await pool.runPaired(this.dec.state, [bestChoice, opt.choice], N3, this.seed, N1 + N2);
    const stats = new Map(this.stats);
    stats.set(g.bestKey, addStat(stats.get(g.bestKey)!, ext.stats[0]));
    const mine2 = addStat(mineStat, ext.stats[1]);
    if (!custom) stats.set(opt.key, mine2);
    return makeGrade(this.dec, opt, mine2, stats, () => pairSe(ext.pairs, 0, 1, N1 + N2 + N3), minN);
  }
}
