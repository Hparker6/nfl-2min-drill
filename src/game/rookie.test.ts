/** The rookie playbook is for new players only, and opens up after three games. */
import { describe, expect, it, beforeEach } from 'vitest';
import { defaultStore, loadStore } from './storage';

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
});

describe('the rookie playbook', () => {
  it('a brand-new player starts with it', () => {
    expect(loadStore().settings.simple).toBe(true);
    expect(defaultStore().settings.simple).toBe(true);
  });
  it('a player who has already played keeps the full playbook', () => {
    const old = { ...defaultStore(), settings: { theme: 'auto', speed: 'normal', hints: true }, history: [{ id: 'x' }] };
    mem.set('the4thcall:v1', JSON.stringify(old));
    expect(loadStore().settings.simple).toBeUndefined();
  });
  it('a choice the player made is kept', () => {
    mem.set('the4thcall:v1', JSON.stringify({ ...defaultStore(), settings: { theme: 'auto', speed: 'normal', hints: true, simple: true, simpleChosen: true }, history: [{ id: 'x' }] }));
    expect(loadStore().settings.simple).toBe(true);
  });
});
