import { useEffect, useState } from 'react';
import { CALL, LOOK_READ, LOOKS, POS_NAME, ROUTES } from '../engine/data';
import { tendency } from '../game/describe';
import type { Decision, Opt } from '../game/session';
import { GRADE_INFO, type Grade } from '../game/grade';
import type { Look, Rcv, RouteId, State, TeamInfo } from '../engine/types';
import { MiniPlay } from './MiniPlay';

interface Props {
  dec: Decision;
  s: State;
  teams: [TeamInfo, TeamInfo];
  selected: Opt | null;
  target: Rcv | null;
  route: RouteId | null;
  hints: Map<string, number> | null;     // practice: win chance per option
  prev: { label: string; g: Grade } | null; // the clock call just made, graded
  onSelect: (o: Opt) => void;
  onSnap: (o: Opt) => void;
}

/** The playbook in five tabs, so no list runs long. Passing is split by depth. */
type Tab = 'run' | 'short' | 'deep' | 'rpo' | 'trick';
const SHORT = new Set(['quick_out', 'slants', 'screen', 'mesh', 'boot']);
const TABS: { id: Tab; label: string; key: string; fam: string; blurb: string }[] = [
  { id: 'run', label: 'Run', key: 'r', fam: 'run', blurb: 'Runs: hand it off. The clock keeps moving unless he gets out of bounds.' },
  { id: 'short', label: 'Short Pass', key: 's', fam: 'pass', blurb: 'Short passes: quick, high-percentage throws.' },
  { id: 'deep', label: 'Deep Pass', key: 'd', fam: 'pass', blurb: 'Deep passes: chunk plays downfield, with more sacks and interceptions.' },
  { id: 'rpo', label: 'RPO', key: 'o', fam: 'rpo', blurb: 'Run-pass option: the quarterback reads the defense after the snap.' },
  { id: 'trick', label: 'Trick', key: 't', fam: 'trick', blurb: 'Misdirection. Big upside, big risk.' },
];
const tabOf = (o: Opt): Tab | null => (o.group === 'pass' ? (SHORT.has(o.key) ? 'short' : 'deep') : o.group === 'run' || o.group === 'rpo' || o.group === 'trick' ? o.group : null);
// decisions that cost something you cannot get back: marked so they are not tapped by accident
const MAJOR = new Set(['timeout', 'spike', 'kneel', 'drain', 'onside', 'two', 'block', 'rush', 'fg', 'punt']);
const RISK = ['', 'Safe', 'Balanced', 'Risky'];

/** A tapped row that is partly hidden (under the Snap bar on phones, at the list's edge on desktop) scrolls fully into view. */
function keepClear(el: HTMLElement) {
  if (typeof matchMedia !== 'function') return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }));
}

function hintClass(wp: number | undefined, best: number) {
  if (wp == null) return '';
  const lost = (best - wp) * 100;
  return lost <= 0.75 ? 'h-g' : lost <= 2.5 ? 'h-y' : lost <= 6 ? 'h-o' : 'h-r';
}

function Prev({ prev }: { prev: Props['prev'] }) {
  if (!prev) return null;
  const g = prev.g;
  return (
    <div className={`prev g-${g.g}`}>
      <span className="grade-dot">{GRADE_INFO[g.g].glyph}</span>
      <span>{GRADE_INFO[g.g].word}: <b>{prev.label}</b>{g.lost >= 0.05 && g.g !== 'g' ? ` · better was ${g.bestLabel} (+${g.lost.toFixed(1)})` : ''}</span>
    </div>
  );
}

export function CallPanel({ dec, s, teams, selected, target, route, hints, prev, onSelect, onSnap }: Props) {
  const isPlay = dec.step === 'play';
  const [tab, setTab] = useState<Tab>('short');
  const specials = dec.options.filter((o) => o.group === 'special');
  const best = hints ? Math.max(...hints.values()) : 0;

  useEffect(() => { if (isPlay) setTab('short'); }, [dec, isPlay]);

  const list = isPlay ? dec.options.filter((o) => tabOf(o) === tab) : dec.options;
  // keys: 1-9 the list, then the special-teams buttons; R S D O T switch tabs; Enter snaps the selected call
  const keyed = isPlay ? [...list, ...specials] : list;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const n = Number(e.key);
      if (n >= 1 && n <= keyed.length) {
        e.preventDefault();
        const o = keyed[n - 1];
        if (isPlay || dec.step === 'look') onSelect(o); else onSnap(o);
      } else if ((isPlay || dec.step === 'look') && e.key === 'Enter' && selected) {
        e.preventDefault();
        onSnap(selected);
      } else if (isPlay) {
        const t = TABS.find((x) => x.key === e.key.toLowerCase());
        if (t) setTab(t.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (dec.step === 'look') {
    const look = selected?.choice.look;
    const info = look ? LOOKS[look] : null;
    return (
      <section className="cp def" aria-label="Call the defense">
        <Prev prev={prev} />
        <header className="cp-head">
          <span className="def-flag">Defense · your call</span>
          <h2>{dec.title}</h2>
          <div className="read tend"><b>Their offense:</b> {tendency(s)}</div>
        </header>
        <div className="cp-list" role="listbox" aria-label="Defensive calls">
          {dec.options.map((o, i) => {
            const wp = hints?.get(o.key);
            const sel = selected?.key === o.key;
            const L = LOOKS[o.choice.look!];
            return (
              <button key={o.key} role="option" aria-selected={sel} className={`prow fam-def${sel ? ' sel' : ''} ${hintClass(wp, best)}`} onClick={(e) => { onSelect(o); keepClear(e.currentTarget); }}>
                <MiniPlay look={o.choice.look} />
                <span className="prow-txt">
                  <span className="prow-name"><kbd>{i + 1}</kbd>{o.label}</span>
                  <span className="prow-sub">{o.sub}</span>
                  {sel && <span className="def-trade in-row"><span><b>Stops:</b> {L.stops}</span><span><b>Gives up:</b> {L.risk}</span></span>}
                </span>
                <span className="prow-side">
                  {wp != null ? <span className="opt-wp">{(wp * 100).toFixed(1)}%</span> : <span className={`riskchip r${L.tilt}`}>{['', 'Safe', 'Trade-off', 'Gamble'][L.tilt]}</span>}
                </span>
              </button>
            );
          })}
        </div>
        {info && <div className="def-trade strip"><span><b>Stops:</b> {info.stops}</span><span><b>Gives up:</b> {info.risk}</span></div>}
        <footer className={`cp-foot${selected ? ' ready' : ''}`}>
          <div className="cp-sel">
            {info ? (
              <>
                <span className="cp-sel-k">Your defense</span>
                <span className="cp-sel-name">{info.label}</span>
              </>
            ) : <span className="cp-sel-sub">Pick a defense to see it on the field.<span className="keys"> Keys: 1–{dec.options.length} pick · Enter calls it</span></span>}
          </div>
          <button className="btn snap" disabled={!selected} onClick={() => selected && onSnap(selected)}>Call it<kbd>Enter</kbd></button>
        </footer>
      </section>
    );
  }

  if (!isPlay) {
    // clock, kicks, tries: each button is the whole decision, one tap
    const isLook = false;
    return (
      <section className="cp" aria-label="Your decision">
        <Prev prev={prev} />
        <header className="cp-head">
          <h2>{dec.title}</h2>
          {isLook && <p className="cp-note">{teams[1].city} has the ball and their play is called. Pick your defense.</p>}
          {dec.step === 'offClock' && <p className="cp-note">The clock is still running. How fast do you get to the next snap?</p>}
          {dec.step === 'defClock' && <p className="cp-note">They are letting the clock run.</p>}
        </header>
        <div className={`cp-grid${isLook ? ' looks' : ''}`}>
          {dec.options.map((o, i) => {
            const wp = hints?.get(o.key);
            return (
              <button key={o.key} className={`dbtn${MAJOR.has(o.key) ? ' major' : ''} ${hintClass(wp, best)}`} onClick={() => onSnap(o)}>
                {isLook && <MiniPlay look={o.key as Look} />}
                <span className="dbtn-txt">
                  <span className="dbtn-name"><kbd>{i + 1}</kbd>{o.label}</span>
                  {o.sub && <span className="dbtn-sub">{o.sub}</span>}
                </span>
                {wp != null && <span className="opt-wp">{(wp * 100).toFixed(1)}%</span>}
              </button>
            );
          })}
        </div>
        <p className="cp-keys keys">Press 1–{dec.options.length} to choose</p>
      </section>
    );
  }

  const row = (o: Opt, i: number) => {
    const wp = hints?.get(o.key);
    const sel = selected?.key === o.key;
    return (
      <button key={o.key} role="option" aria-selected={sel} className={`prow fam-${o.group}${sel ? ' sel' : ''} ${hintClass(wp, best)}`} onClick={(e) => { onSelect(o); keepClear(e.currentTarget); }}>
        <MiniPlay play={o.choice.play} />
        <span className="prow-txt">
          <span className="prow-name"><kbd>{i + 1}</kbd>{o.label}</span>
          <span className="prow-sub">{o.sub}</span>
        </span>
        <span className="prow-side">
          {wp != null ? <span className="opt-wp">{(wp * 100).toFixed(1)}%</span> : o.risk ? <span className={`riskchip r${o.risk}`}>{RISK[o.risk]}</span> : null}
        </span>
      </button>
    );
  };

  const call = selected?.choice.play ? CALL[selected.choice.play] : null;
  const isPass = !!call?.routes && call.kind === 'pass' && call.id !== 'hail';
  const tgt = (target ?? call?.tgt) as Rcv | undefined;
  const rt = isPass && tgt ? route ?? call!.routes![tgt] : null;
  const fourth = s.down === 4;
  const T = TABS.find((x) => x.id === tab)!;

  const specialRow = specials.length > 0 && (
    <div className={`cp-special${fourth ? ' urgent' : ''}`}>
      <span className="cp-special-k">{fourth ? `4th & ${s.dist >= 100 - s.yl ? 'goal' : s.dist}: kick it here, or pick a play to go for it` : 'Also available'}</span>
      <div className="cp-special-btns">
        {specials.map((o, j) => {
          const wp = hints?.get(o.key);
          const sel = selected?.key === o.key;
          return (
            <button key={o.key} className={`sbtn${sel ? ' sel' : ''} ${hintClass(wp, best)}`} onClick={() => onSelect(o)} aria-pressed={sel}>
              <MiniPlay play={o.key} />
              <span><span className="sbtn-name"><kbd>{list.length + j + 1}</kbd>{o.label}</span><span className="sbtn-sub">{o.sub}</span></span>
              {wp != null && <span className="opt-wp">{(wp * 100).toFixed(1)}%</span>}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <section className="cp" aria-label="Call the play">
      <Prev prev={prev} />
      <header className="cp-head">
        <h2>{dec.title}</h2>
        {s.shownLook && (
          <div className="read" title="Your pre-snap read is right about 7 times in 10">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>
            <span><b>Defense:</b> {LOOK_READ[s.shownLook]}</span>
          </div>
        )}
      </header>
      {fourth && specialRow}
      <div className="tabs5" role="tablist" aria-label="Kinds of plays">
        {TABS.map((t) => {
          const n = dec.options.filter((o) => tabOf(o) === t.id).length;
          return (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab5 fam-${t.fam}${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)} title={t.blurb}>
              <span className="tab5-name"><i />{t.label}</span>
              <span className="tab5-n">{n} play{n === 1 ? '' : 's'}</span>
            </button>
          );
        })}
      </div>
      <p className="tab5-blurb">{T.blurb}</p>
      <div className="cp-list" role="listbox" aria-label={`${T.label} calls`}>{list.map(row)}</div>
      {!fourth && specialRow}
      <footer className={`cp-foot${selected ? ' ready' : ''}`}>
        <div className="cp-sel">
          {selected ? (
            <>
              <span className="cp-sel-k">Selected</span>
              <span className="cp-sel-mini"><MiniPlay play={selected.choice.play} /></span>
              <span className="cp-sel-name">{selected.label}</span>
              {isPass && tgt && rt ? (
                <span className="cp-sel-sub">
                  To <b>{teams[0].players[tgt]?.name.split(' ').slice(-1)[0]}</b> ({POS_NAME[tgt].toLowerCase()}) on a {ROUTES[rt].name.toLowerCase()}.
                  <span className="cp-tip"> Tap another receiver on the field to throw to him; tap him again to change his route.</span>
                </span>
              ) : <span className="cp-sel-sub">{selected.sub}</span>}
            </>
          ) : <span className="cp-sel-sub">Pick a play to see it on the field.<span className="keys"> Keys: 1–9 pick · R S D O T tabs · Enter snaps</span></span>}
        </div>
        <button className="btn snap" disabled={!selected} onClick={() => selected && onSnap(selected)}>Snap<kbd>Enter</kbd></button>
      </footer>
    </section>
  );
}
