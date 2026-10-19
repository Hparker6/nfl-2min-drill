/**
 * Challenge links: after a Daily, a player sends a link that opens the same day's game with their score to beat.
 * The link carries everything (date, score, result, name) so no server is involved; the game is already the same
 * for everyone on a given day. On arrival the challenge is kept in localStorage and the address is cleaned, so a
 * reload or a hash change keeps it, and it only counts while its day is today's Daily.
 *
 *   https://nfl-2min-drill.com/?c=2026-10-19.72.w.Coach%20Name&ref=challenge
 */
export interface Challenge { date: string; score: number; win: boolean; name: string }

const KEY = 'the4thcall:challenge:v1';
const NAME_MAX = 20;
export const ANON = 'A friend';

export const cleanName = (s: string) => s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX) || ANON;

export function challengeParam(c: Challenge): string {
  return `${c.date}.${Math.round(c.score)}.${c.win ? 'w' : 'l'}.${encodeURIComponent(cleanName(c.name))}`;
}

export function challengeUrl(c: Challenge, origin = location.origin): string {
  return `${origin}/?c=${challengeParam(c)}&ref=challenge`;
}

/** The parameter back into a challenge, or null for anything malformed. */
export function parseChallenge(param: string | null | undefined): Challenge | null {
  if (!param) return null;
  const m = /^(\d{4}-\d{2}-\d{2})\.(\d{1,3})\.([wl])\.(.{0,200})$/s.exec(param);
  if (!m) return null;
  const score = Number(m[2]);
  if (!Number.isInteger(score) || score < 0 || score > 100 || Number.isNaN(Date.parse(m[1] + 'T00:00:00Z'))) return null;
  let name: string;
  try { name = decodeURIComponent(m[4]); } catch { name = m[4]; }
  return { date: m[1], score, win: m[3] === 'w', name: cleanName(name) };
}

export function challengeText(c: Challenge, dayNo: number, url: string): string {
  return `I scored ${Math.round(c.score)} on The 4th Call #${dayNo}${c.win ? ' and won the game' : ''}. Same spot, same clock: think you can call it better?\n${url}`;
}

/** Runs before the app renders: a challenge in the address is saved and the address is cleaned (the hash stays). */
export function captureChallenge(): Challenge | null {
  try {
    const u = new URL(location.href);
    const c = parseChallenge(u.searchParams.get('c'));
    if (!c) return null;
    localStorage.setItem(KEY, JSON.stringify(c));
    u.searchParams.delete('c');
    history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
    return c;
  } catch { return null; }
}

export function loadChallenge(): Challenge | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Challenge;
    return parseChallenge(challengeParam(c));   // re-validated through the same rules
  } catch { return null; }
}

export function clearChallenge() { try { localStorage.removeItem(KEY); } catch { /* fine */ } }
