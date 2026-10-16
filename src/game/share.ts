/** Share text for a finished day or survivor run, and the coach profile. */
import { ARCHETYPES, CALL, type ArchetypeId } from '../engine/data';
import { dayNumber } from '../engine/scenario';
import { GRADE_INFO } from './grade';
import type { Record_ } from './session';
import type { SpotResult } from './storage';
import { track } from './analytics';
import { rateSpots } from './rating';

const site = () => (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file') ? location.origin + location.pathname : 'The 4th Call');


export function dailyShare(date: string, spots: SpotResult[], streakN: number): string {
  const wins = spots.filter((s) => s.win).length;
  const lines = spots.map((s, i) => `${i + 1} ${s.win ? '✅' : '❌'} ${s.grades.map((g) => GRADE_INFO[g].emoji).join('')}`);
  return [
    `The 4th Call #${dayNumber(date)}`,
    `${wins}-${spots.length - wins} · Performance ${rateSpots(spots).performance} · Decisions ${rateSpots(spots).decisions}${streakN > 1 ? ` · 🔥${streakN}` : ''}`,
    ...lines,
    site(),
  ].join('\n');
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
    }
    if (r.step === 'offClock' && c.offClock) tags.push(`clock:${c.offClock}`);
    if (r.step === 'look' && c.look) tags.push(`look:${c.look}`);
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
    pressure: n('look') ? tags.filter((t) => t === 'look:blitz').length / looks * 0.9 : 0,
    bend: n('look') ? tags.filter((t) => t === 'look:soft').length / looks * 0.9 : 0,
  };
  return (Object.keys(score) as ArchetypeId[]).reduce((a, b) => (score[b] > score[a] ? b : a));
}

export { ARCHETYPES };
