/**
 * Risks that paid off: the calls a coach would think twice about, made by you (in the moments you played) and made
 * to work. Each one is worth extra XP and a free point in the attribute it showed off, so a quarterback who takes his
 * shots and hits them grows faster than one who checks it down all day. Failed risks cost nothing extra: the
 * interception already costs XP and the grade already judges the call.
 */
import { CALL } from '../engine/data';
import type { Ev } from '../engine/types';

export type RiskAttr = 'accuracy' | 'arm' | 'decision' | 'mobility';
export type RiskKind = 'deep' | 'fourth' | 'two' | 'trick' | 'escape';
export interface RiskWin { kind: RiskKind; label: string; attr: RiskAttr }

/** XP for each risk that paid off, and how many count in one game. */
export const RISK_XP = 40;
export const RISK_CAP = 4;

export const RISK_ATTR_NAME: Record<RiskAttr, string> = { accuracy: 'Accuracy', arm: 'Arm', decision: 'Decisions', mobility: 'Mobility' };

/** The risks that paid off in these events, for team 0 (the player's side). One per snap. */
export function riskWins(evs: Ev[]): RiskWin[] {
  const out: RiskWin[] = [];
  for (const e of evs) {
    if (e.type === 'pat') {
      if (e.off === 0 && e.two && e.good) out.push({ kind: 'two', label: 'Went for two and got it', attr: 'accuracy' });
      continue;
    }
    if (e.type !== 'snap' || e.off !== 0 || e.try) continue;
    const r = e.res, c = CALL[r.call];
    if (!c || (r.turnover && !r.td)) continue;
    const gained = r.td || r.yards >= e.dist0;
    if (e.down0 === 4 && gained) { out.push({ kind: 'fourth', label: `Went for it on 4th & ${e.dist0 >= 100 - e.yl0 ? 'goal' : e.dist0} and made it`, attr: 'decision' }); continue; }
    if (c.kind === 'pass' && c.risk === 3 && !c.trick && r.complete && (r.td || r.yards >= 20)) {
      out.push({ kind: 'deep', label: r.call === 'hail' ? 'Hail Mary, caught' : `Deep shot for ${r.yards} yards${r.td ? ' and a touchdown' : ''}`, attr: 'arm' });
      continue;
    }
    if (c.trick && !r.turnover && (r.td || r.yards >= 10)) { out.push({ kind: 'trick', label: `${c.name} for ${r.yards} yards${r.td ? ' and a touchdown' : ''}`, attr: 'decision' }); continue; }
    if (r.kind === 'scramble' && r.yards >= 12) out.push({ kind: 'escape', label: `Escaped the rush for ${r.yards} yards`, attr: 'mobility' });
  }
  return out;
}
