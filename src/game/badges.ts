/**
 * Badges: what you've done, kept on this device. Each is earned once, with the date. They come from your finished
 * games (Daily and Survivor; Practice doesn't count, since it lets you build any spot), your daily streaks and your
 * Survivor runs. Badges earn coach titles and unlock looks for the field (cosmetic only: every player has the same
 * plays, so the Daily stays fair).
 */
import { bestStreak, type SpotResult, type Store } from './storage';
import { rateSpot } from './rating';
import { SPOTS_PER_DAY } from '../engine/scenario';

export interface Badge { id: string; icon: string; name: string; how: string }

export const BADGES: Badge[] = [
  { id: 'debut', icon: '◉', name: 'Debut', how: 'Finish your first game.' },
  { id: 'win', icon: '✓', name: 'Win column', how: 'Win a game.' },
  { id: 'outcall', icon: '◆', name: 'Outcalled the bot', how: 'Give up 2+ points less win chance than the AI coach would have in a game.' },
  { id: 'outcall10', icon: '◈', name: 'Coordinator material', how: 'Outcall the AI coach in 10 games.' },
  { id: 'gameball', icon: '★', name: 'Game ball', how: 'Score 90 or more in a game.' },
  { id: 'flawless', icon: '◇', name: 'Flawless', how: 'Make every call green in a game of 3 calls or more.' },
  { id: 'rally', icon: '↺', name: 'Rally', how: 'Win a game you took over down 7 or more.' },
  { id: 'icewater', icon: '❄', name: 'Ice water', how: 'Win a game you took over with a minute or less to play.' },
  { id: 'bonus', icon: '◷', name: 'Bonus football', how: 'Win in overtime.' },
  { id: 'gambler', icon: '⚄', name: 'Gambler', how: 'Convert three fourth downs (over any games).' },
  { id: 'twopoint', icon: '②', name: 'Two-point man', how: 'Convert a two-point try you called.' },
  { id: 'ballhawk', icon: '⦿', name: 'Ball hawk', how: 'Force a turnover with your defense.' },
  { id: 'homerun', icon: '➶', name: 'Home run', how: 'Gain 40 or more yards on one play.' },
  { id: 'clutch', icon: '♥', name: 'Clutch gene', how: 'Make a green call with the game on the line, and win.' },
  { id: 'streak3', icon: '③', name: 'Three straight', how: 'Play the daily 3 days in a row.' },
  { id: 'streak7', icon: '⑦', name: 'Week of work', how: 'Play the daily 7 days in a row.' },
  { id: 'season', icon: '⑰', name: 'Full season', how: 'Finish 17 dailies.' },
  { id: 'streak30', icon: '☗', name: 'Iron man', how: 'Play the daily 30 days in a row.' },
  { id: 'surv5', icon: '▲', name: 'Still standing', how: 'Win 5 straight in a Survivor run.' },
  { id: 'surv10', icon: '♛', name: 'Last one standing', how: 'Win 10 straight in a Survivor run.' },
];

/** Coach titles by badges earned. */
export const TITLES: [number, string][] = [[0, 'Rookie coach'], [3, 'Position coach'], [6, 'Coordinator'], [10, 'Head coach'], [15, 'Hall of Famer']];
export const titleFor = (n: number) => [...TITLES].reverse().find(([k]) => n >= k)![1];

/** Field looks: classic for everyone, the rest unlocked by badges. */
export type FieldLook = 'classic' | 'night' | 'retro' | 'gold';
export const LOOKS_FIELD: { id: FieldLook; name: string; need: number; blurb: string }[] = [
  { id: 'classic', name: 'Classic', need: 0, blurb: 'Grass, chalk and the afternoon sun.' },
  { id: 'night', name: 'Prime time', need: 3, blurb: 'Under the lights: deep turf and a stadium glow.' },
  { id: 'retro', name: 'Throwback', need: 6, blurb: 'Painted dirt-worn grass and warm film colors.' },
  { id: 'gold', name: 'Championship', need: 10, blurb: 'Gold lines and numbers, for a head coach.' },
];

/** The facts of one game that badges read (absent on games saved before badges). */
export interface GameFacts {
  lead0: number;           // your lead when you took over
  t0: number;              // seconds left when you took over
  perfect: boolean;        // every call green, 3 or more calls
  fourth: number;          // fourth downs converted
  two: number;             // two-point tries converted
  takeaways: number;       // turnovers your defense forced
  long: number;            // longest gain of yours
  clutchGreen: boolean;    // a green call with the game on the line
}

const survBest = (st: Store) => Math.max(st.surv.best, st.surv.run && !st.surv.run.over ? st.surv.run.results.filter((r) => r.win).length : 0);

/** Which badges a store has earned (all of them, earned before or not). */
export function earned(st: Store): Set<string> {
  const h = st.history.filter((r) => r.mode === 'daily' || r.mode === 'survivor');
  const f = (r: SpotResult) => r.facts;
  const out = new Set<string>(Object.keys(st.badges ?? {}));
  const add = (id: string, ok: boolean) => { if (ok) out.add(id); };
  add('debut', h.length > 0);
  add('win', h.some((r) => r.win));
  const outcalls = h.filter((r) => r.aiLost - r.lost >= 2).length;
  add('outcall', outcalls >= 1);
  add('outcall10', outcalls >= 10);
  add('gameball', h.some((r) => rateSpot(r).performance >= 90));
  add('flawless', h.some((r) => f(r)?.perfect || (r.grades.length >= 3 && r.grades.every((g) => g === 'g'))));
  add('rally', h.some((r) => r.win && (f(r)?.lead0 ?? 0) <= -7));
  add('icewater', h.some((r) => r.win && f(r) != null && f(r)!.t0 <= 60));
  add('bonus', h.some((r) => r.win && r.ot));
  add('gambler', h.reduce((a, r) => a + (f(r)?.fourth ?? 0), 0) >= 3);
  add('twopoint', h.some((r) => (f(r)?.two ?? 0) > 0));
  add('ballhawk', h.some((r) => (f(r)?.takeaways ?? 0) > 0));
  add('homerun', h.some((r) => (f(r)?.long ?? 0) >= 40));
  add('clutch', h.some((r) => r.win && !!f(r)?.clutchGreen));
  const best = bestStreak(st, SPOTS_PER_DAY);
  add('streak3', best >= 3);
  add('streak7', best >= 7);
  add('streak30', best >= 30);
  add('season', Object.values(st.days).filter((d) => d.spots.length >= SPOTS_PER_DAY).length >= 17);
  add('surv5', survBest(st) >= 5);
  add('surv10', survBest(st) >= 10);
  return out;
}

/** Record newly earned badges in the store (with today's date) and return them. */
export function awardBadges(st: Store, date: string): Badge[] {
  const have = st.badges ?? (st.badges = {});
  const fresh = [...earned(st)].filter((id) => !have[id]);
  for (const id of fresh) have[id] = date;
  return BADGES.filter((b) => fresh.includes(b.id));
}

/** Tell the page about new badges (BadgeToast shows them). */
export function announce(badges: Badge[]) {
  if (badges.length && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('the4thcall:badges', { detail: badges }));
}
