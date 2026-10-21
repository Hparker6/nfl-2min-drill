/**
 * The daily leaderboard: "everyone today". The site's own Worker serves it at /v1/ (server/site/worker.js), so a
 * production build uses the same address. VITE_LEADERBOARD_URL points it somewhere else, or "off" turns it off; the
 * dev server has no Worker, so it is off there unless the variable is set.
 *
 * What is sent: the day, a nickname, the performance score, the grade string and the result. Nothing that
 * identifies the player. A random per-browser token lets a player re-submit the same day without duplicates.
 */
export interface Board {
  day: string;
  count: number;            // scores submitted today
  rank: number | null;      // your rank (1 = best), null when not submitted
  tied: number;             // others with your score
  bands: number[];          // counts in 0-9, 10-19, …, 90-100
  best: { name: string; score: number }[];
  average: number;
}

const RAW = ((import.meta.env.VITE_LEADERBOARD_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');
const ON = RAW === 'off' ? false : !!RAW || import.meta.env.PROD;
const URL = RAW === 'off' ? '' : RAW;   // '' is this site: requests go to /v1/…
export const leaderboardOn = () => ON;

const TOKEN_KEY = 'the4thcall:token';
function token(): string {
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t) { t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem(TOKEN_KEY, t); }
    return t;
  } catch { return 'anon'; }
}

/** `null`: the leaderboard is off on this site. `'failed'`: it is on but didn't answer (say so; never show "loading" forever). */
/** 'limited': the board takes no more scores from this connection today (shared networks reach the cap). */
export type BoardAnswer = Board | 'failed' | 'limited' | null;

/** A board the page can render; anything else (a captive portal, a changed API) is a failure, not a crash. */
function asBoard(x: unknown): Board | 'failed' {
  const b = x as Board;
  return b && typeof b === 'object' && typeof b.count === 'number' && Array.isArray(b.bands) && Array.isArray(b.best) ? b : 'failed';
}

export async function submitScore(day: string, name: string, score: number, grades: string, win: boolean): Promise<BoardAnswer> {
  if (!ON) return null;
  try {
    const r = await fetch(`${URL}/v1/day/${day}/score`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token(), name: name.slice(0, 20), score: Math.round(score), grades: grades.slice(0, 64), win }),
    });
    if (r.status === 429) return 'limited';
    if (!r.ok) return 'failed';
    return asBoard(await r.json());
  } catch { return 'failed'; }
}

export async function fetchBoard(day: string): Promise<BoardAnswer> {
  if (!ON) return null;
  try {
    const r = await fetch(`${URL}/v1/day/${day}?token=${encodeURIComponent(token())}`);
    if (!r.ok) return 'failed';
    return asBoard(await r.json());
  } catch { return 'failed'; }
}

/** The histogram band a score falls in (ten bins of ten). */
export const bandOf = (score: number) => Math.min(9, Math.floor(score / 10));
export const BAND_LABELS = ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90'];

export interface DaySummary { count: number; average: number; best: { name: string; score: number }[]; bands: number[] }
export interface Stats { days: Record<string, DaySummary> }

export async function fetchStats(): Promise<Stats | 'failed' | null> {
  if (!ON) return null;
  try {
    const r = await fetch(`${URL}/v1/stats`);
    if (!r.ok) return 'failed';
    const s = (await r.json()) as Stats;
    return s && typeof s === 'object' && s.days && typeof s.days === 'object' && !Array.isArray(s.days) ? s : 'failed';
  } catch { return 'failed'; }
}
