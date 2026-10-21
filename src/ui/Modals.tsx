import { useEffect, useRef, type ReactNode } from 'react';
import { BadgeCase } from './Badges';
import { LOOKS_FIELD, type FieldLook } from '../game/badges';
import { NFL_SEASON } from '../engine/nfl';
import { ARCHETYPES } from '../engine/data';
import { SPOTS_PER_DAY, utcDate } from '../engine/scenario';
import { GRADE_INFO, type GradeKey } from '../game/grade';
import { archetype } from '../game/share';
import { rateSpots } from '../game/rating';
import { bestStreak, defaultStore, streak, type Settings, type Store } from '../game/storage';
import { editionShown } from '../game/edition';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <p><b>You're the play-caller at the end of a close game.</b> Each spot drops you into the fourth quarter with the score, the clock, the timeouts and 22 players on the field. Win the game.</p>
      <ul>
        <li><b>On offense</b>, pick from 27 calls in four families: Run, Pass, RPO and Trick. Field goals, punts and kneel-downs show up when they matter. On a pass, tap a receiver on the field to throw to him, and tap him again to change his route.</li>
        <li><b>The clock is yours too.</b> When it's running, the tempo starts on the usual choice, marked <b>Auto</b> (no-huddle when you're behind or under two minutes, milk it with the lead). Change it, or tap Timeout, Spike or Kneel instead.</li>
        <li><b>On defense</b>, pick from four tabs: Zone, Man, Blitz and Goal Line, with four or five plays each, from Cover 2 to a corner blitz. Each one stops something and gives something up. Then decide when to burn your timeouts.</li>
        <li><b>Read the defense.</b> Before each snap you get a pre-snap read. It's right about 7 times in 10.</li>
      </ul>
      <h3>How calls are graded</h3>
      <p>Before the result is shown, the game plays out the rest of the game thousands of times for <i>every</i> option you had, and compares your call's win chance with the best one:</p>
      <ul className="grades">
        {(['g', 'y', 'o', 'r'] as GradeKey[]).map((g) => (
          <li key={g}><span className={`grade-dot g-${g}`}>{GRADE_INFO[g].glyph}</span> <b>{GRADE_INFO[g].word}</b> {{ g: 'best call, or within 0.75 points', y: 'within 2.5 points', o: 'within 6 points', r: 'more than 6 points off' }[g]}</li>
        ))}
      </ul>
      <p>A good call that fails still counts as good, and a bad call that works still counts as bad. You also see what an AI coach would have called, and how much win chance that would have cost.</p>
      <h3>Your rating</h3>
      <ul>
        <li><b>Call grade</b> (each play): 100, minus 7 for every point of win chance your call gave up against the best one.</li>
        <li><b>Decisions</b> (each game): falls with the total win chance you gave up over the whole game, so one costly call counts in full.</li>
        <li><b>Result</b> (each game): a win scores 75–100, a loss 0–25; the harder the spot, the higher inside its band.</li>
        <li><b>Performance</b> = 55% Decisions + 45% Result. A loss can't score above 66; good calls in a loss still show in Decisions.</li>
      </ul>
      <h3>Modes</h3>
      <ul>
        <li><b>Daily:</b> one game a day, the same for everyone, new at midnight UTC. The situation changes every day: a two-minute drill, a goal-line stand, a fourth-down call…</li>
        <li><b>Survivor:</b> random spots back to back. Win to keep going; one loss ends the run.</li>
        <li><b>Practice:</b> build any spot and play it out with Coach mode, which shows the win chance of every option before you call it.</li>
      </ul>
      <p className="muted small">Real rosters (nflverse, season {NFL_SEASON}); made-up situations. Player ratings are this game's estimates from season statistics. Outcomes come from a simplified football simulation; win chances and grades are its estimates, not official evaluations or real-world probabilities.</p>
    </Modal>
  );
}

export function About({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About & privacy" onClose={onClose}>
      <p><b>The 4th Call</b> is an independent fan game about late-game play-calling. The teams and players are real; the game situations are made up.</p>
      <h3>Where the data comes from</h3>
      <p>Rosters (names, jersey numbers, positions), depth charts, injury reports and player statistics come from <b>nflverse</b> (nflverse-data, CC-BY 4.0), season {NFL_SEASON}. Each team fields its healthy starters: a star who is hurt still starts here. Ratings use this season's statistics and last season's. Every player's 0–100 ratings are computed by this game from those statistics (the formula is in the open build script); linemen, kickers and low-snap players are marked <i>estimated</i>. They are game ratings, not official measurements and not any other game's ratings.</p>
      <h3>About the grades</h3>
      <p>Plays are resolved by a simplified football simulation written for this game. Win chances and grades are that simulation's estimates: useful for comparing your options, but not official evaluations, real coaching grades or real-world probabilities.</p>
      <h3>Your data</h3>
      <ul>
        <li>Your progress, streaks, stats, careers and settings are stored in this browser (localStorage), not on a server. Clearing your browser data, or <i>Settings → Erase my data</i>, removes them.</li>
        <li>The daily leaderboard: when you post a score, our server receives the nickname you chose, your score, your call grades, whether you won and a random code this browser made up (so a second post replaces the first). To limit posts, your IP address is counted for that day as a one-way hash; the address itself isn’t kept.</li>
        <li>Fonts are loaded from Google Fonts. Cloudflare, which hosts the site, measures visits with its web analytics. If the site owner turns on Google Analytics, gameplay events are sent to it (for example, that a game started or a result was shared), never names or contact details.</li>
      </ul>
      {editionShown() && <AccountsPrivacy />}
      <h3>No affiliation</h3>
      <p>Not affiliated with, endorsed by or connected to the NFL, any of its teams, or the NFL Players Association. Team and player names are used to identify real teams and players; no logos or marks are used.</p>
    </Modal>
  );
}

export function Stats({ store, onClose }: { store: Store; onClose: () => void }) {
  const h = store.history.filter((r) => r.mode !== 'practice');
  const wins = h.filter((r) => r.win).length;
  const grades = h.flatMap((r) => r.grades);
  const count = (g: GradeKey) => grades.filter((x) => x === g).length;
  const max = Math.max(1, ...(['g', 'y', 'o', 'r'] as GradeKey[]).map(count));
  const arch = h.length ? ARCHETYPES[archetype(h.flatMap((r) => r.tags))] : null;
  const days = Object.values(store.days).filter((d) => d.spots.length >= SPOTS_PER_DAY).length;
  const beat = h.reduce((a, r) => a + r.aiLost - r.lost, 0);
  return (
    <Modal title="Your stats" onClose={onClose}>
      {!h.length ? <p>No games yet. Play today's daily to get started.</p> : (
        <>
          <div className="stat-grid">
            <div><b>{h.length}</b><span>games</span></div>
            <div><b>{Math.round((wins / h.length) * 100)}%</b><span>won</span></div>
            <div><b>{rateSpots(h).performance}</b><span>performance</span></div>
            <div><b>{rateSpots(h).decisions}</b><span>decisions</span></div>
            <div><b>{grades.length}</b><span>calls</span></div>
            <div><b>{streak(store, utcDate(), SPOTS_PER_DAY)}</b><span>daily streak</span></div>
            <div><b>{bestStreak(store, SPOTS_PER_DAY)}</b><span>best streak</span></div>
            <div><b>{days}</b><span>dailies done</span></div>
            <div><b>{store.surv.best}</b><span>survivor best</span></div>
          </div>
          <p><button className="link" onClick={() => { onClose(); location.hash = 'everyone'; }}>Everyone's daily stats ›</button></p>
      <h3>Call grades</h3>
          <div className="bars">
            {(['g', 'y', 'o', 'r'] as GradeKey[]).map((g) => (
              <div key={g} className="bar-row">
                <span className="bar-k">{GRADE_INFO[g].word}</span>
                <span className={`bar g-${g}`} style={{ width: `${(count(g) / max) * 100}%` }} />
                <span className="bar-n">{count(g)}</span>
              </div>
            ))}
          </div>
          <p className="small">{beat >= 0 ? `Across all games you've beaten the AI coach by ${beat.toFixed(1)} points of win chance.` : `The AI coach leads you by ${(-beat).toFixed(1)} points of win chance overall.`}</p>
          {arch && <div className="arch"><div className="k">You call it like</div><div className="arch-name">{arch.name}</div><div className="muted small">{arch.blurb}</div></div>}
        </>
      )}
      <BadgeCase store={store} />
    </Modal>
  );
}

export function SettingsModal({ store, update, onClose, onAccount }: { store: Store; update: (fn: (s: Store) => void) => void; onClose: () => void; onAccount?: () => void }) {
  const st = store.settings;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => update((s) => { s.settings[k] = v; });
  const reset = () => {
    if (!confirm('Erase all your games, streaks and settings on this device?')) return;
    update((s) => { Object.assign(s, defaultStore()); });
    onClose();
  };
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="form">
        <label>Theme
          <select value={st.theme} onChange={(e) => set('theme', e.target.value as Settings['theme'])}>
            <option value="auto">Match my device</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <label>Play speed
          <select value={st.speed} onChange={(e) => set('speed', e.target.value as Settings['speed'])}>
            <option value="normal">Real time</option>
            <option value="fast">Fast</option>
            <option value="instant">Skip animations</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={st.autoNext !== false} onChange={(e) => set('autoNext', e.target.checked)} /> Go on to the next play by itself (tap the result to pause)</label>
        <label className="check"><input type="checkbox" checked={st.simple === true} onChange={(e) => update((x) => { x.settings.simple = e.target.checked; x.settings.simpleChosen = true; })} /> Rookie playbook: six plays, four defenses, the extras hidden</label>
        <label className="check"><input type="checkbox" checked={st.hints} onChange={(e) => set('hints', e.target.checked)} /> Coach mode in Practice (show win chances before you call)</label>
        <label className="check"><input type="checkbox" checked={st.sound !== false} onChange={(e) => set('sound', e.target.checked)} /> Sound effects</label>
        <label className="check"><input type="checkbox" checked={st.music !== false} onChange={(e) => set('music', e.target.checked)} /> Background music</label>
        <label className="check"><input type="checkbox" checked={st.haptics !== false} onChange={(e) => set('haptics', e.target.checked)} /> Vibration on big plays (phones)</label>
        <label className="field-look"><span>Field look</span>
          <select value={st.fieldLook ?? 'classic'} onChange={(e) => set('fieldLook', e.target.value as FieldLook)}>
            {LOOKS_FIELD.map((l) => { const open = Object.keys(store.badges ?? {}).length >= l.need; return <option key={l.id} value={l.id} disabled={!open}>{l.name}{open ? '' : ` (${l.need} badges)`}</option>; })}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={!st.plainDots} onChange={(e) => set('plainDots', !e.target.checked)} /> Color players by rating (red to green)</label>
      </div>
      {onAccount && <p><button className="btn" onClick={onAccount}>Account (preview)</button></p>}
      <button className="btn danger" onClick={reset}>Erase my data</button>
    </Modal>
  );
}

/**
 * What accounts and purchases would collect. Shown only where the Coach's Edition is (development builds), because
 * neither exists on the live site yet. Keep it in step with server/accounts and server/db/migrations.
 */
function AccountsPrivacy() {
  return (
    <>
      <h3>Accounts and purchases (in development, not live)</h3>
      <ul>
        <li>Signing in is optional and uses your email address, no password. We store your address, when the account was made, your signed-in sessions and recent sign-in requests. Sign-in links, codes and session keys are stored only as one-way hashes, and requests are deleted about a day after they expire. A cookie keeps you signed in on this browser; it ends after 30 days without use, or 180 days at most.</li>
        <li>Sign-in emails would be sent through an email service (not chosen yet), which receives your address to deliver them.</li>
        <li>Purchases are paid on Stripe’s own checkout page. We never see or store card details. We keep a record of each purchase (product, amount, date, Stripe’s reference numbers and whether it was refunded or disputed) and what it unlocks. Stripe keeps its own records under its own privacy policy.</li>
        <li>Deleting your account (Account → Delete) removes your email address, sessions, sign-in requests and what you own. Purchase records are kept without your email, for refunds, disputes and accounting.</li>
        <li>Game progress stays in your browser either way: an account restores a purchase on another device, not your saved games.</li>
        <li>The Coach’s Edition is a one-time purchase for one account, delivered instantly. Refunds aren’t owed on a digital purchase, but one purchase per account is refunded on request within 14 days through Help &amp; refunds; a purchase after a refund is final. A chargeback removes the edition and closes purchases for that account. The full <a href="/terms/">terms</a> are short.</li>
      </ul>
    </>
  );
}
