/** Career screens between games: draft night, the postgame, the season's end, and the offseason. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { passerRating, type Box, type Line } from '../../career/box';
import { ARCH, COLLEGES, levelOf, youPlayer, type Career } from '../../career/career';
import { FINAL_NAME, teamById, teamInfo } from '../../career/league';
import { offers, signWith, tradeTargets } from '../../career/offseason';
import { liveTeams, gameOf } from '../../career/run';
import { WEEK_NAME } from '../../career/season';
import { standings } from '../../career/standings';
import { POS_LABEL } from '../../engine/data';
import type { TeamInfo } from '../../engine/types';
import { download, shareCard, toBlob } from '../../game/shareImage';
import { careerCard } from '../../career/card';
import { audio } from '../../game/audio';

/** Career games whose result has already been played (so a re-render or a revisit is quiet). */
const heard = new Set<string>();
import { StatLine, TeamTag } from './Hub';
import type { Commit } from './Career';

/** A number that counts up to its value when it first shows (instant under reduced motion). */
export function useCountUp(target: number, ms = 1100): number {
  const [v, setV] = useState(() => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? target : 0));
  useEffect(() => {
    if (v === target) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const f = Math.min(1, (now - t0) / ms);
      setV(Math.round(target * (1 - (1 - f) ** 3)));
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);   // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/**
 * After a game, laid out like a sports app's game page: the actions at the top (no scrolling to move on), the
 * scoreboard, your game and what it earned you, the team stats side by side, the scoring plays, and the full box
 * score folded away for whoever wants it.
 */
export function Postgame({ c, gameId, onContinue }: { c: Career; gameId: string; onContinue: (upgrade?: boolean) => void }) {
  const box = c.boxes[gameId];
  const g = gameOf(c, gameId);
  const teams = useMemo(() => liveTeams(c, g), [gameId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const L = c.last!;
  const won = !!box && box.final[0] > box.final[1];
  const xp = useCountUp(L?.total ?? 0);
  useEffect(() => {
    const key = `${c.you.pid}:${c.season?.year ?? ''}:${gameId}`;
    if (!box || heard.has(key)) return;
    heard.add(key);
    audio.play(won ? 'win' : 'loss');
  }, [gameId]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!box) return null;
  const line = box.players[c.you.pid] ?? {};
  const college = gameId === 'college';
  const st = college ? null : standings(c.league.teams, c.season.games);
  const tie = box.final[0] === box.final[1];
  const res = won ? 'Win' : tie ? 'Tie' : 'Loss';
  const label = `${college ? 'Bowl game' : WEEK_NAME(g.week)} · Final${box.ot ? ' (OT)' : ''}`;
  const spendable = !college && c.you.sp > 0;
  const risks = L ? L.xp.filter((x) => x.label.startsWith('Risk paid off')) : [];
  return (
    <div className="cr-page pg">
      <div className="pg-bar">
        <span className={`pg-res ${won ? 'win' : tie ? '' : 'loss'}`}>{res}</span>
        <span className="pg-label">{label}</span>
        {spendable && <button className="btn" onClick={() => onContinue(true)}>Spend {c.you.sp} point{c.you.sp === 1 ? '' : 's'}</button>}
        <button className="btn primary" onClick={() => onContinue()} autoFocus>{college ? 'On to draft night' : 'Continue'}</button>
      </div>

      <section className="cr-card pg-score">
        {([0, 1] as const).map((s) => {
          const t = teams[s], r = st?.[t.id];
          const lead = box.final[s] > box.final[1 - s];
          return (
            <div key={s} className={`pg-team${s ? ' right' : ''}${lead || tie ? '' : ' dim'}`} style={{ ['--tc' as string]: t.color, ['--tc2' as string]: t.color2 }}>
              <span className="cr-chip big">{t.id}</span>
              <span className="pg-tn"><b>{t.name}</b><small>{t.city}{r ? ` · ${r.w}-${r.l}${r.t ? `-${r.t}` : ''}` : ''}</small></span>
              <span className="pg-pts">{box.final[s]}</span>
            </div>
          );
        })}
        <div className="pg-mid"><b>Final</b>{box.ot && <small>OT</small>}</div>
        <table className="pg-lines" aria-label="Score by quarter">
          <thead><tr><th />{box.byQ[0].map((_, i) => <th key={i}>{i < 4 ? i + 1 : 'OT'}</th>)}<th>T</th></tr></thead>
          <tbody>{([0, 1] as const).map((s) => <tr key={s}><td>{teams[s].id}</td>{box.byQ[s].map((p, i) => <td key={i}>{p}</td>)}<td><b>{box.final[s]}</b></td></tr>)}</tbody>
        </table>
      </section>

      {L && (
        <section className="cr-card pg-you">
          <div className="pg-you-head">
            <h3>Your game</h3>
            <span className="pg-xp">+{xp}<small>XP</small></span>
          </div>
          <StatLine l={line} />
          {(L.levelUp || (L.boosts?.length ?? 0) > 0 || (L.ovr1 ?? 0) > (L.ovr0 ?? 0) || L.sp > 0) && (
            <div className="pg-gains">
              {L.levelUp && <span className="pg-gain lv">Level {L.levelUp}!</span>}
              {(L.ovr1 ?? 0) > (L.ovr0 ?? 0) && <span className="pg-gain ovr">Overall {L.ovr0} → {L.ovr1}</span>}
              {L.boosts?.map((b, i) => <span key={i} className="pg-gain boost" style={{ animationDelay: `${0.3 + i * 0.15}s` }}>{b.label}</span>)}
              {L.sp > 0 && <span className="pg-gain sp">+{L.sp} skill point{L.sp === 1 ? '' : 's'}</span>}
            </div>
          )}
          {risks.length > 0 && (
            <ul className="pg-risks">{risks.map((x, i) => <li key={i}><b>{x.label.replace('Risk paid off: ', '')}</b><em>+{x.xp} XP</em></li>)}</ul>
          )}
          <details className="pg-fold">
            <summary>XP breakdown</summary>
            <ul className="cr-xplist">{L.xp.map((x, i) => <li key={i} className={x.xp < 0 ? 'neg' : ''}><span>{x.label}</span><b>{x.xp > 0 ? '+' : ''}{x.xp}</b></li>)}</ul>
          </details>
          {college && c.college.result && <p className="cr-stock">Draft stock: <b>{c.college.result.stock}</b>/100</p>}
        </section>
      )}

      <TeamStats box={box} teams={teams} />

      {box.scoring.length > 0 && (
        <section className="cr-card">
          <h3>Scoring</h3>
          <ol className="pg-scoring">{box.scoring.map((p, i) => (
            <li key={i} style={{ ['--tc' as string]: teams[p.team].color }}>
              <span className="pg-q">{p.q > 4 ? 'OT' : `Q${p.q}`}<small>{mmss(p.t)}</small></span>
              <span className="pg-play"><b>{teams[p.team].id}</b> {p.text}</span>
              <span className="pg-sc">{p.score[0]}-{p.score[1]}</span>
            </li>
          ))}</ol>
        </section>
      )}

      <details className="pg-box">
        <summary>Full box score <small>passing, rushing, receiving, defense</small></summary>
        <BoxScore box={box} teams={teams} c={c} />
      </details>
    </div>
  );
}

/** The two teams' stats side by side, each row with a bar split by share (for turnovers, fewer is better). */
function TeamStats({ box, teams }: { box: Box; teams: [TeamInfo, TeamInfo] }) {
  const T = box.team;
  const frac = (a: number, b: number) => `${a}/${b}`;
  const rows: { k: string; a: number; b: number; la?: string; lb?: string; low?: boolean }[] = [
    { k: 'Total yards', a: T[0].yds, b: T[1].yds },
    { k: 'Passing', a: T[0].py, b: T[1].py },
    { k: 'Rushing', a: T[0].ry, b: T[1].ry },
    { k: 'First downs', a: T[0].fd, b: T[1].fd },
    { k: 'Third down', a: T[0].att3 ? T[0].td3 / T[0].att3 : 0, b: T[1].att3 ? T[1].td3 / T[1].att3 : 0, la: frac(T[0].td3, T[0].att3), lb: frac(T[1].td3, T[1].att3) },
    { k: 'Turnovers', a: T[0].to, b: T[1].to, low: true },
    { k: 'Sacks', a: T[0].sacks, b: T[1].sacks },
    { k: 'Plays', a: T[0].plays, b: T[1].plays },
    { k: 'Possession', a: T[0].top, b: T[1].top, la: mmss(T[0].top), lb: mmss(T[1].top) },
  ];
  return (
    <section className="cr-card pg-stats" style={{ ['--a' as string]: teams[0].color, ['--b' as string]: teams[1].color }}>
      <div className="pg-stats-head"><span>{teams[0].id}</span><h3>Team stats</h3><span>{teams[1].id}</span></div>
      {rows.map(({ k, a, b, la, lb, low }) => {
        const sum = a + b;
        const share = sum ? a / sum : 0.5;
        const better = a === b ? -1 : (low ? a < b : a > b) ? 0 : 1;
        return (
          <div key={k} className="pg-row">
            <b className={better === 0 ? 'lead' : ''}>{la ?? a}</b>
            <div className="pg-mid-col"><span>{k}</span><i><em style={{ width: `${share * 100}%` }} /></i></div>
            <b className={better === 1 ? 'lead' : ''}>{lb ?? b}</b>
          </div>
        );
      })}
    </section>
  );
}

export function BoxScore({ box, teams, c }: { box: Box; teams: [TeamInfo, TeamInfo]; c: Career }) {
  const nm = (side: 0 | 1, slot: string) => teams[side].players[slot]?.name ?? slot;
  const pid = (side: 0 | 1, slot: string) => (c.league.teams.find((t) => t.id === teams[side].id)?.roster[slot]) ?? (side === 0 && slot === 'QB' ? c.you.pid : `col${side}:${slot}`);
  const L = (side: 0 | 1, slot: string): Line => box.players[pid(side, slot)] ?? {};
  const rows = (side: 0 | 1, slots: string[], f: (l: Line) => (string | number)[], keep: (l: Line) => boolean) =>
    slots.filter((s) => keep(L(side, s))).map((s) => <tr key={s}><td>{nm(side, s)} <span className="muted small">{POS_LABEL[s]}</span></td>{f(L(side, s)).map((v, i) => <td key={i} className="num">{v}</td>)}</tr>);
  const quarters = Math.max(box.byQ[0].length, 4);
  const [side, setSide] = useState<0 | 1>(0);
  return (
    <section className="cr-card cr-box">
      <h3>Box score</h3>
      <table className="cr-t cr-lines">
        <thead><tr><th />{Array.from({ length: quarters }, (_, i) => <th key={i} className="num">{i < 4 ? i + 1 : 'OT'}</th>)}<th className="num">T</th></tr></thead>
        <tbody>{([0, 1] as const).map((s) => <tr key={s}><td>{teams[s].id}</td>{Array.from({ length: quarters }, (_, i) => <td key={i} className="num">{box.byQ[s][i] ?? 0}</td>)}<td className="num"><b>{box.final[s]}</b></td></tr>)}</tbody>
      </table>
      <div className="cr-seg" role="tablist" aria-label="Team">
        {([0, 1] as const).map((s) => <button key={s} role="tab" aria-selected={side === s} className={side === s ? 'on' : ''} onClick={() => setSide(s)}>{teams[s].city} {teams[s].name}</button>)}
      </div>
      <div className="cr-box-cols">
        {([side] as const).map((s) => (
          <div key={s}>
            <h4 className="k">{teams[s].city} {teams[s].name}</h4>
            <p className="small muted">{box.team[s].yds} yards ({box.team[s].py} pass, {box.team[s].ry} rush) · {box.team[s].fd} first downs · {box.team[s].to} turnovers · 3rd down {box.team[s].td3}/{box.team[s].att3}</p>
            <table className="cr-t"><thead><tr><th>Passing</th><th className="num">C/A</th><th className="num">Yds</th><th className="num">TD</th><th className="num">INT</th></tr></thead>
              <tbody>{rows(s, ['QB', 'WR2'], (l) => [`${l.pc ?? 0}/${l.pa ?? 0}`, l.py ?? 0, l.ptd ?? 0, l.pint ?? 0], (l) => !!l.pa)}</tbody></table>
            <table className="cr-t"><thead><tr><th>Rushing</th><th className="num">Car</th><th className="num">Yds</th><th className="num">TD</th></tr></thead>
              <tbody>{rows(s, ['RB', 'QB', 'WR2'], (l) => [l.ra ?? 0, l.ry ?? 0, l.rtd ?? 0], (l) => !!l.ra)}</tbody></table>
            <table className="cr-t"><thead><tr><th>Receiving</th><th className="num">Rec</th><th className="num">Yds</th><th className="num">TD</th></tr></thead>
              <tbody>{rows(s, ['WR1', 'WR2', 'WR3', 'TE', 'RB'], (l) => [`${l.rec ?? 0}/${l.tgt ?? 0}`, l.rcy ?? 0, l.rctd ?? 0], (l) => !!l.tgt)}</tbody></table>
            <table className="cr-t"><thead><tr><th>Defense</th><th className="num">Tkl</th><th className="num">Sck</th><th className="num">INT</th></tr></thead>
              <tbody>{rows(s, ['EDGE1', 'DL1', 'DL2', 'EDGE2', 'LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2'].sort((a, b) => (L(s, b).tk ?? 0) + (L(s, b).sck ?? 0) * 3 + (L(s, b).int ?? 0) * 3 - (L(s, a).tk ?? 0) - (L(s, a).sck ?? 0) * 3 - (L(s, a).int ?? 0) * 3).slice(0, 6), (l) => [l.tk ?? 0, l.sck ?? 0, l.int ?? 0], (l) => !!(l.tk || l.sck || l.int))}</tbody></table>
          </div>
        ))}
      </div>
      {box.scoring.length > 0 && (
        <>
          <h4 className="k">Scoring</h4>
          <ol className="cr-scoring">{box.scoring.map((p, i) => <li key={i}><span className="muted">Q{p.q > 4 ? 'OT' : p.q}</span> {p.text} <b>{p.score[0]}-{p.score[1]}</b></li>)}</ol>
        </>
      )}
    </section>
  );
}

export function SeasonDone({ c, onOffseason }: { c: Career; onOffseason: () => void }) {
  const me = youPlayer(c);
  const champ = c.season.champion ? teamById(c.league, c.season.champion) : null;
  const won = champ?.id === me.team;
  const st = standings(c.league.teams, c.season.games)[me.team!];
  const line = c.season.stats[c.you.pid] ?? {};
  const [msg, setMsg] = useState<string | null>(null);
  const share = async () => {
    const team = teamById(c.league, me.team!);
    const cv = await careerCard({
      name: c.you.name, number: me.number, arch: ARCH[c.you.arch].name, year: c.season.year, team: `${team.city} ${team.name}`, color: team.color, color2: team.color2,
      record: `${st.w}-${st.l}${st.t ? `-${st.t}` : ''}`, line, ovr: me.rating, headline: won ? `${FINAL_NAME} champions` : `${c.season.year} season`, site: location.host || 'nfl-2min-drill.com',
    });
    const blob = await toBlob(cv);
    if (!blob) return;
    const text = `${won ? `I won the ${FINAL_NAME}` : `My ${c.season.year} season`} as ${c.you.name}: ${line.py ?? 0} yards, ${line.ptd ?? 0} TD. Build your own QB: https://nfl-2min-drill.com/#career`;
    const r = await shareCard(blob, text);
    if (r === 'unsupported') { download(blob, 'the-4th-call-career.png'); setMsg('Saved the image.'); }
  };
  return (
    <div className="cr-page">
      <section className={`cr-card cr-final ${won ? 'win' : ''}`}>
        <div className="eyebrow">{c.season.year} season · Complete</div>
        <h1>{won ? <>Champions</> : champ ? <>{champ.city} win it all</> : 'Season over'}</h1>
        {won ? <p className="cr-lede">{c.you.name} and the {teamById(c.league, me.team!).name} win the {FINAL_NAME}.</p> : null}
        <p className="muted">You went {st ? `${st.w}-${st.l}${st.t ? `-${st.t}` : ''}` : ''}. {line.py ?? 0} yards, {line.ptd ?? 0} TD, {line.pint ?? 0} INT, {passerRating(line)} rating.</p>
        <div className="row">
          <button className="btn primary big" onClick={onOffseason}>Awards and the offseason</button>
          <button className="btn" onClick={share}>Share your season</button>
        </div>
        {msg && <p className="muted small">{msg}</p>}
      </section>
    </div>
  );
}

export function Offseason({ c, commit, onNext, retire }: { c: Career; commit: Commit; onNext: () => void; retire?: ReactNode }) {
  const me = youPlayer(c);
  const aw = c.season.awards ?? [];
  const off = offers(c);
  const free = !!c.you.contract && c.you.contract.years === 0;
  const targets = c.you.wantsTrade ? tradeTargets(c) : [];
  const last = c.history[c.history.length - 1];
  return (
    <div className="cr-page">
      <section className="cr-card">
        <div className="eyebrow">{c.season.year} awards</div>
        <h1>The offseason</h1>
        <ul className="cr-awards">
          {aw.filter((a) => a.key !== 'pro' || a.you).map((a, i) => { const p = a.player ? c.league.players[a.player] : null; return (
            <li key={i} className={a.you ? 'you' : ''}><span className="k">{a.name}</span><b>{p?.name}</b><em>{p ? `${POS_LABEL[p.slot]} · ${a.team ?? ''}` : ''}</em></li>
          ); })}
        </ul>
        {last && <p className="muted">Your season: {last.w}-{last.l}{last.playoff ? `, ${last.playoff.toLowerCase()}` : ', no playoffs'}. {last.awards.length ? `Honors: ${last.awards.join(', ')}.` : ''}</p>}
      </section>
      <section className="cr-card">
        <h3>A year older</h3>
        <p className="muted">{c.you.name} is {me.age}. Around the league, young players improved, veterans slowed down, some retired, and rookies and free agents filled the gaps. {me.age >= 33 ? 'Your attributes can start to slip from here.' : 'You only get better the way you always have: by playing.'}</p>
        <ul className="cr-news">{c.news.filter((n) => n.year === c.season.year + 1).slice(0, 8).map((n, i) => <li key={i}>{n.text}</li>)}</ul>
      </section>
      {(free || targets.length > 0) ? (
        <section className="cr-card">
          <h3>{free ? 'Free agency: your contract is up' : 'Your trade request'}</h3>
          <p className="muted small">{free ? 'Teams that want you, and what they offer. Your old team is first.' : 'Teams that would trade their quarterback for you.'}</p>
          <div className="cr-offers">
            {(free ? off : targets.map((t) => ({ team: t, years: c.you.contract!.years, salary: c.you.contract!.salary }))).map((o) => {
              const t = teamById(c.league, o.team), info = teamInfo(c.league, t);
              return (
                <button key={o.team} className="cr-offer" onClick={() => commit((x) => signWith(x, o.team, o.years, o.salary, !free))}>
                  <TeamTag t={t} /><span>{info.rat.ovr} OVR · {info.rat.off} off / {info.rat.def} def</span><b>{o.years} yrs · ${o.salary}m/yr</b>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="cr-card">
          <h3>Your contract</h3>
          <p className="muted">{c.you.contract ? `${c.you.contract.years} year${c.you.contract.years === 1 ? '' : 's'} left at $${c.you.contract.salary}m a year with ${teamById(c.league, me.team!).city}.` : ''}</p>
          <button className="btn ghost small" onClick={() => commit((x) => { x.you.wantsTrade = true; })}>Request a trade</button>
        </section>
      )}
      {retire}
      <button className="btn primary big" disabled={free} onClick={onNext}>{free ? 'Sign somewhere to continue' : `Start the ${c.season.year + 1} season`}</button>
      <p className="muted small">Level {levelOf(c.you.xp)} · {c.you.sp} skill point{c.you.sp === 1 ? '' : 's'} to spend (on the Player tab once the season starts).</p>
    </div>
  );
}

export { COLLEGES };
