/**
 * The account panel (development builds only, like the rest of the Coach's Edition): sign in by email, see what you
 * own, buy the edition in Stripe's test mode, sign out, delete the account. It opens by itself when the page is
 * reached from a sign-in email (#signin=…), back from Stripe (#purchase=…), or back from a cancelled checkout (#account).
 */
import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modals';
import {
  checkoutStatus, COACH_EDITION, deleteAccount, fetchMe, requestSignIn, signOut, startCheckout, verify, type Me,
} from '../game/account';
import { EDITION_NAME, EDITION_PRICE } from '../game/edition';

/** What the address bar brought: a sign-in link's token, a checkout to confirm, or a return from a cancelled checkout. Read once, then cleared. */
export function takeAccountHash(): { token?: string; purchase?: string } | null {
  const h = location.hash;
  const m = h.match(/^#signin=([A-Za-z0-9_-]{43})$/) ?? null;
  const p = h.match(/^#purchase=(cs_(?:test|live)_[A-Za-z0-9]{10,200})$/) ?? null;
  const back = h === '#account';   // Stripe's cancel page sends people back here
  if (!m && !p && !back) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return m ? { token: m[1] } : p ? { purchase: p[1] } : {};
}

export function AccountModal({ onClose, from }: { onClose: () => void; from?: { token?: string; purchase?: string } | null }) {
  const [me, setMe] = useState<Me | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => fetchMe().then(setMe);
  useEffect(() => { refresh(); }, []);

  return (
    <Modal title="Account" onClose={onClose}>
      <p className="acct-dev">Preview: accounts and purchases are in development and not live. Payments run in Stripe’s test mode only.</p>
      {msg && <p className="acct-msg" role="status">{msg}</p>}
      {from?.token && me?.state === 'signed-out' && <FinishSignIn token={from.token} onDone={(e) => { setMsg(e); refresh(); }} />}
      {from?.purchase && me?.state === 'signed-in' && <ConfirmPurchase sessionId={from.purchase} onOwned={refresh} />}
      {!me && <p className="muted">Checking…</p>}
      {me?.state === 'off' && <p className="muted">Accounts aren’t switched on for this server.</p>}
      {me?.state === 'unreachable' && <p className="muted">The account server isn’t reachable. In development, run <code>wrangler dev --env dev</code> and start Vite with <code>DEV_API=http://localhost:8787</code>.</p>}
      {me?.state === 'signed-out' && !from?.token && <SignIn onSignedIn={() => { setMsg(null); refresh(); }} />}
      {me?.state === 'signed-in' && (
        <SignedIn me={me} busy={busy} setBusy={setBusy} setMsg={setMsg} refresh={refresh} onClose={onClose} />
      )}
    </Modal>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async () => { setBusy(true); setErr(null); const e = await requestSignIn(email); setBusy(false); if (e) setErr(e); else setSent(true); };
  const useCode = async () => { setBusy(true); setErr(null); const e = await verify({ email, code: code.trim() }); setBusy(false); if (e) setErr(e); else onSignedIn(); };
  return (
    <div className="acct-form">
      <p>Sign in with your email: no password. An account lets a purchase follow you to other devices. (Saved games stay in each browser.)</p>
      <label><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent} /></label>
      {!sent ? <button className="btn primary" disabled={busy || !email.includes('@')} onClick={ask}>Email me a sign-in link</button> : (
        <>
          <p className="muted small">If that address can sign in, a link and a 6-digit code are on their way. They work once, for 15 minutes.</p>
          <label><span>Code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></label>
          <div className="row">
            <button className="btn primary" disabled={busy || code.length !== 6} onClick={useCode}>Sign in</button>
            <button className="btn ghost" onClick={() => { setSent(false); setCode(''); }}>Use another email</button>
          </div>
        </>
      )}
      {err && <p className="acct-err" role="alert">{err}</p>}
    </div>
  );
}

/** From the emailed link: a button, so a mail scanner opening the link can't use it up. */
function FinishSignIn({ token, onDone }: { token: string; onDone: (msg: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => { setBusy(true); const e = await verify({ token }); setBusy(false); if (e) setErr(e); else onDone('You’re signed in.'); };
  return (
    <div className="acct-form">
      <p>Finish signing in on this browser?</p>
      <button className="btn primary" disabled={busy} onClick={go}>Sign in</button>
      {err && <p className="acct-err" role="alert">{err}</p>}
    </div>
  );
}

/** Back from Stripe: ask our server (not the address bar) until the payment is confirmed by Stripe's webhook. */
function ConfirmPurchase({ sessionId, onOwned }: { sessionId: string; onOwned: () => void }) {
  const [state, setState] = useState<'checking' | 'owned' | 'waiting'>('checking');
  const tries = useRef(0);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const s = await checkoutStatus(sessionId);
      if (stop) return;
      if (s?.owns) { setState('owned'); onOwned(); return; }
      if (++tries.current >= 15) { setState('waiting'); return; }
      setTimeout(tick, 2000);
    };
    tick();
    return () => { stop = true; };
  }, [sessionId]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (state === 'owned') return <p className="acct-ok">Payment confirmed: the {EDITION_NAME} is yours. <button className="btn small" onClick={() => location.reload()}>Unlock it now</button></p>;
  if (state === 'waiting') return <p className="muted">Stripe hasn’t confirmed the payment yet. That can take a minute; it shows here as soon as it does.</p>;
  return <p className="muted">Confirming your payment with Stripe…</p>;
}

function SignedIn({ me, busy, setBusy, setMsg, refresh, onClose }: {
  me: Extract<Me, { state: 'signed-in' }>; busy: boolean; setBusy: (b: boolean) => void; setMsg: (m: string | null) => void; refresh: () => void; onClose: () => void;
}) {
  const owns = me.owns.includes(COACH_EDITION);
  const [del, setDel] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const buy = async () => {
    setBusy(true); setMsg(null);
    const r = await startCheckout();
    setBusy(false);
    if (r.url) location.assign(r.url); else setMsg(r.error ?? 'Checkout could not be started.');
  };
  return (
    <div className="acct-form">
      <p>Signed in as <b>{me.email}</b>.</p>
      <p>{EDITION_NAME}: {owns ? <b className="acct-ok">owned</b> : 'not owned'}</p>
      {!owns && me.payments === 'test' && <button className="btn primary" disabled={busy} onClick={buy}>Buy the {EDITION_NAME}: {EDITION_PRICE} (test mode)</button>}
      {!owns && me.payments === 'off' && <p className="muted small">Purchases aren’t open.</p>}
      <p className="muted small">Bought it on another device? Signing in with the same email restores it here.</p>
      <div className="row">
        <button className="btn" disabled={busy} onClick={async () => { await signOut(); setMsg('Signed out.'); refresh(); }}>Sign out</button>
        <button className="btn" disabled={busy} onClick={async () => { await signOut(true); setMsg('Signed out on every device.'); refresh(); }}>Sign out everywhere</button>
      </div>
      {!del ? <button className="btn danger" onClick={() => setDel(true)}>Delete my account</button> : (
        <div className="acct-del">
          <p>This deletes your account: your email address, sign-ins and {owns ? <b>your {EDITION_NAME}</b> : 'anything you own'}. A purchase record stays with Stripe and in our sales records, without your email. Type your email address to confirm.</p>
          <input type="email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} aria-label="Your email address" />
          <div className="row">
            <button className="btn danger" disabled={busy || !confirmEmail} onClick={async () => {
              setBusy(true);
              const e = await deleteAccount(confirmEmail);
              setBusy(false);
              if (e) setMsg(e); else { setMsg('Your account is deleted.'); refresh(); setTimeout(onClose, 1500); }
            }}>Delete it</button>
            <button className="btn ghost" onClick={() => setDel(false)}>Keep it</button>
          </div>
        </div>
      )}
    </div>
  );
}
