/**
 * Sending sign-in emails.
 *   console  prints the link and code to the Worker's log; localhost only (config.ts refuses it anywhere else)
 *   resend   Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email), over fetch: no SDK
 *   off      sign-in by email is unavailable (routes.ts answers 503 before anything is written)
 *
 * What a provider gets: the recipient's address and the message (the link and the code). What is logged when sending
 * fails: the provider's HTTP status, never the address, the link, the code or the API key.
 */
import type { MailConfig } from './config';

export interface SignInEmail { to: string; link: string; code: string; minutes: number }

/** True when the provider accepted the message. Never throws. */
export interface Mailer { send(m: SignInEmail): Promise<boolean> }

export const consoleMailer: Mailer = {
  async send(m) {
    console.log(`[dev mail] sign-in for ${m.to}: ${m.link} (code ${m.code}, valid ${m.minutes} minutes)`);
    return true;
  },
};

export const MAIL_TIMEOUT_MS = 10_000;

/** Resend: one POST per message. */
export function resendMailer(cfg: Extract<MailConfig, { kind: 'resend' }>, f: typeof fetch): Mailer {
  return {
    async send(m) {
      const { subject, text, html } = signInText(m);
      try {
        const r = await f('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: cfg.from, to: [m.to], subject, text, html, tags: [{ name: 'category', value: 'sign_in' }] }),
          signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
        });
        if (r.ok) return true;
        console.error(`sign-in email not sent: Resend answered ${r.status}`);
        return false;
      } catch (e) {
        console.error(`sign-in email not sent: ${(e as Error)?.name === 'TimeoutError' ? 'Resend timed out' : 'Resend unreachable'}`);
        return false;
      }
    },
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The message. The code is in the body, not the subject, so it doesn't show on a lock screen or in an inbox list.
 */
export function signInText(m: SignInEmail): { subject: string; text: string; html: string } {
  const subject = 'Sign in to The 4th Call';
  const text = [
    'Sign in to The 4th Call:',
    m.link,
    '',
    `Or enter this code: ${m.code}`,
    '',
    `The link and the code work once, for ${m.minutes} minutes. If you didn't ask to sign in, ignore this email: nothing happens without it.`,
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5">
<p>Sign in to The 4th Call:</p>
<p><a href="${esc(m.link)}" style="display:inline-block;background:#f5c518;color:#1b1600;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Sign in</a></p>
<p>Or enter this code: <b style="font-size:20px;letter-spacing:3px">${esc(m.code)}</b></p>
<p style="color:#555;font-size:13px">The link and the code work once, for ${m.minutes} minutes. If you didn't ask to sign in, ignore this email: nothing happens without it.</p>
</body></html>`;
  return { subject, text, html };
}
