/**
 * Draft night, built the way Madden's Superstar mode builds it: something you do before the draft that moves your
 * stock (media day at the podium), the green room while the picks go by (with the teams that called your agent),
 * the phone call, the commissioner saying your name, and then a welcome to your new team. Each step waits for you,
 * so the night has a pace instead of a progress bar.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { tv } from './tv';
import { ARCH, ordinal, rookieDeal, type Career } from '../../career/career';
import { LEAGUE_NAME, teamById, teamInfo } from '../../career/league';
import { finishMediaDay, mediaQuestions, MEDIA_RIGHT, MEDIA_WRONG } from '../../career/media';
import { standings } from '../../career/standings';
import { FIRST, LAST } from '../../engine/data';
import { hash } from '../../engine/rng';
import type { CTeam } from '../../career/types';
import { audio } from '../../game/audio';
import { Confetti } from '../Impact';
import { TeamTag } from './Hub';
import type { Commit } from './Career';

type Stage = 'media' | 'room' | 'call' | 'announce' | 'welcome';
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Where the scouts project a stock: a range of picks around the draft's own formula (career.ts pickFor). */
function projection(stock: number): string {
  const base = 1 + ((100 - stock) / 100) ** 1.4 * 64;
  const lo = Math.max(1, Math.round(base - 4)), hi = Math.min(64, Math.round(base + 4));
  return hi <= 32 ? `picks ${lo}–${hi}, first round` : lo > 32 ? `picks ${lo}–${hi}, second round` : `picks ${lo}–${hi}, the end of round one`;
}

/** Where a team stands: its rank in the league by overall, and what kind of team that makes it. */
function outlook(c: Career, id: string) {
  const ovr = c.league.teams.map((t) => ({ id: t.id, ovr: teamInfo(c.league, t).rat.ovr })).sort((a, b) => b.ovr - a.ovr);
  const rank = ovr.findIndex((x) => x.id === id) + 1;
  const tier = rank <= 8 ? 'Contender' : rank <= 16 ? 'Playoff hopeful' : rank <= 24 ? 'Middle of the pack' : 'Rebuilding';
  const coach = rank <= 8 ? 'We were one piece away. You are the piece.'
    : rank <= 16 ? 'The roster is there. Get us over the hump.'
    : rank <= 24 ? 'Nobody expects much from us. Let\'s change that.'
    : 'We\'re building this around you. Take your lumps, and take your shots.';
  return { rank, tier, coach };
}

export function DraftNight({ c, commit, onDone }: { c: Career; commit: Commit; onDone: () => void }) {
  const d = c.draft!;
  const [stage, setStage] = useState<Stage>(d.media == null ? 'media' : d.revealed >= d.picks.length ? 'announce' : 'room');
  useEffect(() => { window.scrollTo({ top: 0 }); }, [stage]);
  const team = teamById(c.league, d.picks[d.picks.length - 1].team);
  if (stage === 'media') return <MediaDay c={c} onFinish={(right, wrong) => { commit((x) => finishMediaDay(x, right, wrong)); setStage('room'); }} />;
  if (stage === 'room') return <GreenRoom c={c} onYourPick={() => { commit((x) => { if (x.draft) x.draft.revealed = x.draft.picks.length; }); setStage('call'); }} />;
  if (stage === 'call') return <PhoneCall c={c} team={team} onDone={() => setStage('announce')} />;
  if (stage === 'announce') return <Announce c={c} team={team} onDone={() => setStage('welcome')} />;
  return <Welcome c={c} team={team} onDone={onDone} />;
}

/* ---------------------------------------------------------------- media day --- */

const Q_SECONDS = 15;

function MediaDay({ c, onFinish }: { c: Career; onFinish: (right: number, wrong: number) => void }) {
  const qs = useMemo(() => mediaQuestions(c.seed), [c.seed]);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);   // index chosen, -1 for out of time
  const [left, setLeft] = useState(Q_SECONDS);
  const q = qs[i];
  const chosen = answers[i];
  const done = i >= qs.length;
  useEffect(() => {
    if (done || chosen != null) return;
    const id = setInterval(() => setLeft((x) => Math.max(0, x - 0.1)), 100);
    return () => clearInterval(id);
  }, [i, chosen, done]);
  useEffect(() => { if (!done && chosen == null && left <= 0) answer(-1); }, [left]);   // eslint-disable-line react-hooks/exhaustive-deps
  const answer = (k: number) => {
    if (chosen != null) return;
    setAnswers((a) => { const n = [...a]; n[i] = k; return n; });
    audio.play(k === q.right ? 'chime' : 'gradeBad');
  };
  const next = () => { setI((x) => x + 1); setLeft(Q_SECONDS); };
  const right = answers.filter((a, k) => a === qs[k]?.right).length, wrong = answers.length - right;
  const stock0 = c.draft!.stock ?? c.college.result?.stock ?? 50;
  const stock1 = Math.max(2, Math.min(99, stock0 + right * MEDIA_RIGHT + wrong * MEDIA_WRONG));
  return (
    <div className="cr-page">
      <section className="cr-card dn-hero">
        <div className="eyebrow">{c.draft!.year} draft · Media day</div>
        <h1>At the <em>podium</em></h1>
        <p className="cr-lede">Scouts, coaches and every camera in the league. Three questions about running a game. Answer like a quarterback: each right answer raises your draft stock, each wrong one costs you.</p>
        <div className="dn-stock"><span>Draft stock</span><b>{done ? stock1 : stock0}</b><small>/100 · projected {projection(done ? stock1 : stock0)}</small></div>
      </section>
      {!done ? (
        <section className="cr-card dn-q" aria-live="polite">
          <div className="dn-q-head"><span className="eyebrow">Question {i + 1} of {qs.length}</span>{chosen == null && <span className="dn-timer" aria-label={`${Math.ceil(left)} seconds left`}><i style={{ width: `${(left / Q_SECONDS) * 100}%` }} /><b>{Math.ceil(left)}s</b></span>}</div>
          <h2 className="dn-q-text">{q.q}</h2>
          <div className="dn-answers">
            {q.a.map((a, k) => (
              <button key={k} className={`dn-ans${chosen != null ? (k === q.right ? ' right' : k === chosen ? ' wrong' : ' dim') : ''}`} disabled={chosen != null} onClick={() => answer(k)} autoFocus={k === 0}>
                <kbd>{k + 1}</kbd>{a}
              </button>
            ))}
          </div>
          {chosen != null && (
            <div className={`dn-why ${chosen === q.right ? 'good' : 'bad'}`}>
              <b>{chosen === q.right ? `Right. +${MEDIA_RIGHT} stock.` : chosen === -1 ? `Out of time. ${MEDIA_WRONG} stock.` : `Not quite. ${MEDIA_WRONG} stock.`}</b> {q.why}
              <button className="btn primary" onClick={next} autoFocus>{i + 1 < qs.length ? 'Next question' : 'See how you did'}</button>
            </div>
          )}
        </section>
      ) : (
        <section className="cr-card dn-q">
          <h2>{right === 3 ? 'Nailed it' : right === 2 ? 'Solid' : right === 1 ? 'Rough day' : 'That could have gone better'}</h2>
          <p className="cr-lede">{right} of 3 right. Your stock {stock1 >= stock0 ? 'climbs' : 'slips'} from {stock0} to <b>{stock1}</b>. The scouts now have you going {projection(stock1)}.</p>
          <button className="btn primary big" onClick={() => onFinish(right, wrong)} autoFocus>To the green room</button>
        </section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- green room --- */

/** The numbers behind projection(): the pick range the scouts give a stock. */
function range(stock: number): [number, number] {
  const base = 1 + ((100 - stock) / 100) ** 1.4 * 64;
  return [Math.max(1, Math.round(base - 4)), Math.min(64, Math.round(base + 4))];
}

const TEXTS = [
  ['Mom', 'Whatever happens tonight, we are so proud of you.'],
  ['Dad', 'Breathe. Your name is coming.'],
  ['Your college coach', 'Told you that bowl game would do it.'],
  ['Your little sister', 'my whole class is watching!!'],
];
type Beat = 'clock' | 'in' | 'reveal';

/**
 * The green room, run like the broadcast: each pick is on the clock, then "the pick is in", then the name. When a team
 * that called your agent is up, it takes longer, and for a second it could be you. Around it: your projected range on
 * a strip of every pick up to yours, your heart rate climbing as the board closes in, a text from home, an analyst
 * ticker, and the board itself.
 */
function GreenRoom({ c, onYourPick }: { c: Career; onYourPick: () => void }) {
  const d = c.draft!;
  const last = d.picks.length - 1;                 // index of your pick
  const [shown, setShown] = useState(Math.min(d.revealed, last));
  const [beat, setBeat] = useState<Beat>('clock');
  const [trade, setTrade] = useState(false);
  const [text, setText] = useState<string[] | null>(null);
  const [tick, setTick] = useState(0);
  const called = (d.interest ?? []).length;
  const [agent, setAgent] = useState<string[]>([`Agent: "${['Nobody', 'One team', 'Two teams', 'Three teams'][called] ?? `${called} teams`} called this week. ${last > 8 ? 'Stay loose.' : "You won't be waiting long."}"`]);
  const interest = d.interest ?? [];
  const cur = d.picks[shown];
  const curTeam = teamById(c.league, cur.team);
  const fast = last - shown > 6;
  const hot = interest.includes(cur.team) && shown < last;
  const said = useRef(new Set<number>());
  const texted = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { for (const x of timers.current) clearTimeout(x); }, []);
  const stock = d.stock ?? c.college.result?.stock ?? 50;
  const [lo, hi] = range(stock);
  const R = reduced();

  useEffect(() => {
    if (shown >= last) {
      if (d.trade && !trade) {
        // the trade alert first; this effect runs again once it is showing, and that run waits on it
        setTrade(true);
        audio.play('turnoverGood');
        setAgent((a) => [`Agent: "Hold on… ${teamById(c.league, d.trade!.team).city} just traded up. Phone's ringing."`, ...a]);
        return;
      }
      const t = setTimeout(onYourPick, trade ? (R ? 1200 : 3200) : 1500);
      return () => clearTimeout(t);
    }
    if (beat === 'clock' && hot && !said.current.has(shown)) {
      // a team that called is on the clock: the agent gets nervous
      said.current.add(shown);
      audio.play('drum');
      setAgent((a) => [`Agent: "${curTeam.city} is on the clock. They were high on you…"`, ...a]);
    }
    if (beat === 'clock' && !texted.current && last > 4 && shown >= Math.floor(last / 2)) {
      texted.current = true;
      setText(TEXTS[hash(c.seed, 'text') % TEXTS.length]);
      const tt = setTimeout(() => setText(null), R ? 2500 : 5200);
      timers.current.push(tt);
    }
    const ms = R ? 250 : beat === 'clock' ? (fast ? 500 : hot ? 2600 : 1300) : beat === 'in' ? (fast ? 160 : hot ? 1300 : 650) : (fast ? 380 : hot ? 1700 : 1000);
    const t = setTimeout(() => {
      if (beat === 'clock') { setBeat('in'); if (!fast) audio.play('whistle'); return; }
      if (beat === 'in') { setBeat('reveal'); return; }
      if (hot) setAgent((a) => [`${curTeam.city} takes ${cur.name}, ${cur.pos}. Not you. Not yet.`, ...a]);
      setBeat('clock');
      setShown((n) => n + 1);
    }, ms);
    return () => clearTimeout(t);
  }, [shown, beat, trade]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the analyst ticker turns over every few seconds
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 4200); return () => clearInterval(id); }, []);
  const prev = d.picks[shown - 1];
  const ticker = [
    `ANALYST: ${c.you.name} is the ${ARCH[c.you.arch].name.toLowerCase()} teams want. We have him going ${projection(stock)}.`,
    prev ? `PICK ${prev.pick}: ${teamById(c.league, prev.team).city} takes ${prev.name}, ${prev.pos} out of ${prev.college}.` : `THE ${d.year} ${LEAGUE_NAME.toUpperCase()} DRAFT IS UNDER WAY.`,
    interest.length ? `HEARING: ${interest.map((id) => teamById(c.league, id).city).join(', ')} ${interest.length === 1 ? 'has' : 'have'} done the most work on ${c.you.name.split(' ').slice(-1)[0]}.` : `HEARING: teams are quiet on ${c.you.name.split(' ').slice(-1)[0]}. That can mean anything.`,
    `QB WATCH: ${d.picks.slice(0, shown).filter((p) => p.pos === 'QB').length} quarterbacks off the board so far.`,
  ];
  // your heart, faster as the board closes in, and racing when a team that called is up
  const near = last ? shown / last : 1;
  const bpm = Math.round(72 + 62 * near * near + (hot ? 22 : 0) + (shown >= last ? 30 : 0));

  const status = (id: string) => {
    const taken = d.picks.slice(0, shown + (beat === 'reveal' ? 1 : 0)).find((p) => p.team === id);
    return taken ? `Took ${taken.pos}` : id === cur.team && shown < last ? 'On the clock' : 'Waiting';
  };
  const done = d.picks.slice(0, shown + (beat === 'reveal' && shown < last ? 1 : 0));
  const tradeTeam = d.trade ? teamById(c.league, d.trade.team) : null;
  const clockTeam = trade && tradeTeam ? tradeTeam : curTeam;
  return (
    <div className="cr-page">
      <section className="cr-card dn-hero">
        <div className="eyebrow">{d.year} {LEAGUE_NAME} Draft · The green room</div>
        <h1>Draft <em>night</em></h1>
        <p className="cr-lede">Your family, your agent, a camera in your face. Stock <b>{stock}</b>: projected {projection(stock)}.</p>
        <div className="dn-slots" aria-label={`Pick ${cur.pick} of your ${d.yourPick}`}>
          {d.picks.map((p, i) => (
            <i key={p.pick} title={`Pick ${p.pick}`} className={[i < done.length ? 'done' : '', i === shown ? 'now' : '', p.pick >= lo && p.pick <= hi ? 'range' : '', i === last ? 'you' : ''].join(' ')} />
          ))}
          <span className="dn-slots-k"><b>Your range</b> picks {lo}–{hi}</span>
        </div>
        <div className="dn-heart" style={{ ['--beat' as string]: `${(60 / bpm).toFixed(2)}s` }} aria-label={`Heart rate ${bpm}`}><i aria-hidden />{bpm}<small>bpm</small></div>
        {shown < last - 4 && <button className="btn ghost small" onClick={() => { setShown(Math.max(shown, last - 4)); setBeat('clock'); }}>Skip ahead to the last few picks</button>}
      </section>
      <div className="dn-room">
        <section className={`cr-card dn-clock${trade ? ' trade' : ''}${hot ? ' hot' : ''} beat-${beat}`} style={tv(clockTeam)} aria-live="polite">
          {trade && tradeTeam ? (
            <>
              <div className="dn-alert">Trade alert</div>
              <h2>{tradeTeam.city} {tradeTeam.name} trade up to No. {d.yourPick}</h2>
              <p>From {teamById(c.league, d.trade!.from).city}. Your phone lights up.</p>
            </>
          ) : (
            <>
              <div className="eyebrow">Pick {cur.pick}{shown >= last ? ' · You\'re next to hear it' : ''}</div>
              <div className="dn-otc"><span className="cr-chip big">{curTeam.id}</span><div><b>{curTeam.city} {curTeam.name}</b><span>{shown >= last ? 'On the clock… and your phone is buzzing' : beat === 'clock' ? (hot ? 'On the clock. They called your agent.' : 'On the clock') : beat === 'in' ? 'The pick is in' : 'The pick'}</span></div></div>
              {shown < last && beat === 'clock' && <span className="dn-bar" key={shown} style={{ animationDuration: `${R ? 0.25 : fast ? 0.5 : hot ? 2.6 : 1.3}s` }} />}
              {shown < last && beat === 'in' && <div className="dn-pickin" key={`in${shown}`}>{hot ? 'The pick is in… could it be you?' : 'The pick is in'}</div>}
              {shown < last && beat === 'reveal' && (
                <div className={`dn-reveal${hot ? ' notyou' : ''}`} key={`r${shown}`}>
                  <b>{cur.name}</b><span>{cur.pos} · {cur.college}</span>
                  {hot && <em>Not you</em>}
                </div>
              )}
            </>
          )}
        </section>
        <section className="cr-card dn-calls">
          <h3>Teams that called</h3>
          <ul>{interest.map((id) => { const t = teamById(c.league, id); const st = status(id); return <li key={id} className={st === 'On the clock' ? 'live' : st.startsWith('Took') ? 'gone' : ''}><TeamTag t={t} /><em>{st}</em></li>; })}</ul>
          <h3>Agent</h3>
          <ul className="dn-feed">{agent.slice(0, 4).map((a, k) => <li key={agent.length - k}>{a}</li>)}</ul>
          {text && <div className="dn-text" role="status"><b>{text[0]}</b>{text[1]}</div>}
        </section>
      </div>
      <div className="dn-ticker" aria-live="off"><span className="dn-ticker-k">Draft desk</span><span key={tick} className="dn-ticker-t">{ticker[tick % ticker.length]}</span></div>
      <section className="cr-card">
        <h3>The board</h3>
        <ol className="cr-board">
          {done.map((p) => { const t = teamById(c.league, p.team); return (
            <li key={p.pick} className={interest.includes(p.team) ? 'called' : ''}><span className="num">{p.pick}</span><b>{p.name}</b><span className="cr-board-sub"><TeamTag t={t} /><em>{p.pos} · {p.college}</em></span></li>
          ); }).reverse()}
        </ol>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- the call --- */

function PhoneCall({ c, team, onDone }: { c: Career; team: CTeam; onDone: () => void }) {
  const d = c.draft!;
  const [answered, setAnswered] = useState(false);
  const [lines, setLines] = useState(0);
  const gm = useMemo(() => `${FIRST[hash(c.seed, team.id, 'gm') % FIRST.length]} ${LAST[hash(c.seed, team.id, 'gm2') % LAST.length]}`, [c.seed, team.id]);
  useEffect(() => {
    if (answered) return;
    audio.play('ring');
    const id = setInterval(() => audio.play('ring'), 2200);
    return () => clearInterval(id);
  }, [answered]);
  useEffect(() => {
    if (!answered || lines >= 3) return;
    const t = setTimeout(() => setLines((n) => n + 1), reduced() ? 200 : lines === 0 ? 300 : 1300);
    return () => clearTimeout(t);
  }, [answered, lines]);
  const from = d.trade ? teamById(c.league, d.trade.from) : null;
  const say = [
    `"${c.you.name}? ${gm}, general manager of the ${team.city} ${team.name}."`,
    from ? `"We just traded up with ${from.city} to get to ${ordinal(d.yourPick)}. We weren't letting you get past us."` : `"We're on the clock at ${ordinal(d.yourPick)}, and we're not waiting on anybody."`,
    `"You're our quarterback. Go hug your family. You're about to hear your name."`,
  ];
  return (
    <div className="cr-page">
      <section className="cr-card dn-phone" style={tv(team)}>
        <div className={`dn-handset${answered ? '' : ' ringing'}`} aria-hidden><span className="cr-chip big">{team.id}</span></div>
        <div className="eyebrow">{answered ? 'On the line' : 'Incoming call'}</div>
        <h2>{team.city} {team.name}</h2>
        {!answered ? (
          <button className="btn primary big" onClick={() => setAnswered(true)} autoFocus>Answer</button>
        ) : (
          <>
            <div className="dn-lines" aria-live="polite">{say.slice(0, lines).map((l, k) => <p key={k}>{l}</p>)}</div>
            {lines >= 3 && <button className="btn primary big" onClick={onDone} autoFocus>Walk to the stage</button>}
          </>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- the stage --- */

function Announce({ c, team, onDone }: { c: Career; team: CTeam; onDone: () => void }) {
  const d = c.draft!;
  const [step, setStep] = useState(reduced() ? 3 : 0);
  useEffect(() => {
    if (step >= 3) return;
    if (step === 1) audio.play('drum');
    const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 1300 : step === 1 ? 1700 : 0);
    return () => clearTimeout(t);
  }, [step]);
  useEffect(() => { if (step === 3) { audio.play('win'); } }, [step]);
  return (
    <div className="cr-page">
      <section className="cr-card dn-stage" style={tv(team)}>
        {step >= 3 && <div className="impact impact-draft" aria-hidden><Confetti n={36} /></div>}
        <div className="eyebrow">The {d.year} {LEAGUE_NAME} Draft · Round {d.yourPick <= 32 ? 1 : 2}</div>
        <p className={`dn-say${step >= 0 ? ' on' : ''}`}>With the {ordinal(d.yourPick)} pick in the {d.year} {LEAGUE_NAME} Draft,</p>
        <p className={`dn-say${step >= 1 ? ' on' : ''}`}>the {team.city} {team.name} select…</p>
        <div className={`dn-name${step >= 3 ? ' on' : ''}`} aria-live="polite">
          {step >= 3 && <><b>{c.you.name}</b><span>Quarterback · {c.you.college}</span></>}
        </div>
        {step >= 3 && (
          <div className="dn-jersey" aria-hidden><span>{c.you.name.split(' ').slice(-1)[0]}</span><b>{c.you.number}</b></div>
        )}
        {step < 3 ? <button className="btn ghost small" onClick={() => setStep(3)}>Skip</button> : <button className="btn primary big" onClick={onDone} autoFocus>Meet your new team</button>}
      </section>
    </div>
  );
}

function Welcome({ c, team, onDone }: { c: Career; team: CTeam; onDone: () => void }) {
  const d = c.draft!;
  const info = teamInfo(c.league, team);
  const rec = standings(c.league.teams, c.season.games)[team.id];
  const o = outlook(c, team.id);
  const deal = rookieDeal(d.yourPick);
  const oldQb = c.league.players[team.roster.QB];
  const star = Object.entries(team.roster).filter(([slot]) => slot !== 'QB').map(([, id]) => c.league.players[id]).filter(Boolean).sort((a, b) => b.rating - a.rating)[0];
  return (
    <div className="cr-page">
      <section className="cr-card dn-welcome" style={tv(team)}>
        <span className="cr-chip big">{team.id}</span>
        <div className="eyebrow">{o.tier} · {ordinal(o.rank)} of 32 by overall</div>
        <h1>Welcome to <em>{team.city}</em></h1>
        <p className="cr-lede">Head coach: <i>"{o.coach}"</i></p>
      </section>
      <div className="cr-grid">
        <section className="cr-card">
          <h3>Your deal</h3>
          <p className="dn-big">{deal.years} years · ${deal.salary}m a year</p>
          <p className="muted">{d.trade ? `They traded up to ${ordinal(d.yourPick)} to get you.` : `${ordinal(d.yourPick)} overall.`} You start from day one{oldQb ? `: ${oldQb.name} (${oldQb.rating} overall) heads to free agency` : ''}.</p>
        </section>
        <section className="cr-card">
          <h3>The team</h3>
          <p className="dn-big">{info.rat.ovr} overall</p>
          <p className="muted">Offense {info.rat.off} · Defense {info.rat.def} · Last season {rec ? `${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ''}` : '—'}</p>
          {star && <p className="muted">Best player: <b>{star.name}</b>, {star.rating} overall.</p>}
        </section>
      </div>
      <button className="btn primary big" onClick={onDone} autoFocus>Start your rookie season</button>
    </div>
  );
}
