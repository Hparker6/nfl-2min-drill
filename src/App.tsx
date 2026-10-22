import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeToast } from './ui/Badges';
import { loadStore, saveStore, type Store } from './game/storage';
import { Daily } from './ui/Daily';
import { Survivor } from './ui/Survivor';
import { Practice } from './ui/Practice';
import { accountsShown, EDITION_NAME, EDITION_PRICE, editionShown } from './game/edition';
import { fetchMe } from './game/account';
import { AccountModal, takeAccountHash } from './ui/Account';
import { SupportModal } from './ui/Support';
import { Everyone } from './ui/Everyone';
import { About, Help, SettingsModal, Stats } from './ui/Modals';
import { UpdateBar } from './ui/UpdateBar';
import { AdSlot } from './ui/AdSlot';
import { FEEDBACK_URL, SUPPORT_URL } from './game/site';
import { lazy, Suspense } from 'react';
// career mode is its own chunk: the Daily loads as fast as it did
const CareerMode = lazy(() => import('./ui/career/Career').then((m) => ({ default: m.CareerMode })));
// the Gridiron Challenge (Coach's Edition) too: hidden in production until it can be bought
const Ladder = lazy(() => import('./ui/Ladder').then((m) => ({ default: m.Ladder })));
import { setContext, setPlayerProperties, track } from './game/analytics';
import { audio } from './game/audio';

type Mode = 'daily' | 'survivor' | 'practice' | 'everyone' | 'career' | 'ladder';
const modeFromHash = (): Mode => (location.hash === '#survivor' ? 'survivor' : location.hash === '#practice' ? 'practice' : location.hash === '#everyone' ? 'everyone' : location.hash.startsWith('#career') ? 'career' : location.hash === '#ladder' && editionShown() ? 'ladder' : 'daily');

export default function App() {
  const [store, setStore] = useState<Store>(loadStore);
  const [mode, setMode] = useState<Mode>(modeFromHash);
  // first visit: no modal in the way. The Daily brief carries a short welcome instead.
  const [modal, setModal] = useState<'help' | 'stats' | 'settings' | 'about' | 'account' | 'support' | null>(null);
  // arriving from a sign-in email or back from Stripe opens the account panel (development builds only)
  // read always (a sign-in link can open on a browser that hasn't yet learned accounts are on); open once they show
  const [accountFrom, setAccountFrom] = useState(() => takeAccountHash());
  const [drawn, redraw] = useState(0);
  useEffect(() => { if (accountFrom && accountsShown()) setModal('account'); }, [accountFrom, drawn]);
  // any "get the Coach's Edition" button opens the account panel (EditionLock sends this)
  useEffect(() => { const open = () => setModal('account'); window.addEventListener('4c:account', open); return () => window.removeEventListener('4c:account', open); }, []);
  // what the account owns, asked at start and whenever the tab comes back: a refund made elsewhere shows up here
  useEffect(() => {
    const ask = () => { if (document.visibilityState === 'visible') fetchMe().then(() => redraw((n) => n + 1)); };
    ask();
    document.addEventListener('visibilitychange', ask);
    return () => document.removeEventListener('visibilitychange', ask);
  }, []);
  const [toastMsg, setToast] = useState<string | null>(null);

  // a change runs exactly once, right away: React may run a state updater twice, and the changes here carry side
  // effects (badges announced, analytics, the save itself), so they are applied to the latest store outside of one
  const storeRef = useRef(store);
  const [unsaved, setUnsaved] = useState(false);
  const graduated = useRef(false);
  const update = useCallback((fn: (s: Store) => void) => {
    const next = structuredClone(storeRef.current);
    fn(next);
    // three games in: the full playbook opens on its own (unless the player chose a playbook themselves)
    if (next.settings.simple && !next.settings.simpleChosen && next.history.length >= 3) { next.settings.simple = false; graduated.current = true; }
    storeRef.current = next;
    setUnsaved(!saveStore(next));
    setStore(next);
  }, []);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  // the rookie playbook's "Show the full playbook" link (CallPanel sends this), and the note when it opens by itself
  useEffect(() => {
    const full = () => { update((s) => { s.settings.simple = false; s.settings.simpleChosen = true; }); toast('Full playbook: 27 plays and 19 defenses. Settings brings the rookie one back.'); };
    window.addEventListener('4c:fullplaybook', full);
    return () => window.removeEventListener('4c:fullplaybook', full);
  }, [update, toast]);
  useEffect(() => { if (graduated.current) { graduated.current = false; toast('Three games in: the full playbook is open (27 plays, 19 defenses).'); } });

  // the funnel: which screen, and who (new or returning)
  useEffect(() => { setContext({ mode }); track('screen_view', { mode }); }, [mode]);
  useEffect(() => { setPlayerProperties({ days_played: Object.keys(store.days).length, survivor_runs: store.surv.runs, theme: store.settings.theme }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (modal) track('modal_open', { modal }); }, [modal]);
  useEffect(() => {
    const onHash = () => setMode(modeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // sound: browsers allow audio only after a tap or a key press, so the first one unlocks it
  const soundOn = store.settings.sound !== false, musicOn = store.settings.music !== false;
  useEffect(() => { audio.configure({ sound: soundOn, music: musicOn }); }, [soundOn, musicOn]);
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);
  const anySound = soundOn || musicOn;
  const toggleSound = () => update((s) => { s.settings.sound = !anySound; s.settings.music = !anySound; });

  useEffect(() => {
    const root = document.documentElement;
    if (store.settings.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', store.settings.theme);
  }, [store.settings.theme]);

  const go = (m: Mode) => {
    location.hash = m === 'daily' ? '' : m;
    setMode(m);
    window.scrollTo({ top: 0 });
  };

  const closeModal = useCallback(() => { setModal(null); setAccountFrom(null); }, []);   // a sign-in or purchase hash is used once
  const onboarded = useCallback(() => update((s) => { s.seenHelp = true; }), [update]);

  return (
    <>
      <header className="top">
        <div className="top-in">
          <div className="brand" onClick={() => go('daily')} role="link" aria-label="The 4th Call: today's game" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go('daily')}>
            <span className="brand-mark" aria-hidden><svg viewBox="0 0 64 64" width="20" height="20"><g transform="rotate(-35 32 32)"><ellipse cx="32" cy="32" rx="21" ry="13" fill="currentColor" /><path d="M24 32h16M27.5 28.5v7M32 28.5v7M36.5 28.5v7" stroke="#f5c518" strokeWidth="2.8" strokeLinecap="round" /></g></svg></span>
            <span className="brand-name">The <em>4th</em> Call</span>
          </div>
          <nav className="modes" aria-label="Game modes">
            {(['daily', 'survivor', 'practice', 'career'] as Mode[]).map((m) => (
              <button key={m} className={`${mode === m || (m === 'practice' && mode === 'ladder') ? 'on' : ''}${m === 'career' ? ' new' : ''}`} aria-current={mode === m ? 'page' : undefined} onClick={() => go(m)}>
                {m === 'daily' ? 'Daily' : m === 'survivor' ? 'Survivor' : m === 'practice' ? 'Practice' : 'Career'}
              </button>
            ))}
          </nav>
          <div className="top-r">
            {accountsShown() && <button className="top-edition" onClick={() => setModal('account')} title={`${EDITION_NAME}: ${EDITION_PRICE}, once`} aria-label={EDITION_NAME}><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor" /></svg><span className="te-txt">{EDITION_NAME}</span></button>}
            <button className="icon" onClick={toggleSound} aria-pressed={anySound} aria-label={anySound ? 'Mute sound and music' : 'Turn sound and music on'} title={anySound ? 'Mute' : 'Sound on'}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />{anySound ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}</svg>
            </button>
            <button className="icon" onClick={() => setModal('help')} aria-label="How to play" title="How to play">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6V14M12 17.2v.3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
            </button>
            <button className="icon" onClick={() => setModal('stats')} aria-label="Your stats" title="Your stats">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d="M5 20V11M12 20V4M19 20v-7" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" /></svg>
            </button>
            <button className="icon" onClick={() => setModal('settings')} aria-label="Settings" title="Settings">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d="M10.73 4.71 L11.02 2.45 L12.98 2.45 L13.27 4.71 L16.26 5.95 L18.06 4.56 L19.44 5.94 L18.05 7.74 L19.29 10.73 L21.55 11.02 L21.55 12.98 L19.29 13.27 L18.05 16.26 L19.44 18.06 L18.06 19.44 L16.26 18.05 L13.27 19.29 L12.98 21.55 L11.02 21.55 L10.73 19.29 L7.74 18.05 L5.94 19.44 L4.56 18.06 L5.95 16.26 L4.71 13.27 L2.45 12.98 L2.45 11.02 L4.71 10.73 L5.95 7.74 L4.56 5.94 L5.94 4.56 L7.74 5.95Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" /></svg>
            </button>
          </div>
        </div>
      </header>
      <main className="shell">
        {unsaved && <p className="notice" role="alert">This browser isn't saving your progress (storage is full or blocked). Your games still play, but streaks and results may not be kept.</p>}
        {mode !== 'career' && <h1 className="sr-only">The 4th Call: a free 2-minute drill play-calling game</h1>}   {/* career screens carry their own H1 */}
        {mode === 'daily' && <Daily store={store} update={update} toast={toast} go={go} onboarded={onboarded} openHelp={() => setModal('help')} />}
        {mode === 'survivor' && <Survivor store={store} update={update} toast={toast} />}
        {mode === 'practice' && <Practice store={store} update={update} />}
        {mode === 'ladder' && <Suspense fallback={<div className="cr-busy" />}><Ladder store={store} update={update} /></Suspense>}
        {mode === 'everyone' && <Everyone store={store} go={go} />}
        {mode === 'career' && <Suspense fallback={<div className="cr-busy" />}><CareerMode app={store.settings} /></Suspense>}
      </main>
      <footer className="foot">
        {/* ads only below the page, never during a game (AdSlot renders nothing then, or when ads are off) */}
        <AdSlot />
        <nav className="foot-links" aria-label="About">
          {/* real links, so search engines find the guide, the leaderboard and the stats pages */}
          <a href="/how-to-play/">How to play</a>
          <a href="/leaderboard/">Leaderboard</a>
          <a href="/stats/">Stats</a>
          <button onClick={() => setModal('about')}>About</button>
          <a href="/privacy/">Privacy</a>
          <a href="/terms/">Terms</a>
          {accountsShown() && <button onClick={() => setModal('support')}>Help &amp; refunds</button>}
          {FEEDBACK_URL && <a href={FEEDBACK_URL} target="_blank" rel="noopener">Feedback</a>}
          {SUPPORT_URL && <a href={SUPPORT_URL} target="_blank" rel="noopener">Support the developer</a>}
        </nav>
        {mode !== 'career' && <details className="foot-about">
          {/* what the game is, for a first visit and for search engines (folded away, still in the page); every number here comes from the engine */}
          <summary>What is The 4th Call?</summary>
          <h2 id="foot-about-h" className="sr-only">What is The 4th Call?</h2>
          <p>A free football strategy game in your browser: you call the plays. You're the coach for the end of a close game: run the two-minute drill, go for it on fourth down, protect a lead or make a goal-line stand. Pick every play, manage the clock and your timeouts, and win it. No account, no download, and a new game every day. To start, tap the button above the field and call your first play.</p>
          <h2>Four ways to play</h2>
          <p><b>Daily</b> is one game, the same for everyone, new at midnight UTC, with a <a href="/leaderboard/">leaderboard</a> and a challenge link to send a friend the same game with your score to beat. <b><a href="#survivor" onClick={(e) => { e.preventDefault(); go('survivor'); }}>Survivor</a></b> deals random late-game spots back to back until you lose one. <b><a href="#practice" onClick={(e) => { e.preventDefault(); go('practice'); }}>Practice</a></b> is two-minute drill practice on your terms: build any situation (score, clock, field position, timeouts, weather), play it, and let Coach mode show every option's win chance before you call it. <b><a href="#career" onClick={(e) => { e.preventDefault(); go('career'); }}>Career</a></b> takes a quarterback you create, a pocket passer, scrambler, game manager or gunslinger, through one college game, draft night and a full season in a fictional league.</p>
          <h2>Offense and defense</h2>
          <p>On offense you choose from 27 calls in five tabs (runs, short passes, deep passes, RPOs and trick plays), pick the receiver and his route on the field, and set the tempo: no-huddle, huddle, or milk the clock. When they have the ball you <a href="/how-to-play/#defense">call the defense</a> from 19 coverages and blitzes, from Cover 3 to a corner blitz, and decide when to spend your timeouts. Teams use real NFL rosters with ratings computed from season statistics.</p>
          <h2>What makes it different</h2>
          <p>You call <b>both sides</b>: 19 defenses when they have the ball, not just the offense. Every call is <b>graded against every alternative</b>, so you learn why a call was right, not just whether it worked. The Daily is not always a two-minute drill: it rotates through goal-line stands, fourth-down decisions and protecting a lead. Practice lets you build any spot and see every option's win chance before you call it, and Career turns the same play-calling into a season. Nothing to install and no account, on a phone or a computer.</p>
          <h2>How calls are graded</h2>
          <p>Before each result is shown, the game plays the rest of the game out thousands of times for every option you had and compares your call's win chance with the best one: a <b>great call</b> is within 0.75 points, <b>close</b> within 2.5, <b>costly</b> within 6, and a <b>big miss</b> beyond that. A good call that fails still counts as good. Underneath, The 4th Call is a play-calling simulator: every snap and every grade comes from the same football simulation, so a decision can be judged on what it was worth, not on one bounce of the ball. Your Daily performance score is 55% decisions and 45% result. The <a href="/how-to-play/">how-to-play guide</a> walks through <a href="/how-to-play/#example">a graded drive play by play</a>, the controls, the clock and <a href="/how-to-play/#strategy">how to run a two-minute drill</a>.</p>
        </details>}
        {mode === 'career'
          ? <p className="foot-fine">Career mode is a fictional league: every team, player and college is made up. An independent game, not affiliated with or endorsed by the NFL.</p>
          : <p className="foot-fine">An independent fan game, not affiliated with or endorsed by the NFL, its teams or the NFLPA. Rosters and statistics from nflverse (CC-BY 4.0).</p>}
      </footer>
      {modal === 'help' && <Help onClose={closeModal} />}
      {modal === 'stats' && <Stats store={store} onClose={closeModal} />}
      <BadgeToast />
      {modal === 'settings' && <SettingsModal store={store} update={update} onClose={closeModal} onAccount={accountsShown() ? () => setModal('account') : undefined} />}
      {modal === 'account' && <AccountModal onClose={closeModal} from={accountFrom} onSupport={() => setModal('support')} />}
      {modal === 'support' && <SupportModal onClose={closeModal} page={mode} />}
      {modal === 'about' && <About onClose={closeModal} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      <UpdateBar />
    </>
  );
}
