import { describe, expect, it, vi } from 'vitest';
import { analyticsAllowed, leaveOnce, track } from './analytics';

describe('analytics', () => {
  it('reports only from the production site', () => {
    expect(analyticsAllowed('nfl-2min-drill.com')).toBe(true);
    expect(analyticsAllowed('www.nfl-2min-drill.com')).toBe(true);
    expect(analyticsAllowed('NFL-2MIN-DRILL.COM')).toBe(true);
    for (const h of ['localhost', '127.0.0.1', 'nfl-2min-drill.hparker6.workers.dev', 'preview.nfl-2min-drill.com', 'nfl-2min-drill.com.evil.example', '']) expect(analyticsAllowed(h), h).toBe(false);
  });
  it('one leave per time away: hiding the tab and then unloading the page send one event', () => {
    const send = vi.fn();
    const away = leaveOnce(send);
    away.hidden(); away.hidden();          // visibilitychange to hidden, then pagehide
    expect(send).toHaveBeenCalledTimes(1);
    away.back(); away.hidden();            // came back, left again
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('track is a no-op without the tag (local builds, blocked scripts)', () => {
    expect(() => track('game_start', { mode: 'daily' })).not.toThrow();
  });
});
