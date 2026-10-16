/** Local persistence: settings, daily progress (resumable mid-spot), survivor runs, history and streaks. */
import type { GradeKey } from './grade';
import type { Pick } from './session';

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  speed: 'normal' | 'fast' | 'instant';
  hints: boolean;        // practice: show win chance on every option before you call it
  nickname?: string;     // the name shown on the daily leaderboard
  plainDots?: boolean;   // field markers in team colors instead of colored by rating
}

export interface SpotResult {
  id: string;
  mode: 'daily' | 'survivor' | 'practice' | 'career';
  date: string;
  teams: [string, string];
  win: boolean;
  ot: boolean;
  score: [number, number];
  grades: GradeKey[];
  scores: number[];      // 0-100 per call
  lost: number;          // total points of win chance given up
  aiLost: number;        // what the AI coach would have given up on the same decisions
  tags: string[];        // what kind of calls were made (for the coach profile)
  baseWp?: number;       // how often the simulated coach wins from the starting spot (absent on old saves)
}

export interface DayRecord {
  spots: SpotResult[];
  cur?: { idx: number; picks: Pick[] };
}

export interface SurvivorRun {
  id: number;
  results: SpotResult[];
  cur?: Pick[];
  over: boolean;
}

export interface Store {
  v: 1;
  settings: Settings;
  days: Record<string, DayRecord>;
  surv: { best: number; runs: number; run?: SurvivorRun };
  history: SpotResult[];
  seenHelp: boolean;
}

const KEY = 'the4thcall:v1';

export const defaultStore = (): Store => ({
  v: 1,
  settings: { theme: 'auto', speed: 'normal', hints: true },
  days: {},
  surv: { best: 0, runs: 0 },
  history: [],
  seenHelp: false,
});

export function loadStore(): Store {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (!raw) return defaultStore();
    const s = JSON.parse(raw) as Partial<Store>;
    if (!s || s.v !== 1 || typeof s !== 'object') throw new Error('unknown save format');
    const d = defaultStore();
    return {
      ...d,
      ...s,
      settings: { ...d.settings, ...(s.settings || {}) },
      days: s.days && typeof s.days === 'object' ? s.days : {},
      surv: { ...d.surv, ...(s.surv || {}) },
      history: Array.isArray(s.history) ? s.history : [],
    } as Store;
  } catch {
    // keep the unreadable save under another key instead of overwriting it, then start clean
    try { if (raw) localStorage.setItem(`${KEY}:unreadable:${Date.now()}`, raw); } catch { /* storage full or off */ }
    return defaultStore();
  }
}

export function saveStore(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage off or full: keep playing */
  }
}

/** Consecutive UTC days with the daily finished, ending today (or yesterday, if today is not done yet). */
export function streak(store: Store, today: string, perDay: number): number {
  const done = (d: string) => (store.days[d]?.spots.length ?? 0) >= perDay;
  let d = new Date(today + 'T00:00:00Z');
  if (!done(today)) d = new Date(d.getTime() - 864e5);
  let n = 0;
  while (done(d.toISOString().slice(0, 10))) {
    n++;
    d = new Date(d.getTime() - 864e5);
  }
  return n;
}

export function bestStreak(store: Store, perDay: number): number {
  const days = Object.keys(store.days).filter((d) => store.days[d].spots.length >= perDay).sort();
  let best = 0, run = 0, prev = 0;
  for (const d of days) {
    const t = Date.parse(d + 'T00:00:00Z');
    run = prev && t - prev === 864e5 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}
