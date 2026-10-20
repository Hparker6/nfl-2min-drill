/** Responses, cookies and the request checks every account endpoint shares. */
import { sha256 } from './crypto';

export const SESSION_COOKIE = '__Host-4c_sid';

const HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
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

/** Read a small JSON body (null when it's too big or not JSON). */
export async function readJson(req: Request, max = 2048): Promise<Record<string, unknown> | null> {
  const raw = await req.text();
  if (raw.length > max) return null;
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
