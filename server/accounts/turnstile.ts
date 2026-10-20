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

/** True when Cloudflare says the token is real for this secret (and this caller). Never throws. */
export async function verifyTurnstile(secret: string, token: unknown, ip: string | null, f: typeof fetch): Promise<boolean> {
  if (typeof token !== 'string' || token.length < 10 || token.length > 2048 || !/^[A-Za-z0-9._-]+$/.test(token)) return false;
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set('remoteip', ip);
    const r = await f(VERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS) });
    if (!r.ok) return false;
    const d = await r.json() as { success?: boolean };
    return d?.success === true;
  } catch { return false; }
}
