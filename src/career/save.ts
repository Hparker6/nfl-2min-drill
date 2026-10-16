/** Career saves: one career in the browser, plus a file to move it to another device. */
import type { Career } from './career';

const KEY = 'the4thcall:career:v1';

export function loadCareer(): Career | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Career;
    return c && c.v === 1 && c.league && c.season ? c : null;
  } catch { return null; }
}

/** Save. Returns false when the browser refused (storage full or blocked): the career still plays, unsaved. */
export function saveCareer(c: Career | null): boolean {
  try {
    if (!c) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(c));
    return true;
  } catch { return false; }
}

/** The career as a file to download. */
export function exportCareer(c: Career): Blob {
  return new Blob([JSON.stringify(c)], { type: 'application/json' });
}

export async function importCareer(f: File): Promise<Career> {
  const c = JSON.parse(await f.text()) as Career;
  if (!c || c.v !== 1 || !c.league || !c.season || !c.you) throw new Error('That file is not a saved career.');
  return c;
}
