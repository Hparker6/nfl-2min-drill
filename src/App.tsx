import { useCallback, useEffect, useState } from 'react';
import { loadStore, saveStore, type Store } from './game/storage';
import { Daily } from './ui/Daily';
import { Survivor } from './ui/Survivor';
import { Practice } from './ui/Practice';
import { Everyone } from './ui/Everyone';
import { About, Help, SettingsModal, Stats } from './ui/Modals';
import { setContext, setPlayerProperties, track } from './game/analytics';

type Mode = 'daily' | 'survivor' | 'practice' | 'everyone';
const modeFromHash = (): Mode => (location.hash === '#survivor' ? 'survivor' : location.hash === '#practice' ? 'practice' : location.hash === '#everyone' ? 'everyone' : 'daily');

export default function App() {
  const [store, setStore] = useState<Store>(loadStore);
  const [mode, setMode] = useState<Mode>(modeFromHash);
  // first visit: no modal in the way. The Daily brief carries a short welcome instead.
  const [modal, setModal] = useState<'help' | 'stats' | 'settings' | 'about' | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);

  const update = useCallback((fn: (s: Store) => void) => {
    setStore((prev) => {
      const next = structuredClone(prev);
      fn(next);
      saveStore(next);
      return next;
    });
  }, []);

  const toast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  }, []);

  // the funnel: which screen, and who (new or returning)
  useEffect(() => { setContext({ mode }); track('screen_view', { mode }); }, [mode]);
  useEffect(() => { setPlayerProperties({ days_played: Object.keys(store.days).length, survivor_runs: store.surv.runs, theme: store.settings.theme }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (modal) track('modal_open', { modal }); }, [modal]);
  useEffect(() => {
    const onHash = () => setMode(modeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

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

  const closeModal = useCallback(() => setModal(null), []);
  const onboarded = useCallback(() => update((s) => { s.seenHelp = true; }), [update]);

  return (
    <>
      <header className="top">
        <div className="top-in">
          <div className="brand" onClick={() => go('daily')} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go('daily')}>
            <span className="brand-mark" aria-hidden><svg viewBox="0 0 64 64" width="20" height="20"><g transform="rotate(-35 32 32)"><ellipse cx="32" cy="32" rx="21" ry="13" fill="currentColor" /><path d="M24 32h16M27.5 28.5v7M32 28.5v7M36.5 28.5v7" stroke="#f5c518" strokeWidth="2.8" strokeLinecap="round" /></g></svg></span>
            <span className="brand-name">The <em>4th</em> Call</span>
          </div>
          <nav className="modes" aria-label="Game modes">
            {(['daily', 'survivor', 'practice'] as Mode[]).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} aria-current={mode === m ? 'page' : undefined} onClick={() => go(m)}>
                {m === 'daily' ? 'Daily' : m === 'survivor' ? 'Survivor' : 'Practice'}
              </button>
            ))}
          </nav>
          <div className="top-r">
            <button className="icon" onClick={() => setModal('help')} aria-label="How to play" title="How to play">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6V14M12 17.2v.3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
            </button>
            <button className="icon" onClick={() => setModal('stats')} aria-label="Your stats" title="Your stats">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d="M5 20V11M12 20V4M19 20v-7" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" /></svg>
            </button>
            <button className="icon" onClick={() => setModal('settings')} aria-label="Settings" title="Settings">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
      </header>
      <main className="shell">
        <h1 className="sr-only">The 4th Call: NFL 2-minute drill play-calling game</h1>
        {mode === 'daily' && <Daily store={store} update={update} toast={toast} go={go} onboarded={onboarded} openHelp={() => setModal('help')} />}
        {mode === 'survivor' && <Survivor store={store} update={update} toast={toast} />}
        {mode === 'practice' && <Practice store={store} update={update} />}
        {mode === 'everyone' && <Everyone store={store} go={go} />}
      </main>
      <footer className="foot">
        <nav className="foot-links" aria-label="About">
          <button onClick={() => setModal('help')}>How to play</button>
          <button onClick={() => go('everyone')}>Everyone's stats</button>
          <button onClick={() => setModal('about')}>About &amp; privacy</button>
        </nav>
        <section className="foot-about" aria-labelledby="foot-about-h">
          <h2 id="foot-about-h">Play the NFL 2-minute drill</h2>
          <p>The 4th Call is a free NFL 2 min drill game that puts you on the sideline for the end of a close game: run the two-minute drill, go for it on fourth down, protect a lead or make a goal-line stand. Call every play, manage the clock and your timeouts, and call the defense when they have the ball. Teams use real NFL rosters and season stats, and every call is graded against every option you had by playing the rest of the game out thousands of times. Free in your browser, no sign-up, a new game every day.</p>
        </section>
        <p>An independent fan game, not affiliated with or endorsed by the NFL, its teams or the NFLPA. Rosters and statistics from nflverse (CC-BY 4.0); ratings and outcomes are this game's own estimates from a simplified simulation.</p>
      </footer>
      {modal === 'help' && <Help onClose={closeModal} />}
      {modal === 'stats' && <Stats store={store} onClose={closeModal} />}
      {modal === 'settings' && <SettingsModal store={store} update={update} onClose={closeModal} />}
      {modal === 'about' && <About onClose={closeModal} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </>
  );
}
