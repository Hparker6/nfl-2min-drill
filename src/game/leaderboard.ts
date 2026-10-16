/**
 * The daily leaderboard: "everyone today". It needs a server (server/leaderboard/), configured with
 * VITE_LEADERBOARD_URL. Without one, the game shows your score and the simulated percentile only.
 *
 * What is sent: the day, a nickname, the performance score, the grade string and the result. Nothing that
 * identifies the player. A random per-browser token lets a player re-submit the same day without duplicates.
 */
export interface Board {
  day: string;
  count: number;            // scores submitted today
  rank: number | null;      // your rank (1 = best), null when not submitted
  tied: number;             // others with your score
  bands: number[];          // counts in 0-19, 20-39, 40-59, 60-79, 80-100
  best: { name: string; score: number }[];
  average: number;
}

const URL = (import.meta.env.VITE_LEADERBOARD_URL as string | undefined)?.replace(/\/+$/, '') || '';
export const leaderboardOn = () => !!URL;

const TOKEN_KEY = 'the4thcall:token';
function token(): string {
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t) { t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem(TOKEN_KEY, t); }
    return t;
  } catch { return 'anon'; }
}

export async function submitScore(day: string, name: string, score: number, grades: string, win: boolean): Promise<Board | null> {
  if (!URL) return null;
  try {
    const r = await fetch(`${URL}/v1/day/${day}/score`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token(), name: name.slice(0, 20), score: Math.round(score), grades: grades.slice(0, 64), win }),
    });
    if (!r.ok) return null;
    return (await r.json()) as Board;
  } catch { return null; }
}

export async function fetchBoard(day: string): Promise<Board | null> {
  if (!URL) return null;
  try {
    const r = await fetch(`${URL}/v1/day/${day}?token=${encodeURIComponent(token())}`);
    if (!r.ok) return null;
    return (await r.json()) as Board;
  } catch { return null; }
}

/** The histogram band a score falls in. */
export const bandOf = (score: number) => Math.min(4, Math.floor(score / 20));
export const BAND_LABELS = ['0–19', '20–39', '40–59', '60–79', '80–100'];
