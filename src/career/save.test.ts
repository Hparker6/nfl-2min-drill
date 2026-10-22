/**
 * Career saves: three slots, and careers saved before slots (and before Career Legacy) keep working untouched.
 * Slot 1 is the old key, so an existing career is never copied or moved.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newCareer, type Career } from './career';
import {
  activeSlot, addToHall, importCareer, listSlots, loadCareer, loadHall, saveCareer, setActiveSlot, slotKey, SLOT_COUNT,
} from './save';
import type { HallEntry } from './legacy';

class MemoryStorage {
  m = new Map<string, string>();
  quota = Infinity;
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) {
    const used = [...this.m.entries()].reduce((a, [kk, vv]) => a + (kk === k ? 0 : vv.length), 0);
    if (used + v.length > this.quota) throw new Error('QuotaExceededError');
    this.m.set(k, String(v));
  }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const store = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;

const OLD_KEY = 'the4thcall:career:v1';
let base: Career;
beforeAll(() => { base = newCareer({ name: 'Slot Tester', number: 9, arch: 'pocket', college: 1, seed: 4242 }); });
beforeEach(() => { store.clear(); store.quota = Infinity; });

/** A career as it was saved before Career Legacy existed. */
const preLegacy = (): Career => { const c = structuredClone(base); delete c.legacy; return c; };

describe('slot 1 is the old save', () => {
  it('a career saved before slots loads as slot 1, with its bytes untouched', () => {
    const raw = JSON.stringify(preLegacy());
    store.setItem(OLD_KEY, raw);
    expect(slotKey(1)).toBe(OLD_KEY);
    expect(activeSlot()).toBe(1);
    const c = loadCareer();
    expect(c?.you.name).toBe('Slot Tester');
    // nothing was rewritten by loading: the stored save is byte for byte what it was
    expect(store.getItem(OLD_KEY)).toBe(raw);
    expect([...store.m.keys()].filter((k) => k.startsWith(OLD_KEY))).toEqual([OLD_KEY]);
  });

  it('loading an old career adds its legacy and changes nothing else', () => {
    const old = preLegacy();
    store.setItem(OLD_KEY, JSON.stringify(old));
    const c = loadCareer(1)!;
    expect(c.legacy?.v).toBe(1);
    const { legacy, ...rest } = c;
    expect(legacy).toBeTruthy();
    expect(rest).toEqual(old);
  });

  it('the slot list builds slot 1 from an old save once, then reads its summary', () => {
    store.setItem(OLD_KEY, JSON.stringify(preLegacy()));
    const [s1, s2, s3] = listSlots();
    expect(s1).toMatchObject({ slot: 1, name: 'Slot Tester', number: 9, arch: 'pocket', phase: 'college' });
    expect(s2).toBeNull();
    expect(s3).toBeNull();
    expect(store.getItem('the4thcall:career:meta:1')).toBeTruthy();
    expect(listSlots().length).toBe(SLOT_COUNT);
  });
});

describe('three slots', () => {
  it('each slot saves, loads and deletes on its own', () => {
    const a = structuredClone(base), b = structuredClone(base), d = structuredClone(base);
    b.you.name = 'Second Slot'; d.you.name = 'Third Slot';
    expect(saveCareer(a, 1)).toBe(true);
    const one = store.getItem(OLD_KEY);
    expect(saveCareer(b, 2)).toBe(true);
    expect(saveCareer(d, 3)).toBe(true);
    expect(store.getItem(OLD_KEY)).toBe(one);
    expect(loadCareer(1)?.you.name).toBe('Slot Tester');
    expect(loadCareer(2)?.you.name).toBe('Second Slot');
    expect(loadCareer(3)?.you.name).toBe('Third Slot');
    expect(listSlots().map((m) => m?.name)).toEqual(['Slot Tester', 'Second Slot', 'Third Slot']);
    saveCareer(null, 2);
    expect(loadCareer(2)).toBeNull();
    expect(listSlots().map((m) => m?.name ?? null)).toEqual(['Slot Tester', null, 'Third Slot']);
    expect(store.getItem(OLD_KEY)).toBe(one);
  });

  it('saving without a slot saves to the active one', () => {
    setActiveSlot(3);
    expect(activeSlot()).toBe(3);
    saveCareer(structuredClone(base));
    expect(store.getItem(slotKey(3))).toBeTruthy();
    expect(store.getItem(OLD_KEY)).toBeNull();
  });

  it('a bad active slot falls back to slot 1', () => {
    store.setItem('the4thcall:career:active', '7');
    expect(activeSlot()).toBe(1);
    store.setItem('the4thcall:career:active', 'two');
    expect(activeSlot()).toBe(1);
    setActiveSlot(0);
    expect(activeSlot()).toBe(1);
  });

  it('a full browser refuses the save, reports it, and keeps the old one', () => {
    saveCareer(structuredClone(base), 1);
    const before = store.getItem(OLD_KEY);
    store.quota = 10;
    const c = structuredClone(base); c.you.name = 'Too Big';
    expect(saveCareer(c, 1)).toBe(false);
    expect(store.getItem(OLD_KEY)).toBe(before);
  });
});

describe('damaged saves', () => {
  it('an unreadable save is kept aside, never deleted, and the slot reads as empty', () => {
    store.setItem(slotKey(2), '{"v":1,"league":');
    expect(loadCareer(2)).toBeNull();
    const kept = [...store.m.keys()].filter((k) => k.startsWith(`${slotKey(2)}:unreadable:`));
    expect(kept.length).toBe(1);
    expect(store.getItem(kept[0])).toBe('{"v":1,"league":');
    expect(store.getItem(slotKey(2))).toBeNull();
    expect(listSlots()[1]).toBeNull();
  });

  it('a file that is not a career is refused on import', async () => {
    const file = (text: string) => ({ text: async () => text }) as unknown as File;
    await expect(importCareer(file('{"hello":1}'))).rejects.toThrow('not a saved career');
    const c = await importCareer(file(JSON.stringify(preLegacy())));
    expect(c.legacy?.v).toBe(1);
  });
});

describe('the Hall', () => {
  const entry = (id: string, score: number): HallEntry => ({
    id, name: id, number: 1, arch: 'Pocket Passer', first: 2026, last: 2035, team: 'BKN', teamName: 'Brooklyn Kings',
    score, tier: 'hof', title: 'Hall of Famer', vote: 70, w: 100, l: 60, py: 40000, td: 300, titles: 1,
  });
  it('keeps retired careers best first, one entry per career, after their saves are gone', () => {
    addToHall(entry('a', 120));
    addToHall(entry('b', 260));
    addToHall(entry('a', 180));
    expect(loadHall().map((e) => [e.id, e.score])).toEqual([['b', 260], ['a', 180]]);
    saveCareer(null, 1);
    expect(loadHall().length).toBe(2);
  });
  it('a damaged Hall reads as empty', () => {
    store.setItem('the4thcall:hall:v1', 'not json');
    expect(loadHall()).toEqual([]);
  });
});
