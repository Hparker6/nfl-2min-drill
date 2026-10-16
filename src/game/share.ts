/** Share text for a finished day or survivor run, and the coach profile. */
import { ARCHETYPES, CALL, type ArchetypeId } from '../engine/data';
import { DEF_PLAYS } from '../engine/defense';
import { dayNumber } from '../engine/scenario';
import { GRADE_INFO } from './grade';
import type { Record_ } from './session';
import type { SpotResult } from './storage';
import { track } from './analytics';
import { rateSpots } from './rating';

// ?ref=share lets analytics count visits that came from a shared result (the canonical link keeps it out of search)
const site = () => (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file') ? `${location.origin}${location.pathname}?ref=share` : 'The 4th Call');


export function dailyShare(date: string, spots: SpotResult[], streakN: number, extra: { percentile?: number | null; coach?: string; rank?: { rank: number; count: number } | null } = {}): string {
  const s = spots[0];
  const r = rateSpots(spots);
  const lines = [
    `The 4th Call #${dayNumber(date)}`,
    `Performance ${r.performance}/100${extra.rank ? ` · #${extra.rank.rank.toLocaleString()} of ${extra.rank.count.toLocaleString()} today` : extra.percentile != null ? ` · better than ${extra.percentile}% of play-callers` : ''}`,
  ];
  if (extra.coach) lines.push(`Coached like ${extra.coach}`);
  if (s) {
    // one square per graded call; a long game is summarized so the card stays short
    const sq = s.grades.map((g) => GRADE_INFO[g].emoji);
    const counts = (['g', 'y', 'o', 'r'] as const).map((g) => [GRADE_INFO[g].emoji, s.grades.filter((x) => x === g).length] as const).filter(([, n]) => n);
    lines.push(`${s.teams[0]} ${s.win ? 'W' : 'L'} ${s.score[0]}–${s.score[1]} ${sq.length <= 14 ? sq.join('') : counts.map(([e, n]) => `${e}${n}`).join(' ')}`);
  }
  if (streakN > 1) lines.push(`🔥 ${streakN}-day streak`);
  lines.push(`Can you beat me? ${site()}`);
  return lines.join('\n');
}

export function survivorShare(results: SpotResult[]): string {
  const wins = results.filter((r) => r.win).length;
  return [
    `The 4th Call · Survivor`,
    `Survived ${wins} game${wins === 1 ? '' : 's'} · Performance ${rateSpots(results).performance}`,
    results.map((r) => (r.win ? '🏈' : '💀')).join(''),
    site(),
  ].join('\n');
}

export async function shareText(text: string, what: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      await navigator.share({ text });
      track('share', { what, method: 'sheet' });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return 'failed';
  }
  try {
    await navigator.clipboard.writeText(text);
    track('share', { what, method: 'copy' });
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Tags describing each call, for the coach profile. */
export function tagsOf(records: Record_[]): string[] {
  const tags: string[] = [];
  for (const r of records) {
    const c = r.choice;
    if (r.step === 'play' && c.play) {
      const call = CALL[c.play];
      if (call) {
        tags.push(call.fam);
        if (call.kind === 'pass') tags.push(call.risk === 3 ? 'deep' : 'short');
        if (call.id === 'quick_out' || call.id === 'comeback') tags.push('sideline');
      } else tags.push(c.play);
      if (r.situation.includes('4th &') && call) tags.push('go4');
      if (r.situation.includes('4th &') && !call && (c.play === 'fg' || c.play === 'punt')) tags.push('kick4');
    }
    if (r.step === 'offClock' && c.offClock) tags.push(`clock:${c.offClock}`);
    if (r.step === 'look' && c.look) {
      tags.push(`look:${c.look}`);
      // every pressure call counts as a blitz, and prevent (or its old name) as playing it soft
      if (c.look !== 'soft' && (DEF_PLAYS[c.look].cat === 'blitz' || c.look === 'glblitz' || c.look === 'runblitz')) tags.push('dpress');
      if (c.look === 'prevent' || c.look === 'soft') tags.push('dsoft');
    }
    if (r.step === 'pat' && c.pat === 'two') tags.push('two');
    if (r.step === 'kick' && c.kick === 'onside') tags.push('onside');
  }
  return tags;
}

export function archetype(tags: string[]): ArchetypeId {
  const n = (t: string) => tags.filter((x) => x === t || x.startsWith(t + ':')).length;
  const plays = n('run') + n('pass') + n('rpo') + n('trick') || 1;
  const looks = n('look') || 1;
  const score: Record<ArchetypeId, number> = {
    gunslinger: n('deep') / plays * 1.3,
    professor: n('short') / plays,
    grinder: (n('run') + n('rpo') * 0.5) / plays,
    gambler: (n('trick') * 2 + n('go4') * 2 + n('two') * 2 + n('onside') * 2) / plays,
    surgeon: (n('clock:nohuddle') + n('clock:timeout') + n('clock:spike') + n('sideline')) / (plays + n('clock')) * 1.2,
    pressure: n('look') ? n('dpress') / looks * 0.9 : 0,
    bend: n('look') ? n('dsoft') / looks * 0.9 : 0,
  };
  return (Object.keys(score) as ArchetypeId[]).reduce((a, b) => (score[b] > score[a] ? b : a));
}

/** The numbers behind the profile, in words: what you did, and what the typical play-caller does. */
export function profileFacts(tags: string[]): string[] {
  const n = (t: string) => tags.filter((x) => x === t).length;
  const out: string[] = [];
  const fourth = n('go4') + n('kick4');
  if (fourth) out.push(`went for it on ${n('go4')} of ${fourth} fourth down${fourth === 1 ? '' : 's'} (most coaches: ${Math.round(fourth * 0.3)})`);
  const throws = n('short') + n('deep');
  if (throws >= 3) out.push(n('short') >= n('deep') ? `kept it short on ${n('short')} of ${throws} throws (most: ${Math.round(throws * 0.6)})` : `went deep on ${n('deep')} of ${throws} throws (most: ${Math.round(throws * 0.4)})`);
  const runs = n('run') + n('rpo'), plays = runs + throws;
  if (plays >= 4 && runs / plays >= 0.5) out.push(`ran it on ${runs} of ${plays} snaps (most: ${Math.round(plays * 0.4)})`);
  const looks = tags.filter((x) => x.startsWith('look:')).length;
  if (looks >= 3) {
    const b = n('dpress'), p = n('dsoft');
    if (b >= p) out.push(`blitzed on ${b} of ${looks} defensive snaps (most: ${Math.round(looks * 0.25)})`);
    else out.push(`played it soft on ${p} of ${looks} defensive snaps (most: ${Math.round(looks * 0.2)})`);
  }
  const to = n('clock:timeout') + n('clock:drain');
  if (to) out.push(`used ${to} timeout${to === 1 ? '' : 's'} on offense`);
  if (n('two')) out.push('went for two');
  if (n('onside')) out.push('tried an onside kick');
  return out.slice(0, 3);
}

export { ARCHETYPES };
