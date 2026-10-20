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
          body: JSON.stringify({ from: cfg.from, to: [m.to], subject, text, html, headers: { 'X-Entity-Ref-ID': crypto.randomUUID() }, tags: [{ name: 'category', value: 'sign_in' }] }),
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

/** The site's address for the footer: just the host of the sign-in link (it is the site the player asked from). */
const hostOf = (link: string) => { try { return new URL(link).host; } catch { return 'nfl-2min-drill.com'; } };

/**
 * The message, as plain text and as HTML. What it is designed around:
 * - The code is in the body, never the subject or the preview line, so it doesn't show on a lock screen.
 * - It reads the same with images off (there are none) and in dark mode (colors set on table cells, which mail
 *   apps keep; text sits on its own background everywhere).
 * - Table layout with inline styles, 520px wide: the one HTML that Gmail, Outlook, Apple Mail and Yahoo all render.
 * - It says why it arrived and that nobody will ever ask for the code: transactional, not marketing, and a
 *   standing warning against anyone phishing for codes.
 * Everything that comes from outside (the link, the code) is escaped.
 */
export function signInText(m: SignInEmail): { subject: string; text: string; html: string } {
  const subject = 'Sign in to The 4th Call';
  const host = hostOf(m.link);
  const text = [
    'Sign in to The 4th Call',
    '',
    'Open this link on the device where you asked to sign in:',
    m.link,
    '',
    `Or enter this code: ${m.code}`,
    '',
    `The link and the code work once, for ${m.minutes} minutes.`,
    '',
    "Didn't ask to sign in? Ignore this email: nothing happens without it. We will never ask you for this code.",
    '',
    `The 4th Call · ${host}`,
    'You got this because someone entered this address to sign in. There is no mailing list.',
  ].join('\n');

  const digits = esc(m.code);   // spaced by letter-spacing only, so copying it gives exactly the six digits
  const link = esc(m.link);
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#eef2ef;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">Your sign-in link and code are inside. They work once, for ${m.minutes} minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef2ef" style="background:#eef2ef;">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;border-collapse:separate;">
    <tr><td bgcolor="#0a0e0c" style="background:#0a0e0c;border-radius:14px 14px 0 0;padding:22px 28px;font-family:${font};font-size:20px;font-weight:800;letter-spacing:1.5px;color:#edf2ee;">
      THE <span style="color:#f5c518;">4TH</span> CALL
    </td></tr>
    <tr><td bgcolor="#f5c518" style="background:#f5c518;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:32px 28px 8px;font-family:${font};color:#101813;">
      <h1 style="margin:0 0 10px;font-size:24px;line-height:1.25;font-weight:800;color:#101813;">Sign in to The 4th Call</h1>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.55;color:#2c3a32;">Tap the button on the device where you asked to sign in.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="#f5c518" style="background:#f5c518;border-radius:8px;">
          <a href="${link}" style="display:inline-block;padding:14px 28px;font-family:${font};font-size:16px;font-weight:800;color:#1b1600;text-decoration:none;letter-spacing:.5px;">Sign in</a>
        </td>
      </tr></table>
      <p style="margin:28px 0 8px;font-size:14px;color:#5d6e64;">Or enter this code:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="#f4f7f5" style="background:#f4f7f5;border:1px solid #d6ded9;border-radius:10px;padding:14px 22px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:32px;line-height:1;font-weight:700;letter-spacing:6px;color:#101813;">${digits}</td>
      </tr></table>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.5;color:#5d6e64;">The link and the code work once, for <b style="color:#2c3a32;">${m.minutes} minutes</b>.</p>
    </td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:20px 28px 28px;font-family:${font};border-radius:0 0 14px 14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #e3e9e5;font-size:0;line-height:0;">&nbsp;</td></tr></table>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.55;color:#5d6e64;"><b style="color:#2c3a32;">Didn't ask to sign in?</b> Ignore this email: nothing happens without it. We will never ask you for this code.</p>
      <p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#8b9b91;word-break:break-all;">Button not working? Paste this into your browser:<br><a href="${link}" style="color:#5d6e64;">${link}</a></p>
    </td></tr>
    <tr><td align="center" style="padding:18px 8px 0;font-family:${font};font-size:12px;line-height:1.5;color:#8b9b91;">
      The 4th Call &middot; ${esc(host)}<br>You got this because someone entered this address to sign in. There is no mailing list.
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
  return { subject, text, html };
}
