/** The leaderboard's checks: the names it shows, who counts as one caller, and which scores a game can produce. */
// names are public on the board: letters, digits and a little punctuation, 20 characters, no obvious abuse.
// Whole words only (\b): a word hiding inside a real name (Scunthorpe, Harshita, Siriporn) is left alone.
const BLOCK = /\b(fuck\w*|shit\w*|cunt\w*|nigg\w*|fag\w*|bitch\w*|whore\w*|slut\w*|rape\w*|rapist|nazi\w*|hitler|porn\w*|dick|dicks|cock|cocks|pussy|asshole\w*|retard\w*)\b/i;
// Cyrillic and Lisu letters that look Latin, folded before the check (fuсk with a Cyrillic с). Letters only: digits
// stay digits, so a name with a number in it is never read as a word.
const LOOKALIKE = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ѕ': 's', 'к': 'k', 'н': 'h', 'т': 't', 'м': 'm', 'в': 'b', 'ꓑ': 'p', 'ꓳ': 'o', 'ꓣ': 'r', 'ꓠ': 'n', 'ꓢ': 's', 'ꓡ': 'l', 'ꓔ': 't', 'ꓕ': 't' };
// Hangul fillers and other blanks that NFKC keeps as "letters" but render as nothing
const INVISIBLE = /[ᅟᅠㅤﾠ⠀᠎​-‏⁠-⁤﻿]/gu;
export function cleanName(s) {
  const n = String(s ?? '').normalize('NFKC').replace(INVISIBLE, '').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!n || !/[\p{L}\p{N}]/u.test(n)) return 'Anonymous';
  // the check also reads a copy with look-alikes folded and spelled-out letters joined (f.u.c.k, f_u_c_k, f u c k):
  // only runs of single letters are joined, so "J. R. Smith" and "Jo Ann" stay as they are
  const folded = [...n].map((ch) => LOOKALIKE[ch.toLowerCase()] ?? ch).join('')
    .replace(/(?:^|(?<=[\s._'-]))(?:\p{L}[\s._'-]){3,}\p{L}(?=$|[\s._'-])/gu, (m) => m.replace(/[\s._'-]/g, ''));
  return BLOCK.test(n) || BLOCK.test(folded) ? 'Coach' : n;
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
