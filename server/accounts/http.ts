/** Responses, cookies and the request checks every account endpoint shares. */
import { sha256 } from './crypto';

export const SESSION_COOKIE = '__Host-4c_sid';

const HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-resource-policy': 'same-origin',
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...HEADERS, ...extra } });
}

export const fail = (status: number, error: string, extra: Record<string, string> = {}) => json({ error }, status, extra);

/** The session cookie: host-only, HTTPS-only, invisible to scripts, not sent on cross-site requests. */
export function sessionCookie(token: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/**
 * A state-changing request must come from our own pages: the Origin header is one of ours, the browser doesn't call
 * it cross-site, and the body is JSON (which a plain HTML form can't send). Returns the reason it fails, or null.
 */
export function checkWrite(req: Request, origins: string[]): string | null {
  if (req.method !== 'POST') return 'method';
  const origin = req.headers.get('origin');
  if (!origin || !origins.includes(origin)) return 'origin';
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return 'origin';
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return 'content-type';
  return null;
}

/**
 * The body as text, at most `max` bytes, or null when it's bigger. A declared Content-Length over the limit is refused
 * before anything is read, and a body without one (or lying about it) is read in chunks and abandoned past the limit:
 * nobody can make the Worker buffer a huge upload.
 */
export async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = req.headers.get('content-length');
  if (declared !== null && (!/^\d{1,12}$/.test(declared) || Number(declared) > max)) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(all); } catch { return null; }   // not valid UTF-8: not ours
}

/** Read a small JSON object (null when it's too big, not UTF-8, not JSON, or not an object). */
export async function readJson(req: Request, max = 2048): Promise<Record<string, unknown> | null> {
  const raw = await readCapped(req, max);
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

/** The caller's address, as a keyed hash: counted for rate limits, never stored as itself. */
export async function addressKey(req: Request, pepper: string): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  return (await sha256(`${pepper}:addr:${ip}`)).slice(0, 32);
}
