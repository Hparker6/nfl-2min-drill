/**
 * Sending sign-in emails. Three modes (config.ts): "resend" sends through Resend's API with a key kept as a Worker
 * secret; "console" prints the link and code to the Worker's log, allowed only when the site runs on localhost; and
 * "off", where sign-in by email is unavailable.
 */
export interface SignInEmail { to: string; link: string; code: string; minutes: number }

export interface Mailer { send(m: SignInEmail): Promise<boolean> }

export const consoleMailer: Mailer = {
  async send(m) {
    console.log(`[dev mail] sign-in for ${m.to}: ${m.link} (code ${m.code}, valid ${m.minutes} minutes)`);
    return true;
  },
};

/** Resend (https://resend.com): one POST per message. The key never leaves the Worker; a failure is just "not sent". */
export function resendMailer(apiKey: string, from: string, f: typeof fetch = fetch): Mailer {
  return {
    async send(m) {
      const { subject, text } = signInText(m);
      try {
        const r = await f('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [m.to], subject, text }),
        });
        return r.ok;
      } catch { return false; }
    },
  };
}

/** The email's words (and what the tests check a message says). */
export function signInText(m: SignInEmail): { subject: string; text: string } {
  return {
    subject: `Your sign-in code for The 4th Call: ${m.code}`,
    text: [
      'Sign in to The 4th Call:',
      m.link,
      '',
      `Or enter this code: ${m.code}`,
      '',
      `The link and the code work once, for ${m.minutes} minutes. If you didn't ask to sign in, ignore this email: nothing happens without it.`,
    ].join('\n'),
  };
}
