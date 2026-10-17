import { useEffect, useState } from 'react';
import { CALL, LOOK_READ, LOOK_USE, LOOKS, POS_NAME, ROUTES, TEMPO } from '../engine/data';
import { DEF_PLAYS, famOf, type DefCat } from '../engine/defense';
import { DESIGN, type FormationId } from '../engine/formation';
import { WEATHER } from '../engine/sim';
import { SHORT_PASSES as SHORT, tendency } from '../game/describe';
import type { Decision, Opt } from '../game/session';
import { GRADE_INFO, type Grade } from '../game/grade';
import type { Look, LookFam, PassMods, Rcv, RouteId, State, TeamInfo } from '../engine/types';
import { MiniPlay } from './MiniPlay';

/** What the play-caller changed about the selected call: the side, the receiver, the routes, the quarterback's action. */
export interface Edits {
  target: Rcv | null;
  routes: Partial<Record<Rcv, RouteId>>;
  side: 1 | -1;
  mods: PassMods;
}
export const NO_EDITS: Edits = { target: null, routes: {}, side: 1, mods: {} };

interface Props {
  dec: Decision;                            // the call on the board: play / look / st / pat / kick, or a clock-only step
  clock: Decision | null;                   // the clock decision that goes with it (tempo on offense, timeout on defense)
  clockSel: Opt | null;
  s: State;
  teams: [TeamInfo, TeamInfo];
  selected: Opt | null;
  edits: Edits;
  hints: Map<string, number> | null;        // practice: win chance per option
  clockHints: Map<string, number> | null;
  prev: { label: string; g: Grade } | null; // the last complete decision, graded
  autoTempo?: string;                       // the tempo the game picked for you (marked Auto, with the reason)
  onClock: (o: Opt) => void;                // pick a tempo (or let it run): part of this snap
  onMajor: (o: Opt) => void;                // timeout, spike, kneel, run it down: the whole decision, one tap
  onSelect: (o: Opt) => void;
  onEdit: (e: Edits) => void;
  onSnap: (o: Opt) => void;
}

/** The playbook in five tabs, so no list runs long. Passing is split by depth. */
type Tab = 'run' | 'short' | 'deep' | 'rpo' | 'trick';
const TABS: { id: Tab; label: string; short: string; key: string; fam: string; blurb: string }[] = [
  { id: 'run', label: 'Run', short: 'Run', key: 'r', fam: 'run', blurb: 'Runs: hand it off. The clock keeps moving unless he gets out of bounds.' },
  { id: 'short', label: 'Short Pass', short: 'Short', key: 's', fam: 'pass', blurb: 'Short passes: quick, high-percentage throws.' },
  { id: 'deep', label: 'Deep Pass', short: 'Deep', key: 'd', fam: 'pass', blurb: 'Deep passes: chunk plays downfield, with more sacks and interceptions.' },
  { id: 'rpo', label: 'RPO', short: 'RPO', key: 'o', fam: 'rpo', blurb: 'Run-pass option: the quarterback reads the defense after the snap.' },
  { id: 'trick', label: 'Trick', short: 'Trick', key: 't', fam: 'trick', blurb: 'Misdirection. Big upside, big risk.' },
];
const tabOf = (o: Opt): Tab | null => (o.group === 'pass' ? (SHORT.has(o.key) ? 'short' : 'deep') : o.group === 'run' || o.group === 'rpo' || o.group === 'trick' ? o.group : null);
// decisions that cost something you cannot get back: marked so they are not tapped by accident
const MAJOR = new Set(['timeout', 'spike', 'kneel', 'drain', 'onside', 'two', 'block', 'rush', 'fg', 'punt']);
const TEMPO_KEYS = new Set(['nohuddle', 'huddle', 'milk', 'let']);
const TEMPO_NAME: Record<string, string> = { nohuddle: 'No-huddle', huddle: 'Huddle', milk: 'Milk it', let: 'Let it run' };
const RISK = ['', 'Safe', 'Balanced', 'Risky'];
const MODS: { k: keyof PassMods; label: string; tip: string }[] = [
  { k: 'pa', label: 'Play action', tip: 'Fake the handoff first. Freezes a loaded box; holds the ball a beat longer.' },
  { k: 'roll', label: 'Roll out', tip: 'Move the pocket. Fewer sacks; the deep throws get harder.' },
  { k: 'oob', label: 'Sideline', tip: 'Get out of bounds after the catch to stop the clock, for fewer yards.' },
];

/** The defense in four tabs, like the offense. */
const DEF_TABS: { id: DefCat; label: string; key: string; blurb: string }[] = [
  { id: 'zone', label: 'Zone', key: 'z', blurb: 'Zone: defenders cover areas and keep everything in front.' },
  { id: 'man', label: 'Man', key: 'm', blurb: 'Man: a defender on every receiver. Tight coverage, but rubs and crossers get open.' },
  { id: 'blitz', label: 'Blitz', key: 'b', blurb: 'Blitz: send extra rushers. Sacks and hurried throws, but someone is left open.' },
  { id: 'goal', label: 'Goal Line', key: 'g', blurb: 'Goal line and run stop: load the box. Stops runs; play-action and the deep ball are the risk.' },
];
/** Card labels: the offense's formation, and the front a defensive family lines up in. */
const FORMATION_NAME: Record<FormationId, string> = { gun: 'Shotgun', trips: 'Gun Trips', empty: 'Gun Empty', single: 'Singleback', iform: 'I-Form', pistol: 'Pistol', heavy: 'Heavy', bunch: 'Gun Bunch', wildcat: 'Wildcat' };
const DEF_FRONT: Record<LookFam, string> = { balanced: '4-3 Base', zone: 'Nickel', man: 'Nickel', blitz: 'Nickel', prevent: 'Dime', load: 'Bear', goal: 'Goal Line' };
const defTabOf = (o: Opt): DefCat => (o.choice.look && o.choice.look !== 'soft' ? DEF_PLAYS[o.choice.look].cat : 'zone');

/** Runs that have a side to pick: everything but a sneak. */
const sided = (play: string | undefined) => !!play && CALL[play]?.kind === 'run' && play !== 'sneak';
const WX_ICON: Record<string, string> = { rain: '🌧', snow: '❄', wind: '💨' };

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
const bestOf = (m: Map<string, number> | null) => (m && m.size ? Math.max(...m.values()) : 0);

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

/** A decision's title, with its down-and-distance lead marked so phones can drop it (the scoreboard shows it). */
function Title({ text }: { text: string }) {
  const i = text.indexOf(': ');
  if (i < 0 || /^4th/.test(text)) return <h2>{text}</h2>;
  return <h2><span className="cp-h-dd">{text.slice(0, i)}: </span>{text.slice(i + 2)}</h2>;
}

/** A defensive call's trade-off: what it stops, what it gives up, and when it is at its best. */
function Trade({ look, cls }: { look: Look; cls: string }) {
  const L = LOOKS[look];
  return (
    <span className={`def-trade ${cls}`}>
      <span><b>Stops:</b> {L.stops}</span>
      <span><b>Gives up:</b> {L.risk}</span>
      <span><b>Use when:</b> {LOOK_USE[look]}</span>
    </span>
  );
}

function WeatherChip({ s }: { s: State }) {
  const w = s.weather ?? 'clear';
  if (w === 'clear') return null;
  return <span className={`wx-chip wx-${w}`} title={WEATHER[w].blurb}>{WX_ICON[w]} {WEATHER[w].name}</span>;
}

/**
 * The clock row: on offense the tempo (part of the snap) plus Timeout / Spike / Kneel (complete on their own); on
 * defense, Let it run (part of the call) or Timeout.
 */
/** Why the game picked this tempo for you. */
function autoWhy(key: string, s: State): string {
  const l = s.score[0] - s.score[1];
  if (key === 'milk') return 'you lead: burn the clock';
  if (key === 'nohuddle') return l < 0 ? 'you trail: save the clock' : 'under two minutes: save the clock';
  if (key === 'let') return 'save your timeouts';
  return 'normal pace';
}

function ClockRow({ clock, clockSel, hints, s, onClock, onMajor, auto }: { clock: Decision; clockSel: Opt | null; hints: Map<string, number> | null; s: State; onClock: (o: Opt) => void; onMajor: (o: Opt) => void; auto?: string }) {
  const best = bestOf(hints);
  const tempos = clock.options.filter((o) => TEMPO_KEYS.has(o.key));
  const majors = clock.options.filter((o) => !TEMPO_KEYS.has(o.key));
  const off = clock.step === 'offClock';
  return (
    <div className={`clockrow${off ? '' : ' def'}`}>
      <div className="tempo" role="radiogroup" aria-label={off ? 'Tempo' : 'Their clock'}>
        <span className="tempo-k">{off ? 'Tempo' : 'Clock'}</span>
        {tempos.map((o) => {
          const wp = hints?.get(o.key);
          const sel = clockSel?.key === o.key;
          const secs = o.key in TEMPO ? TEMPO[o.key as keyof typeof TEMPO].secs : null;
          return (
            <button key={o.key} role="radio" aria-checked={sel} className={`tbtn${sel ? ' on' : ''} ${hintClass(wp, best)}`} onClick={() => onClock(o)} title={o.sub}>
              <span className="tbtn-name">{TEMPO_NAME[o.key] ?? o.label}{auto === o.key && <em className="tbtn-auto">Auto</em>}</span>
              <span className="tbtn-sub">{wp != null ? `${(wp * 100).toFixed(1)}%` : secs != null ? `about ${Math.min(secs, s.t)} s` : o.key === 'let' ? 'Save your timeouts' : o.sub}</span>
            </button>
          );
        })}
      </div>
      {off && auto && clockSel?.key === auto && <p className="tempo-why">Tempo set for you: <b>{TEMPO_NAME[auto]}</b>, {autoWhy(auto, s)}.</p>}
      {majors.length > 0 && (
        <div className="majors">
          {majors.map((o) => {
            const wp = hints?.get(o.key);
            return (
              <button key={o.key} className={`mbtn ${o.key}${MAJOR.has(o.key) ? ' major' : ''} ${hintClass(wp, best)}`} onClick={() => onMajor(o)} title={o.sub}>
                <span className="mbtn-name">{o.label}</span>
                <span className="mbtn-sub">{wp != null ? `${(wp * 100).toFixed(1)}%` : o.key === 'timeout' ? `${s.to[0]} left` : o.key === 'spike' ? 'Stops it, costs a down' : o.key === 'kneel' ? 'Runs the clock' : o.key === 'drain' ? 'To 0:03, then timeout' : o.key === 'let' ? '' : o.sub}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CallPanel(p: Props) {
  const { dec, clock, clockSel, s, teams, selected, edits, hints, prev, onSelect, onSnap, onEdit } = p;
  const isPlay = dec.step === 'play';
  const isLook = dec.step === 'look';
  const [tab, setTab] = useState<Tab>('short');
  const [dtab, setDtab] = useState<DefCat>('zone');
  const specials = dec.options.filter((o) => o.group === 'special');
  const best = bestOf(hints);
  const needClock = !!clock && !clockSel;
  const canSnap = !!selected && !needClock;

  useEffect(() => { if (isPlay) setTab('short'); }, [dec.step === 'play' ? dec.title : null, isPlay]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isLook) setDtab('zone'); }, [dec.step === 'look' ? dec.title : null, isLook]);   // eslint-disable-line react-hooks/exhaustive-deps
  // a row picked from the keyboard (or under the pinned field on phones) scrolls clear, with its options
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.cp [aria-selected="true"]');
    if (el) keepClear(el.closest<HTMLElement>('.prow-wrap') ?? el);
  }, [selected?.key]);

  const list = isPlay ? dec.options.filter((o) => tabOf(o) === tab) : isLook ? dec.options.filter((o) => defTabOf(o) === dtab) : dec.options;
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
        if (isPlay || isLook) onSelect(o); else if (!needClock) onSnap(o);
      } else if ((isPlay || isLook) && e.key === 'Enter' && selected && canSnap) {
        e.preventDefault();
        onSnap(selected);
      } else if (isPlay) {
        const t = TABS.find((x) => x.key === e.key.toLowerCase());
        if (t) setTab(t.id);
      } else if (isLook) {
        const t = DEF_TABS.find((x) => x.key === e.key.toLowerCase());
        if (t) setDtab(t.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const clockRow = clock && <ClockRow clock={clock} clockSel={clockSel} hints={p.clockHints} s={s} onClock={p.onClock} onMajor={p.onMajor} auto={p.autoTempo} />;
  const clockNote = needClock ? (clock!.step === 'offClock' ? 'Pick a tempo, then the play.' : 'Timeout, or let it run?') : null;
  const snapLabel = (word: string) => (needClock ? (clock!.step === 'offClock' ? 'Pick a tempo' : 'Clock first') : word);

  if (isLook) {
    const look = selected?.choice.look;
    const info = look ? LOOKS[look] : null;
    const DT = DEF_TABS.find((x) => x.id === dtab)!;
    const row = (o: Opt, i: number) => {
      const wp = hints?.get(o.key);
      const sel = selected?.key === o.key;
      const L = LOOKS[o.choice.look!];
      const fam = famOf(o.choice.look!);
      return (
        <button key={o.key} role="option" aria-selected={sel} className={`pcard2 fam-def${sel ? ' sel' : ''} ${hintClass(wp, best)}`} onClick={(e) => { onSelect(o); keepClear(e.currentTarget); }}>
          <span className="pc-art">
            <MiniPlay look={o.choice.look} />
            <span className="pc-form">{DEF_FRONT[fam]}</span>
            <span className="pc-tag">{wp != null ? <span className="opt-wp">{(wp * 100).toFixed(1)}%</span> : <span className={`riskchip r${L.tilt}`}>{['', 'Safe', 'Trade-off', 'Gamble'][L.tilt]}</span>}</span>
          </span>
          <span className="pc-name"><kbd>{i + 1}</kbd>{o.label}</span>
          <span className="pc-sub">{o.sub}</span>
          {sel && <Trade look={o.choice.look!} cls="in-row" />}
        </button>
      );
    };
    return (
      <section className="cp def" aria-label="Call the defense">
        <Prev prev={prev} />
        <header className="cp-head">
          <div className="cp-flags"><span className="def-flag">Defense · your call</span><WeatherChip s={s} /></div>
          <Title text={dec.title} />
          <div className="read tend"><b>Scouting:</b> {tendency(s)}</div>
        </header>
        {clockRow}
        <div className="tabs5 deftabs" role="tablist" aria-label="Kinds of defense">
          {DEF_TABS.map((t) => {
            const n = dec.options.filter((o) => defTabOf(o) === t.id).length;
            return (
              <button key={t.id} role="tab" aria-selected={dtab === t.id} className={`tab5 dcat-${t.id}${dtab === t.id ? ' on' : ''}`} onClick={() => setDtab(t.id)} title={t.blurb}>
                <span className="tab5-name"><i />{t.label}</span>
                <span className="tab5-n">{n} play{n === 1 ? '' : 's'}</span>
              </button>
            );
          })}
        </div>
        <p className="tab5-blurb">{DT.blurb}</p>
        <div className="cp-list def-list cards" role="listbox" aria-label={`${DT.label} defenses`}>{list.map(row)}</div>
        {look && <Trade look={look} cls="strip" />}
        <footer className={`cp-foot${canSnap ? ' ready' : ''}`}>
          <div className="cp-sel">
            {info ? (
              <>
                <span className="cp-sel-k">Your defense</span>
                <span className="cp-sel-name">{info.label}</span>
                {clockNote && <span className="cp-sel-sub"><b>{clockNote}</b></span>}
              </>
            ) : <span className="cp-sel-sub">{clockNote ?? 'Pick a defense to see it on the field.'}<span className="keys"> Keys: 1–9 pick · Z M B G tabs · Enter calls it</span></span>}
          </div>
          <button className="btn snap" disabled={!canSnap} onClick={() => selected && canSnap && onSnap(selected)}>{snapLabel('Call it')}<kbd>Enter</kbd></button>
        </footer>
      </section>
    );
  }

  if (!isPlay) {
    // kicks, tries, a clock-only step: each button is the whole decision, one tap
    return (
      <section className="cp" aria-label="Your decision">
        <Prev prev={prev} />
        <header className="cp-head">
          <div className="cp-flags"><WeatherChip s={s} /></div>
          <Title text={dec.title} />
          {dec.step === 'offClock' && <p className="cp-note">The clock is still running. How fast do you get to the next snap?</p>}
          {dec.step === 'defClock' && <p className="cp-note">They are letting the clock run.</p>}
        </header>
        {clockRow}
        <div className="cp-grid">
          {dec.options.map((o, i) => {
            const wp = hints?.get(o.key);
            return (
              <button key={o.key} className={`dbtn${MAJOR.has(o.key) ? ' major' : ''} ${hintClass(wp, best)}`} disabled={needClock} onClick={() => onSnap(o)}>
                <span className="dbtn-txt">
                  <span className="dbtn-name"><kbd>{i + 1}</kbd>{o.label}</span>
                  {o.sub && <span className="dbtn-sub">{o.sub}</span>}
                </span>
                {wp != null && <span className="opt-wp">{(wp * 100).toFixed(1)}%</span>}
              </button>
            );
          })}
        </div>
        <p className="cp-keys keys">{clockNote ?? `Press 1–${dec.options.length} to choose`}</p>
      </section>
    );
  }

  const call = selected?.choice.play ? CALL[selected.choice.play] : null;
  const isPass = !!call?.routes && call.kind === 'pass' && call.id !== 'hail';
  const tgt = (edits.target ?? call?.tgt) as Rcv | undefined;
  const routeOf = (r: Rcv): RouteId => edits.routes[r] ?? call!.routes![r];
  const rt = isPass && tgt ? routeOf(tgt) : null;
  const last = (r: Rcv) => { const parts = (teams[0].players[r]?.name ?? POS_NAME[r]).split(' ').filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(w)); return parts[parts.length - 1]; };
  const fourth = s.down === 4;
  const T = TABS.find((x) => x.id === tab)!;
  const setSide = (side: 1 | -1) => onEdit({ ...edits, side });
  const toggleMod = (k: keyof PassMods) => onEdit({ ...edits, mods: { ...edits.mods, [k]: !edits.mods[k] } });

  // the playbook as cards, Madden style: the play drawn big, its formation, its name
  const row = (o: Opt, i: number) => {
    const wp = hints?.get(o.key);
    const sel = selected?.key === o.key;
    const f = o.choice.play ? DESIGN[o.choice.play]?.formation : undefined;
    return (
      <button key={o.key} role="option" aria-selected={sel} className={`pcard2 fam-${o.group}${sel ? ' sel' : ''} ${hintClass(wp, best)}`} onClick={(e) => { onSelect(o); keepClear(e.currentTarget); }}>
        <span className="pc-art">
          <MiniPlay play={o.choice.play} side={sel ? edits.side : undefined} routes={sel ? edits.routes : undefined} target={sel ? edits.target : undefined} mods={sel ? edits.mods : undefined} />
          {f && <span className="pc-form">{FORMATION_NAME[f] ?? f}</span>}
          <span className="pc-tag">{wp != null ? <span className="opt-wp">{(wp * 100).toFixed(1)}%</span> : o.risk ? <span className={`riskchip r${o.risk}`}>{RISK[o.risk]}</span> : null}</span>
        </span>
        <span className="pc-name"><kbd>{i + 1}</kbd>{o.label}</span>
        <span className="pc-sub">{o.sub}</span>
      </button>
    );
  };
  // the selected play's adjustments sit just above Snap, always in reach
  const run = sided(selected?.choice.play);
  const adjust = selected && (run || isPass) && (
    <div className="cp-adjust">
      {run && (
        <div className="sides" role="radiogroup" aria-label="Which side">
          <button role="radio" aria-checked={edits.side === 1} className={`sidebtn${edits.side === 1 ? ' on' : ''}`} onClick={() => setSide(1)} title="Toward the tight end: an extra blocker">Strong side →</button>
          <button role="radio" aria-checked={edits.side === -1} className={`sidebtn${edits.side === -1 ? ' on' : ''}`} onClick={() => setSide(-1)} title="Away from the tight end: fewer blockers, fewer defenders">← Weak side</button>
        </div>
      )}
      {isPass && (
        <div className="chips" role="group" aria-label="Adjustments">
          <span className="chips-k">Signal</span>
          {MODS.map((m) => (
            <button key={m.k} className={`mchip${edits.mods[m.k] ? ' on' : ''}`} aria-pressed={!!edits.mods[m.k]} onClick={() => toggleMod(m.k)} title={m.tip}>{m.label}</button>
          ))}
        </div>
      )}
    </div>
  );

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

  const edited = isPass && (!!edits.target || Object.keys(edits.routes).length > 0 || edits.mods.pa || edits.mods.roll || edits.mods.oob);
  const summary = () => {
    if (!selected) return null;
    if (isPass && tgt && rt) {
      const sig = MODS.filter((m) => edits.mods[m.k]).map((m) => m.label.toLowerCase());
      return <>To <b>{last(tgt)}</b> on a {ROUTES[rt].name.toLowerCase()}{sig.length ? `, ${sig.join(', ')}` : ''}.{!edited && <span className="cp-tip"> Tap a receiver on the field to throw to him; tap him again to change his route.</span>}</>;
    }
    if (sided(selected.choice.play)) return <>To the <b>{edits.side === 1 ? 'strong' : 'weak'} side</b>. {selected.sub}</>;
    return <>{selected.sub}</>;
  };

  return (
    <section className="cp" aria-label="Call the play">
      <Prev prev={prev} />
      <header className="cp-head">
        <div className="cp-flags"><span className="off-flag">Your call</span><WeatherChip s={s} /></div>
        <Title text={dec.title} />
        {s.shownLook && (
          <div className="read" title="Your pre-snap read is right about 7 times in 10">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>
            <span><b>Defense:</b> {LOOK_READ[s.shownLook]}</span>
          </div>
        )}
      </header>
      {clockRow}
      {fourth && specialRow}
      <div className="tabs5" role="tablist" aria-label="Kinds of plays">
        {TABS.map((t) => {
          const n = dec.options.filter((o) => tabOf(o) === t.id).length;
          return (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab5 fam-${t.fam}${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)} title={t.blurb}>
              <span className="tab5-name"><i /><span className="tab5-long">{t.label}</span><span className="tab5-short">{t.short}</span></span>
              <span className="tab5-n">{n} play{n === 1 ? '' : 's'}</span>
            </button>
          );
        })}
      </div>
      <p className="tab5-blurb">{T.blurb}</p>
      <div className="cp-list cards" role="listbox" aria-label={`${T.label} calls`}>{list.map(row)}</div>
      {!fourth && specialRow}
      <footer className={`cp-foot${canSnap ? ' ready' : ''}`}>
        {adjust}
        <div className="cp-sel">
          {selected ? (
            <>
              <span className="cp-sel-k">Selected{clockSel ? ` · ${(TEMPO_NAME[clockSel.key] ?? clockSel.label).toLowerCase()}` : ''}</span>
              <span className="cp-sel-mini"><MiniPlay play={selected.choice.play} side={edits.side} routes={edits.routes} target={edits.target} mods={edits.mods} /></span>
              <span className="cp-sel-name">{selected.label}</span>
              <span className="cp-sel-sub">{clockNote ? <b>{clockNote}</b> : summary()}</span>
            </>
          ) : <span className="cp-sel-sub">{clockNote ?? 'Pick a play to see it on the field.'}<span className="keys"> Keys: 1–9 pick · R S D O T tabs · Enter snaps</span></span>}
        </div>
        <button className="btn snap" disabled={!canSnap} onClick={() => selected && canSnap && onSnap(selected)}>{snapLabel('Snap')}<kbd>Enter</kbd></button>
      </footer>
    </section>
  );
}
