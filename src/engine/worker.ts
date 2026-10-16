/// <reference lib="webworker" />
/** Runs evaluations off the main thread so the field animation never stutters. */
import { evaluate } from './evaluate';
import type { Choice, State } from './types';

interface Job { id: number; s: State; choices: Choice[]; n: number; seed: number; from: number }

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, s, choices, n, seed, from } = e.data;
  const stats = evaluate(s, choices, n, seed, from);
  (self as unknown as Worker).postMessage({ id, stats });
};
