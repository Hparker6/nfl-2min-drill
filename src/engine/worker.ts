/// <reference lib="webworker" />
/** Runs evaluations off the main thread so the field animation never stutters. */
import { evaluate, evaluatePaired } from './evaluate';
import type { Choice, State } from './types';

interface Job { id: number; s: State; choices: Choice[]; n: number; seed: number; from: number; paired?: boolean }

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, s, choices, n, seed, from, paired } = e.data;
  try {
    if (paired) { const { stats, pairs } = evaluatePaired(s, choices, n, seed, from); (self as unknown as Worker).postMessage({ id, stats, pairs }); return; }
    const stats = evaluate(s, choices, n, seed, from);
    (self as unknown as Worker).postMessage({ id, stats });
  } catch (err) {
    // a thrown evaluation answers as a failure, so the grade rejects instead of waiting forever
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message ?? err).slice(0, 200) });
  }
};
