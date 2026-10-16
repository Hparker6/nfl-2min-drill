/** Seeded randomness. Everything that decides a real snap is drawn from these, so a day plays the same for everyone. */
export type Rng = () => number;

/** mulberry32: small, fast, good enough for a game. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the joined parts. */
export function hash(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Standard normal draw (Box-Muller). */
export function gauss(r: Rng): number {
  const u = 1 - r();
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Pick a key from a weight table. */
export function pickWeighted<K extends string>(r: Rng, w: Partial<Record<K, number>>): K {
  let total = 0;
  for (const k in w) total += w[k] as number;
  let x = r() * total;
  let last = '' as K;
  for (const k in w) {
    last = k;
    x -= w[k] as number;
    if (x <= 0) return k;
  }
  return last;
}

export const clip = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
