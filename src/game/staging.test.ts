import { describe, expect, it } from 'vitest';
import { isStaging } from './edition';

describe('the staging preview', () => {
  it('matches only the staging Worker address', () => {
    expect(isStaging('nfl-2min-drill-staging.houston-parker.workers.dev')).toBe(true);
    for (const h of ['nfl-2min-drill.com', 'www.nfl-2min-drill.com', 'nfl-2min-drill.houston-parker.workers.dev', 'localhost',
      'nfl-2min-drill-staging.houston-parker.workers.dev.evil.com', 'evil-nfl-2min-drill-staging.x.workers.dev', '']) {
      expect(isStaging(h), h).toBe(false);
    }
  });
});
