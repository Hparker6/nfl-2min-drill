/** Career screens between games: draft night, the postgame, the season's end, and the offseason. */
import { useEffect, useMemo, useState } from 'react';
import { passerRating, type Box, type Line } from '../../career/box';
import { ARCH, COLLEGES, levelOf, ordinal, youPlayer, type Career } from '../../career/career';
import { FINAL_NAME, teamById, teamInfo } from '../../career/league';
import { offers, signWith, tradeTargets } from '../../career/offseason';
import { liveTeams, gameOf } from '../../career/run';
import { WEEK_NAME } from '../../career/season';
import { standings } from '../../career/standings';
import { POS_LABEL } from '../../engine/data';
import type { TeamInfo } from '../../engine/types';
import { download, shareCard, toBlob } from '../../game/shareImage';
import { careerCard } from '../../career/card';
import { StatLine, TeamTag } from './Hub';
import type { Commit } from './Career';

export function DraftNight({ c, commit, onDone }: { c: Career; commit: Commit; onDone: () => void }) {
  const d = c.draft!;
  const [shown, setShown] = useState(d.revealed);
  const stock = c.college.result?.stock ?? 50;
  const range = stock >= 80 ? 'a top-10 pick' : stock >= 60 ? 'the middle of the first round' : stock >= 40 ? 'late first round' : 'the second round';
  const done = shown >= d.picks.length;
  useEffect(() => {
    if (done) { commit((x) => { if (x.draft) x.draft.revealed = x.draft.picks.length; }); return; }
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 900 : 420);
    return () => clearTimeout(t);
  }, [shown, done]);   // eslint-disable-line react-hooks/exhaustive-deps
  const mine = d.picks[d.picks.length - 1];
  const team = teamById(c.league, mine.team);
  return (
    <div className="cr-page">
      <section className="cr-card">
        <div className="eyebrow">{d.year} draft · Round {d.yourPick <= 32 ? 1 : 2}</div>
        <h1>Draft night</h1>
        <p className="cr-lede">Your bowl game: {c.college.result ? `${c.college.result.score[0]}-${c.college.result.score[1]}, ${c.college.result.line.pc ?? 0}/${c.college.result.line.pa ?? 0} for ${c.college.result.line.py ?? 0} yards, ${c.college.result.line.ptd ?? 0} TD, ${c.college.result.line.pint ?? 0} INT` : 'in the books'}. Draft stock <b>{stock}</b>/100: the scouts have you going in {range}.</p>
        {!done && <button className="btn ghost small" onClick={() => setShown(d.picks.length)}>Skip to your pick</button>}
      </section>
      {done ? (
        <section className="cr-card cr-drafted" style={{ ['--tc' as string]: team.color, ['--tc2' as string]: team.color2 }}>
          <span className="cr-chip big">{team.id}</span>
          <div className="eyebrow">With the {ordinal(d.yourPick)} pick</div>
          <h2>The {team.city} {team.name} select {c.you.name}, quarterback, {c.you.college}</h2>
          <p>{teamInfo(c.league, team).rat.ovr} overall team. You start from day one. Rookie deal: 4 years.</p>
          <button className="btn primary big" onClick={onDone}>Start your rookie season</button>
        </section>
      ) : null}
      <section className="cr-card">
        <h3>The board</h3>
        <ol className="cr-board">
          {d.picks.slice(0, shown).map((p) => { const t = teamById(c.league, p.team); return (
            <li key={p.pick} className={p.you ? 'you' : ''}><span className="num">{p.pick}</span><TeamTag t={t} /><b>{p.name}</b><em>{p.pos} · {p.college}</em></li>
          ); }).reverse()}
          {!done && <li className="cr-clock"><span className="num">{shown + 1}</span><TeamTag t={teamById(c.league, d.picks[shown].team)} /><b>On the clock…</b></li>}
        </ol>
      </section>
    </div>
  );
}

export function Postgame({ c, gameId, onContinue }: { c: Career; gameId: string; onContinue: () => void }) {
  const box = c.boxes[gameId];
  const g = gameOf(c, gameId);
  const teams = useMemo(() => liveTeams(c, g), [gameId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const L = c.last!;
  if (!box) return null;
  const win = box.final[0] > box.final[1];
  const line = box.players[c.you.pid] ?? {};
  const college = gameId === 'college';
  return (
    <div className="cr-page">
      <section className={`cr-card cr-final ${win ? 'win' : 'loss'}`}>
        <div className="eyebrow">{college ? 'Bowl game' : WEEK_NAME(g.week)} · Final{box.ot ? ' (OT)' : ''}</div>
        <h1>{win ? 'Win' : box.final[0] === box.final[1] ? 'Tie' : 'Loss'} <span>{box.final[0]}-{box.final[1]}</span></h1>
        <p className="muted">{teams[0].city} {teams[0].name} {win ? 'beat' : 'vs'} {teams[1].city} {teams[1].name}</p>
        <StatLine l={line} />
        {college && c.college.result && <p className="cr-stock">Draft stock: <b>{c.college.result.stock}</b>/100</p>}
      </section>
      <section className="cr-card">
        <h3>XP earned <b className="cr-xpt">+{L.total}</b></h3>
        <ul className="cr-xplist">{L.xp.map((x, i) => <li key={i} className={x.xp < 0 ? 'neg' : ''}><span>{x.label}</span><b>{x.xp > 0 ? '+' : ''}{x.xp}</b></li>)}</ul>
        {(L.sp > 0 || L.levelUp) && <p className="cr-levelup">{L.levelUp ? `Level ${L.levelUp}! ` : ''}{L.sp ? `+${L.sp} skill point${L.sp === 1 ? '' : 's'} to spend.` : ''}</p>}
      </section>
      <BoxScore box={box} teams={teams} c={c} />
      <button className="btn primary big" onClick={onContinue}>{college ? 'On to draft night' : 'Continue'}</button>
    </div>
  );
}

export function BoxScore({ box, teams, c }: { box: Box; teams: [TeamInfo, TeamInfo]; c: Career }) {
  const nm = (side: 0 | 1, slot: string) => teams[side].players[slot]?.name ?? slot;
  const pid = (side: 0 | 1, slot: string) => (c.league.teams.find((t) => t.id === teams[side].id)?.roster[slot]) ?? (side === 0 && slot === 'QB' ? c.you.pid : `col${side}:${slot}`);
  const L = (side: 0 | 1, slot: string): Line => box.players[pid(side, slot)] ?? {};
  const rows = (side: 0 | 1, slots: string[], f: (l: Line) => (string | number)[], keep: (l: Line) => boolean) =>
    slots.filter((s) => keep(L(side, s))).map((s) => <tr key={s}><td>{nm(side, s)} <span className="muted small">{POS_LABEL[s]}</span></td>{f(L(side, s)).map((v, i) => <td key={i} className="num">{v}</td>)}</tr>);
  const quarters = Math.max(box.byQ[0].length, 4);
  return (
    <section className="cr-card cr-box">
      <h3>Box score</h3>
      <table className="cr-t cr-lines">
        <thead><tr><th />{Array.from({ length: quarters }, (_, i) => <th key={i} className="num">{i < 4 ? i + 1 : 'OT'}</th>)}<th className="num">T</th></tr></thead>
        <tbody>{([0, 1] as const).map((s) => <tr key={s}><td>{teams[s].id}</td>{Array.from({ length: quarters }, (_, i) => <td key={i} className="num">{box.byQ[s][i] ?? 0}</td>)}<td className="num"><b>{box.final[s]}</b></td></tr>)}</tbody>
      </table>
      <div className="cr-box-cols">
        {([0, 1] as const).map((s) => (
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
              <tbody>{rows(s, ['EDGE1', 'DL1', 'DL2', 'EDGE2', 'LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2'], (l) => [l.tk ?? 0, l.sck ?? 0, l.int ?? 0], (l) => !!(l.tk || l.sck || l.int))}</tbody></table>
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

export function Offseason({ c, commit, onNext }: { c: Career; commit: Commit; onNext: () => void }) {
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
      <button className="btn primary big" disabled={free} onClick={onNext}>{free ? 'Sign somewhere to continue' : `Start the ${c.season.year + 1} season`}</button>
      <p className="muted small">Level {levelOf(c.you.xp)} · {c.you.sp} skill point{c.you.sp === 1 ? '' : 's'} to spend (on the Player tab once the season starts).</p>
    </div>
  );
}

export { COLLEGES };
