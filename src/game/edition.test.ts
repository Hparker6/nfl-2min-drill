/** The Coach's Edition gate: hidden in production (nothing can be bought yet), reviewable in development. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editionShown, editionState, ownsEdition, setEditionForTest } from './edition';

afterEach(() => { vi.unstubAllEnvs(); setEditionForTest(null); });

describe('edition gate', () => {
  it('a production build hides it, whatever the address or storage says', () => {
    vi.stubEnv('DEV', false);
    (globalThis as { location?: unknown }).location = { search: '?edition=owned' };
    setEditionForTest(null);
    expect(editionState()).toBe('hidden');
    expect(editionShown()).toBe(false);
    expect(ownsEdition()).toBe(false);
    delete (globalThis as { location?: unknown }).location;
  });

  it('development shows it locked by default (no browser storage: still locked)', () => {
    vi.stubEnv('DEV', true);
    setEditionForTest(null);
    expect(editionState()).toBe('locked');
    expect(editionShown()).toBe(true);
    expect(ownsEdition()).toBe(false);
  });

  it('owned only when set', () => {
    setEditionForTest('owned');
    expect(ownsEdition()).toBe(true);
    setEditionForTest('hidden');
    expect(editionShown()).toBe(false);
  });

  it('?edition=account: owned only when the server last said this account owns it', () => {
    const m = new Map<string, string>();
    const ls = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
    (globalThis as { localStorage?: unknown }).localStorage = ls;
    (globalThis as { location?: unknown }).location = { search: '?edition=account' };
    vi.stubEnv('DEV', true);
    setEditionForTest(null);
    expect(editionState()).toBe('locked');
    m.set('the4thcall:account:owns', JSON.stringify(['coach_edition']));
    setEditionForTest(null);
    expect(editionState()).toBe('owned');
    m.set('the4thcall:account:owns', 'not json');
    setEditionForTest(null);
    expect(editionState()).toBe('locked');
    // production ignores all of it
    vi.stubEnv('DEV', false);
    m.set('the4thcall:account:owns', JSON.stringify(['coach_edition']));
    setEditionForTest(null);
    expect(editionState()).toBe('hidden');
    delete (globalThis as { localStorage?: unknown }).localStorage;
    delete (globalThis as { location?: unknown }).location;
  });
});
