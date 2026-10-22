/**
 * Career saves: up to three careers in this browser (slots 2 and 3 come with the Coach's Edition), plus a file to
 * move one to another device, and the Hall: every career that retired, kept even after its save is deleted.
 *
 * Slot 1 is the key every career was saved under before there were slots, so an existing career is already in slot 1
 * and nothing is copied or moved. Slots 2 and 3 have keys of their own. Each slot also keeps a small summary (name,
 * team, year…) so the slot list doesn't parse three whole leagues to draw itself; a career without one (saved
 * before slots) gets it the first time the list is drawn.
 */
import type { Career } from './career';
import { ensureLegacy, type HallEntry } from './legacy';

export const SLOT_COUNT = 3;
const KEY = 'the4thcall:career:v1';
const ACTIVE = 'the4thcall:career:active';
const HALL = 'the4thcall:hall:v1';

export const slotKey = (slot: number) => (slot === 1 ? KEY : `${KEY}:slot${slot}`);
const metaKey = (slot: number) => `the4thcall:career:meta:${slot}`;
const okSlot = (n: number) => Number.isInteger(n) && n >= 1 && n <= SLOT_COUNT;

/** What the slot list shows for a career. */
export interface SlotMeta {
  slot: number;
  name: string;
  number: number;
  arch: string;
  team?: string;        // team id (none before the draft)
  year: number;
  phase: Career['phase'];
  ovr: number;
  seasons: number;
  updated: number;
  retired?: string;     // the Hall of Fame verdict, once retired
}

export function metaOf(c: Career, slot: number): SlotMeta {
  const me = c.league.players[c.you.pid];
  return {
    slot, name: c.you.name, number: c.you.number, arch: c.you.arch, team: me?.team ?? undefined,
    year: c.season.year, phase: c.phase, ovr: me?.rating ?? 0, seasons: c.history.length, updated: Date.now(),
    retired: c.legacy?.retired?.verdict.title,
  };
}

const valid = (c: Career | null): c is Career => !!c && c.v === 1 && !!c.league && !!c.season && !!c.you;

/** The slot played last (1 when none was chosen). */
export function activeSlot(): number {
  try { const n = Number(localStorage.getItem(ACTIVE)); return okSlot(n) ? n : 1; } catch { return 1; }
}

export function setActiveSlot(slot: number) {
  if (!okSlot(slot)) return;
  try { localStorage.setItem(ACTIVE, String(slot)); } catch { /* storage off: the choice lasts this visit */ }
}

/**
 * Load a slot. A save that can't be read is kept under another key (never overwritten by the next career) and the
 * slot reads as empty.
 */
export function loadCareer(slot = activeSlot()): Career | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(slotKey(slot));
    if (!raw) return null;
    const c = JSON.parse(raw) as Career;
    if (!valid(c)) throw new Error('not a career');
    ensureLegacy(c);
    return c;
  } catch (e) {
    console.warn(`career slot ${slot} could not be read (${String((e as Error)?.message).slice(0, 80)}); the data is kept under another key`);
    try {
      if (raw) {
        localStorage.setItem(`${slotKey(slot)}:unreadable:${Date.now()}`, raw);
        localStorage.removeItem(slotKey(slot));
        localStorage.removeItem(metaKey(slot));
      }
    } catch { /* storage full or off */ }
    return null;
  }
}

/** How many unreadable saves were set aside for a slot (loadCareer keeps them under their own keys). */
export function unreadableSaves(slot: number): number {
  try { return Object.keys(localStorage).filter((k) => k.startsWith(`${slotKey(slot)}:unreadable:`)).length; } catch { return 0; }
}

/** Save to a slot (null deletes it). Returns false when the browser refused (storage full or blocked). */
export function saveCareer(c: Career | null, slot = activeSlot()): boolean {
  try {
    if (!c) {
      localStorage.removeItem(slotKey(slot));
      localStorage.removeItem(metaKey(slot));
    } else {
      localStorage.setItem(slotKey(slot), JSON.stringify(c));
      try { localStorage.setItem(metaKey(slot), JSON.stringify(metaOf(c, slot))); } catch { /* the list rebuilds it */ }
    }
    return true;
  } catch { return false; }
}

/** Every slot: its career's summary, or null when empty. */
export function listSlots(): (SlotMeta | null)[] {
  const out: (SlotMeta | null)[] = [];
  for (let slot = 1; slot <= SLOT_COUNT; slot++) {
    let m: SlotMeta | null = null;
    try {
      const has = localStorage.getItem(slotKey(slot)) != null;
      const raw = has ? localStorage.getItem(metaKey(slot)) : null;
      if (raw) m = JSON.parse(raw) as SlotMeta;
      else if (has) {
        const c = loadCareer(slot);
        if (c) {
          m = metaOf(c, slot);
          try { localStorage.setItem(metaKey(slot), JSON.stringify(m)); } catch { /* fine: built again next time */ }
        }
      }
    } catch { m = null; }
    out.push(m && m.slot === slot ? m : m ? { ...m, slot } : null);
  }
  return out;
}

/** The career as a file to download. */
export function exportCareer(c: Career): Blob {
  return new Blob([JSON.stringify(c)], { type: 'application/json' });
}

export const IMPORT_MAX_BYTES = 8 * 1024 * 1024;   // a season is well under a megabyte

export async function importCareer(f: File): Promise<Career> {
  if (f.size > IMPORT_MAX_BYTES) throw new Error('That file is too big to be a saved career.');
  let c: Career;
  try { c = JSON.parse(await f.text()) as Career; } catch { throw new Error('That file is not a saved career.'); }
  if (!valid(c)) throw new Error('That file is not a saved career.');
  ensureLegacy(c);
  return c;
}

// ---- the Hall: retired careers ----

export function loadHall(): HallEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(HALL) ?? '[]');
    return Array.isArray(v) ? v.filter((e) => e && typeof e.id === 'string') : [];
  } catch { return []; }
}

/** Add (or update) a retired career in the Hall. */
export function addToHall(e: HallEntry): boolean {
  const all = loadHall().filter((x) => x.id !== e.id);
  all.push(e);
  all.sort((a, b) => b.score - a.score);
  try { localStorage.setItem(HALL, JSON.stringify(all)); return true; } catch { return false; }
}
