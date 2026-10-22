/**
 * Cloudflare Turnstile: a bot check on the two forms anyone can submit (asking for a sign-in email, the support
 * form). The page gets a token from the widget; the Worker asks Cloudflare whether it is real. On when the
 * TURNSTILE_SECRET is set (config.ts); off, the forms rely on the rate limits alone.
 *
 * Cloudflare's test keys pass everything and are for staging only:
 *   site key 1x00000000000000000000AA, secret 1x0000000000000000000000000000000AA
 */
export const TURNSTILE_TIMEOUT_MS = 8_000;
const VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** What a token must have been made for: the form (its action) and our site (its hostname). */
export interface TurnstileExpect { action: string; hostnames: string[] }

/** Cloudflare's test secrets (pass, fail, already spent) answer with a placeholder hostname and no action. */
export const isTestSecret = (secret: string) => /^[123]x0+AA$/.test(secret);

/**
 * True when Cloudflare says the token is real for this secret (and this caller), and, with `expect`, that it was made
 * on one of our hostnames for this form: a token from another site, or from the other form, is refused. (Skipped for
 * Cloudflare's test secrets, which staging uses.) Never throws.
 */
export async function verifyTurnstile(secret: string, token: unknown, ip: string | null, f: typeof fetch, expect?: TurnstileExpect): Promise<boolean> {
  if (typeof token !== 'string' || token.length < 10 || token.length > 2048 || !/^[A-Za-z0-9._-]+$/.test(token)) return false;
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set('remoteip', ip);
    const r = await f(VERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS) });
    if (!r.ok) return false;
    const d = await r.json() as { success?: boolean; action?: string; hostname?: string };
    if (d?.success !== true) return false;
    if (!expect || isTestSecret(secret)) return true;
    return d.action === expect.action && typeof d.hostname === 'string' && expect.hostnames.includes(d.hostname);
  } catch { return false; }
}
