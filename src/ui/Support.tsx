/**
 * Help & refunds: the form a player uses to ask for a refund, report a bug or get help with an account. It posts to
 * /v1/support (server/accounts/support.ts) and shows the reference the server assigns. Works signed in or out: a
 * player who can't get into their account must still be able to ask.
 */
import { useEffect, useState } from 'react';
import { Modal } from './Modals';
import { Turnstile, turnstileOn } from './Turnstile';
import { fetchMe, sendSupport, type SupportKind } from '../game/account';
import { EDITION_NAME } from '../game/edition';

const KINDS: { id: SupportKind; label: string; hint: string }[] = [
  { id: 'refund', label: 'Refund request', hint: `Tell us the email you bought the ${EDITION_NAME} with and roughly when. One refund per account, within 14 days of the purchase; it goes back to the card you paid with, through Stripe.` },
  { id: 'bug', label: 'Something is broken', hint: 'What you did, what you expected, what happened instead. Phone or computer, and which browser, if you know.' },
  { id: 'account', label: 'Account or sign-in problem', hint: 'The email you use to sign in and what goes wrong (no code arrives, a purchase is missing on another device, and so on).' },
  { id: 'other', label: 'Something else', hint: 'Questions, ideas, anything.' },
];

export function SupportModal({ onClose, page }: { onClose: () => void; page: string }) {
  const [kind, setKind] = useState<SupportKind>('bug');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');   // the honeypot: hidden from people, filled by bots
  const [token, setToken] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { fetchMe().then((m) => { if (m.state === 'signed-in') setSignedIn(true); }); }, []);
  const ready = email.includes('@') && message.trim().length >= 10 && message.length <= 2000 && (!turnstileOn() || !!token) && !busy;
  const send = async () => {
    setBusy(true); setErr(null);
    const r = await sendSupport({ kind, email, message, page, website, turnstile: token ?? undefined });
    setBusy(false);
    if (r.ref) setRef(r.ref); else { setErr(r.error ?? 'Something went wrong. Try again.'); setToken(null); setNonce((n) => n + 1); }
  };
  const current = KINDS.find((k) => k.id === kind)!;
  return (
    <Modal title="Help & refunds" onClose={onClose}>
      {ref ? (
        <div className="acct-form">
          <p className="acct-ok">Sent. Your reference is <b>{ref}</b>.</p>
          <p>You’ll get an answer by email, usually within a day or two. Refunds go back to the card you paid with; the {EDITION_NAME} is removed from the account when the refund is issued.</p>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      ) : (
        <form className="acct-form support" onSubmit={(e) => { e.preventDefault(); if (ready) send(); }}>
          <p className="muted small">Refunds, bugs, sign-in trouble. {signedIn ? 'You’re signed in, so a refund request is matched to your purchase automatically.' : 'If it’s about a purchase, use the email you bought with.'}</p>
          <label>What is it about?
            <select value={kind} onChange={(e) => setKind(e.target.value as SupportKind)}>
              {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </label>
          <label>Your email
            <input type="email" value={email} maxLength={254} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>Message <span className="muted">({message.length}/2000)</span>
            <textarea value={message} maxLength={2000} rows={6} placeholder={current.hint} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <label className="hp" aria-hidden="true">Website<input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
          <Turnstile action="support" onToken={setToken} nonce={nonce} />
          {err && <p className="acct-err">{err}</p>}
          <div className="row">
            <button className="btn primary" type="submit" disabled={!ready}>{busy ? 'Sending…' : 'Send'}</button>
            <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          </div>
          <p className="muted small">We keep the request and your email to answer it, nothing else. No mailing list.</p>
        </form>
      )}
    </Modal>
  );
}
