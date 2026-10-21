/** The leaderboard's checks: the names it shows, who counts as one caller, and which scores a game can produce. */
// names are public on the board: letters, digits and a little punctuation, 20 characters, no obvious abuse
const BLOCK = /\b(fuck\w*|shit\w*|cunt\w*|nigg\w*|fag\w*|bitch\w*|whore\w*|slut\w*|rape\w*|rapist|nazi\w*|hitler|porn\w*|dick|dicks|cock|cocks|pussy|asshole\w*|retard\w*)\b/i;
// the same words with the separators taken out and look-alikes folded (f.u.c.k, sh1t, Cyrillic letters): no \b here,
// so only words long or rare enough not to sit inside an ordinary name
const SQUASHED = /(fuck|shit|nigg|whore|slut|rapist|hitler|porn|pussy|asshole|retard|bitch)/i;   // not cunt or nazi: Scunthorpe, Ignazio
const LOOKALIKE = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ѕ': 's', 'к': 'k', 'н': 'h', 'т': 't', 'м': 'm', 'в': 'b', 'ꓑ': 'p', 'ꓳ': 'o', 'ꓣ': 'r', 'ꓠ': 'n', 'ꓢ': 's', 'ꓡ': 'l', 'ꓔ': 't', 'ꓕ': 't', '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };
// Hangul fillers and other blanks that NFKC keeps as "letters" but render as nothing
const INVISIBLE = /[\u115F\u1160\u3164\uFFA0\u2800\u180E\u200B-\u200F\u2060-\u2064\uFEFF]/gu;
export function cleanName(s) {
  const n = String(s ?? '').normalize('NFKC').replace(INVISIBLE, '').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!n || !/[\p{L}\p{N}]/u.test(n)) return 'Anonymous';
  const squashed = [...n.toLowerCase()].map((ch) => LOOKALIKE[ch] ?? ch).join('').replace(/[^a-z]/g, '');
  return BLOCK.test(n) || SQUASHED.test(squashed) ? 'Coach' : n;
}

/** The caller for the post limit: an IPv4 address, or an IPv6 /64 (one connection usually holds a whole /64). */
export function callerOf(ip) {
  if (!ip || !ip.includes(':')) return ip || 'unknown';
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/** A Daily performance score is 55% decisions and 45% the result (src/game/rating.ts): a win is at least 34, a loss at most 66. */
export const possible = (score, win) => (win ? score >= 34 : score <= 66);
