/**
 * Sending sign-in emails. No email provider is chosen yet, so there are two modes: "console" prints the link and code
 * to the Worker's log, allowed only when the site runs on localhost (config.ts), and "off", where sign-in by email
 * is unavailable. A real provider plugs in here.
 */
export interface SignInEmail { to: string; link: string; code: string; minutes: number }

export interface Mailer { send(m: SignInEmail): Promise<boolean> }

export const consoleMailer: Mailer = {
  async send(m) {
    console.log(`[dev mail] sign-in for ${m.to}: ${m.link} (code ${m.code}, valid ${m.minutes} minutes)`);
    return true;
  },
};

/** The email's words, for when a provider is connected (and for the tests to check what a message says). */
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
