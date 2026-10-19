import { describe, expect, it } from 'vitest';
import { challengeParam, challengeText, challengeUrl, cleanName, parseChallenge } from './challenge';

describe('challenge links', () => {
  it('round-trips a challenge through the parameter', () => {
    const c = { date: '2026-10-19', score: 72, win: true, name: 'Coach Name' };
    expect(parseChallenge(challengeParam(c))).toEqual(c);
    expect(challengeUrl(c, 'https://nfl-2min-drill.com')).toBe('https://nfl-2min-drill.com/?c=2026-10-19.72.w.Coach%20Name&ref=challenge');
  });
  it('rejects malformed parameters', () => {
    for (const bad of [null, '', 'x', '2026-10-19', '2026-10-19.101.w.a', '2026-13-40.50.w.a', '2026-10-19.50.x.a', '2026-10-19.-5.w.a', '20261019.50.w.a']) {
      expect(parseChallenge(bad)).toBeNull();
    }
  });
  it('cleans and bounds names, and never yields an empty one', () => {
    expect(cleanName('  <b>Evil</b> ')).toBe('bEvil/b');
    expect(cleanName('a'.repeat(50))).toHaveLength(20);
    expect(cleanName('   ')).toBe('A friend');
    expect(parseChallenge('2026-10-19.50.l.%E2%9C%93%20ok')!.name).toBe('✓ ok');
    expect(parseChallenge('2026-10-19.50.l.%E0')!.name).toBe('%E0');   // bad escape: kept literally, not thrown
  });
  it('writes the share text with the day and the link', () => {
    const t = challengeText({ date: '2026-10-19', score: 72, win: false, name: 'Me' }, 292, 'https://x/?c=1');
    expect(t).toContain('72');
    expect(t).toContain('#292');
    expect(t).not.toContain('won the game');
    expect(t.endsWith('https://x/?c=1')).toBe(true);
  });
});
