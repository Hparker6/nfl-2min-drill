/** The season hub: your next game, your quarterback, the league (schedule, standings, leaders, teams, playoffs). */
import { useMemo, useState } from 'react';
import { passerRating, type Line } from '../../career/box';
import {
  ABILITIES, ARCH, attrCost, buyAbility, levelOf, ordinal, upgrade, xpForLevel, XP_PER_SP, yourGameThisWeek, yourGames, youPlayer,
  type Ability, type Career,
} from '../../career/career';
import { CONF_NAME, DIV_NAME, FINAL_NAME, LEAGUE_NAME, teamById, teamInfo } from '../../career/league';
import { tradeTargets, signWith } from '../../career/offseason';
import { race } from '../../career/awards';
import { gameWeather, leaders, REG_WEEKS, WEEK_NAME, statValue, alive } from '../../career/season';
import { picture, seeds, standings } from '../../career/standings';
import type { CTeam, Game, StandingRow } from '../../career/types';
import { WEATHER } from '../../engine/sim';
import { POS_LABEL } from '../../engine/data';
import { PlayButtons, type Commit } from './Career';
import { LegacyTab } from './Legacy';
import { editionShown } from '../../game/edition';

type Tab = 'home' | 'schedule' | 'standings' | 'leaders' | 'team' | 'player' | 'playoffs' | 'legacy';

interface Props {
  c: Career; commit: Commit;
  onPlay: (m: 'moments' | 'full' | 'sim') => void; onBye: () => void; onRetire: () => void; onExport: () => void;
  /** the career slots (Coach's Edition shown) */
  onSlots?: () => void;
  initialTab?: 'home' | 'player';
}

export function Hub({ c, commit, onPlay, onBye, onRetire, onExport, onSlots, initialTab }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'home');
  const [settings, setSettings] = useState(false);
  const me = youPlayer(c);
  const team = teamById(c.league, me.team!);
  const pic = useMemo(() => picture(c.league.teams, c.season.games, c.seed), [c.season.games]);
  const rec = pic[team.id];
  const tabs: [Tab, string][] = [['home', 'Home'], ['player', 'Player'], ['schedule', 'Schedule'], ['standings', 'Standings'], ['leaders', 'Leaders'], ['team', 'Team']];
  if (c.season.week > REG_WEEKS) tabs.splice(1, 0, ['playoffs', 'Playoffs']);
  if (editionShown()) tabs.push(['legacy', 'Legacy']);
  return (
    <div className="cr-page cr-hub">
      <header className="cr-head" style={{ ['--tc' as string]: team.color, ['--tc2' as string]: team.color2 }}>
        <div className="cr-head-id">
          <span className="cr-chip">{team.id}</span>
          <div>
            <div className="eyebrow">{c.season.year} · {WEEK_NAME(c.season.week)}</div>
            <h1>{team.city} <em>{team.name}</em></h1>
            <span className="muted">{rec ? `${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ''}` : '0-0'} · {CONF_NAME[team.conf]} {DIV_NAME[team.div]}{rec?.seed && rec.w + rec.l + rec.t > 0 ? ` · ${ordinal(rec.seed)} seed` : ''}</span>
          </div>
        </div>
        <QBBadge c={c} onClick={() => setTab('player')} />
      </header>
      <nav className="cr-tabs" aria-label="Career">
        {tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}{k === 'player' && c.you.sp > 0 ? <i className="cr-dot" aria-label="points to spend" /> : null}</button>)}
        <button className="cr-gear" onClick={() => setSettings(!settings)} aria-label="Career settings" aria-expanded={settings}>⚙</button>
      </nav>
      {settings && <CareerSettings c={c} commit={commit} onRetire={onRetire} onExport={onExport} onSlots={onSlots} onClose={() => setSettings(false)} />}
      {tab === 'home' && <Home c={c} commit={commit} pic={pic} onPlay={onPlay} onBye={onBye} go={setTab} />}
      {tab === 'player' && <PlayerTab c={c} commit={commit} />}
      {tab === 'schedule' && <Schedule c={c} />}
      {tab === 'standings' && <Standings c={c} pic={pic} />}
      {tab === 'leaders' && <Leaders c={c} />}
      {tab === 'team' && <TeamTab c={c} />}
      {tab === 'playoffs' && <Bracket c={c} />}
      {tab === 'legacy' && <LegacyTab c={c} />}
    </div>
  );
}

function QBBadge({ c, onClick }: { c: Career; onClick: () => void }) {
  const me = youPlayer(c);
  const lv = levelOf(c.you.xp);
  const a = xpForLevel(lv), b = xpForLevel(lv + 1);
  return (
    <button className="cr-qb" onClick={onClick} aria-label="Your quarterback">
      <span className="cr-ovr"><b>{me.rating}</b><small>OVR</small></span>
      <span className="cr-qb-id">
        <b>#{me.number} {c.you.name}</b>
        <small>{ARCH[c.you.arch].name} · Level {lv}{c.you.sp ? ` · ${c.you.sp} point${c.you.sp === 1 ? '' : 's'} to spend` : ''}</small>
        <span className="cr-xp" aria-label={`${c.you.xp - a} of ${b - a} XP to the next level`}><i style={{ width: `${((c.you.xp - a) / (b - a)) * 100}%` }} /></span>
      </span>
    </button>
  );
}

const rec = (r?: StandingRow) => (r ? `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}` : '0-0');

function Home({ c, commit, pic, onPlay, onBye, go }: { c: Career; commit: Commit; pic: Record<string, StandingRow>; onPlay: Props['onPlay']; onBye: () => void; go: (t: Tab) => void }) {
  const me = youPlayer(c);
  const g = yourGameThisWeek(c);
  const team = teamById(c.league, me.team!);
  const div = c.league.teams.filter((t) => t.conf === team.conf && t.div === team.div).sort((a, b) => (pic[b.id]?.pct ?? 0) - (pic[a.id]?.pct ?? 0));
  const mvp = useMemo(() => race(c.league, c.season, c.history.length ? 'mvp' : 'oroy'), [c.season.games]);
  const eliminated = c.season.week > REG_WEEKS && !g && !alive(c.season, team.id);   // a top seed's wild-card bye is not elimination
  const targets = c.you.wantsTrade && c.season.week <= 9 ? tradeTargets(c) : [];
  return (
    <div className="cr-grid">
      <section className="cr-card cr-next">
        {g ? <NextGame c={c} g={g} pic={pic} onPlay={onPlay} />
          : eliminated ? (
            <><div className="eyebrow">{WEEK_NAME(c.season.week)}</div><h2>Your season is over</h2><p className="muted">Watch the rest of the playoffs play out.</p><button className="btn primary big" onClick={onBye}>Sim {WEEK_NAME(c.season.week)}</button></>
          ) : (
            <><div className="eyebrow">{WEEK_NAME(c.season.week)}</div><h2>Bye week</h2><p className="muted">No game this week. Rest up, spend your points.</p><button className="btn primary big" onClick={onBye}>Sim the week</button></>
          )}
      </section>
      <section className="cr-card">
        <h3>This week's goals</h3>
        <ul className="cr-goals">
          {c.goals.map((x) => <li key={x.key} className={x.done ? 'done' : ''}><span>{x.text}</span><b>+{x.xp} XP</b></li>)}
        </ul>
        {c.you.sp > 0 && <button className="btn" onClick={() => go('player')}>Spend {c.you.sp} skill point{c.you.sp === 1 ? '' : 's'}</button>}
      </section>
      <section className="cr-card">
        <h3>{CONF_NAME[team.conf]} {DIV_NAME[team.div]}</h3>
        <table className="cr-t"><tbody>
          {div.map((t) => <tr key={t.id} className={t.id === team.id ? 'you' : ''}><td><TeamTag t={t} /></td><td className="num">{rec(pic[t.id])}</td><td className="num muted">{pic[t.id]?.clinch ?? ''}</td></tr>)}
        </tbody></table>
        <button className="btn ghost small" onClick={() => go('standings')}>All standings</button>
      </section>
      <section className="cr-card">
        <h3>{c.history.length ? 'MVP race' : 'Rookie of the Year race'}</h3>
        <ol className="cr-race">
          {mvp.map((r) => { const p = c.league.players[r.id]; return <li key={r.id} className={r.id === c.you.pid ? 'you' : ''}><span>{p.name}</span><em>{POS_LABEL[p.slot]} · {p.team}</em><b>{r.v}</b></li>; })}
          {!mvp.length && <li className="muted">After week 1.</li>}
        </ol>
      </section>
      {targets.length > 0 && (
        <section className="cr-card cr-trade">
          <h3>Trade request</h3>
          <p className="muted small">Teams that would trade their quarterback for you before the deadline (after week 9). Your contract comes with you.</p>
          <div className="cr-list">
            {targets.slice(0, 6).map((id) => { const t = teamById(c.league, id); const r = pic[id]; return (
              <button key={id} className="btn" onClick={() => { if (confirm(`Trade to ${t.city}? Their quarterback goes to your team.`)) commit((x) => signWith(x, id, x.you.contract!.years, x.you.contract!.salary, true)); }}><TeamTag t={t} /> {rec(r)} · {teamInfo(c.league, t).rat.ovr} OVR</button>
            ); })}
          </div>
          <button className="btn ghost small" onClick={() => commit((x) => { x.you.wantsTrade = false; })}>Withdraw the request</button>
        </section>
      )}
      <section className="cr-card cr-news">
        <h3>Around the league</h3>
        <ul>{c.news.slice(0, 10).map((n, i) => <li key={i} className={`tone-${n.tone ?? 'neutral'}`}>{n.text}</li>)}</ul>
      </section>
    </div>
  );
}

function NextGame({ c, g, pic, onPlay }: { c: Career; g: Game; pic: Record<string, StandingRow>; onPlay: Props['onPlay'] }) {
  const me = youPlayer(c);
  const oppId = g.home === me.team ? g.away : g.home;
  const opp = teamById(c.league, oppId), mine = teamById(c.league, me.team!);
  const oi = teamInfo(c.league, opp), mi = teamInfo(c.league, mine);
  const wx = gameWeather(g.home, g.week, c.seed);
  const site = g.kind === 'final' ? 'Neutral site' : g.home === me.team ? 'Home' : `At ${opp.city}`;
  return (
    <>
      <div className="eyebrow">{WEEK_NAME(g.week)}{g.kind === 'final' ? ` · ${FINAL_NAME}` : ''} · {site}{wx !== 'clear' ? ` · ${WEATHER[wx].name}` : ''}</div>
      <div className="cr-vs">
        <TeamBlock t={mine} r={pic[mine.id]} ovr={mi.rat} />
        <span className="cr-at">{g.home === me.team ? 'vs' : '@'}</span>
        <TeamBlock t={opp} r={pic[opp.id]} ovr={oi.rat} />
      </div>
      <Storylines c={c} g={g} mine={mine} opp={opp} pic={pic} />
      <PlayButtons onPlay={onPlay} />
    </>
  );
}

/** What's at stake this week, in a few short lines: the kind of game, the streaks, the matchup, the record. */
function Storylines({ c, g, mine, opp, pic }: { c: Career; g: Game; mine: CTeam; opp: CTeam; pic: Record<string, StandingRow> }) {
  const lines: string[] = [];
  const streak = (t: CTeam) => {
    const s = pic[t.id]?.streak ?? '';
    const n = Number(s.slice(1));
    return n >= 2 ? (s[0] === 'W' ? `${t.city} has won ${n} straight` : `${t.city} has lost ${n} straight`) : null;
  };
  if (g.kind !== 'reg') lines.push(g.kind === 'final' ? 'Win and you are champions' : 'Playoffs: lose and go home');
  else if (mine.conf === opp.conf && mine.div === opp.div) lines.push('Division game: it counts twice in the standings');
  for (const t of [opp, mine]) { const s = streak(t); if (s) lines.push(s); }
  const defRank = [...c.league.teams].map((t) => ({ id: t.id, d: teamInfo(c.league, t).rat.def })).sort((a, b) => b.d - a.d).findIndex((x) => x.id === opp.id) + 1;
  if (defRank <= 6) lines.push(`${opp.city}'s defense ranks ${ordinal(defRank)} in the league`);
  else if (defRank >= 27) lines.push(`${opp.city}'s defense ranks ${ordinal(defRank)}: a chance to put up numbers`);
  const r = pic[mine.id];
  if (g.kind === 'reg' && r) lines.push(`A win makes it ${r.w + 1}-${r.l}${r.t ? `-${r.t}` : ''}`);
  if (!lines.length) return null;
  return <ul className="cr-story">{lines.slice(0, 3).map((l) => <li key={l}>{l}</li>)}</ul>;
}

function TeamBlock({ t, r, ovr }: { t: CTeam; r?: StandingRow; ovr: { ovr: number; off: number; def: number } }) {
  return (
    <div className="cr-tb" style={{ ['--tc' as string]: t.color, ['--tc2' as string]: t.color2 }}>
      <span className="cr-chip big">{t.id}</span>
      <b>{t.city}</b><span>{t.name} · {rec(r)}</span>
      <span className="cr-grades"><em>OVR <b>{ovr.ovr}</b></em><em>OFF <b>{ovr.off}</b></em><em>DEF <b>{ovr.def}</b></em></span>
    </div>
  );
}

export const TeamTag = ({ t }: { t: CTeam }) => <span className="cr-tag" style={{ ['--tc' as string]: t.color, ['--tc2' as string]: t.color2 }}><i>{t.id}</i>{t.city}</span>;

function PlayerTab({ c, commit }: { c: Career; commit: Commit }) {
  const me = youPlayer(c);
  const line = c.season.stats[c.you.pid] ?? {};
  const lv = levelOf(c.you.xp);
  return (
    <div className="cr-grid">
      <section className="cr-card">
        <h3>Attributes <span className="muted small">{c.you.sp} skill point{c.you.sp === 1 ? '' : 's'} to spend · 1 point per {XP_PER_SP} XP</span></h3>
        <div className="cr-attrs">
          {(['accuracy', 'arm', 'decision', 'mobility'] as const).map((a) => {
            const v = me.attrs[a] ?? 60, cost = attrCost(v);
            return (
              <div key={a} className="cr-attr">
                <span className="k">{a === 'decision' ? 'Decision-making' : a === 'arm' ? 'Arm strength' : a[0].toUpperCase() + a.slice(1)}</span>
                <i><b style={{ width: `${v}%` }} /></i>
                <em>{v}</em>
                <button className="btn" disabled={c.you.sp < cost || v >= 99} onClick={() => commit((x) => { upgrade(x, a); })} aria-label={`Raise ${a} for ${cost} points`}>+1<small>{cost} pt{cost > 1 ? 's' : ''}</small></button>
              </div>
            );
          })}
        </div>
        <p className="muted small">Accuracy: completions. Arm: deep throws. Decision-making: fewer interceptions. Mobility: scrambles and escaping the rush. Overall is their average.</p>
      </section>
      <section className="cr-card">
        <h3>Abilities <span className="muted small">Level {lv}</span></h3>
        <ul className="cr-abil">
          {(Object.keys(ABILITIES) as Ability[]).map((k) => {
            const A = ABILITIES[k], have = c.you.abilities.includes(k), locked = lv < A.level;
            return (
              <li key={k} className={have ? 'have' : locked ? 'locked' : ''}>
                <div><b>{A.name}</b><span>{A.blurb}</span></div>
                {have ? <em>Unlocked</em> : locked ? <em>Level {A.level}</em>
                  : <button className="btn" disabled={c.you.sp < A.cost} onClick={() => commit((x) => { buyAbility(x, k); })}>{A.cost} pts</button>}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="cr-card">
        <h3>{c.season.year} season</h3>
        <StatLine l={line} />
        {c.you.contract && <p className="muted small">Contract: {c.you.contract.years} year{c.you.contract.years === 1 ? '' : 's'} left, ${c.you.contract.salary}m a year.{c.you.drafted ? ` Drafted ${ordinal(c.you.drafted.pick)} overall, ${c.you.drafted.year}.` : ''}</p>}
        {!c.you.wantsTrade && c.season.week <= 9 && <button className="btn ghost small" onClick={() => { if (confirm('Ask for a trade? Teams that want you will show on the home screen until the deadline after week 9.')) commit((x) => { x.you.wantsTrade = true; }); }}>Request a trade</button>}
      </section>
      {c.history.length > 0 && (
        <section className="cr-card cr-wide">
          <h3>Career</h3>
          <table className="cr-t">
            <thead><tr><th>Year</th><th>Team</th><th className="num">W-L</th><th className="num">Yds</th><th className="num">TD</th><th className="num">INT</th><th className="num">Rating</th><th>Honors</th></tr></thead>
            <tbody>{c.history.map((h) => <tr key={h.year}><td>{h.year}</td><td>{h.team}</td><td className="num">{h.w}-{h.l}</td><td className="num">{h.line.py ?? 0}</td><td className="num">{h.line.ptd ?? 0}</td><td className="num">{h.line.pint ?? 0}</td><td className="num">{passerRating(h.line)}</td><td className="small">{[h.playoff, ...h.awards].filter(Boolean).join(' · ')}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

export function StatLine({ l }: { l: Line }) {
  return (
    <div className="cr-statline">
      <span><b>{l.pc ?? 0}/{l.pa ?? 0}</b><small>Comp/Att</small></span>
      <span><b>{(l.py ?? 0).toLocaleString('en-US')}</b><small>Pass yds</small></span>
      <span><b>{l.ptd ?? 0}</b><small>TD</small></span>
      <span><b>{l.pint ?? 0}</b><small>INT</small></span>
      <span><b>{passerRating(l)}</b><small>Rating</small></span>
      <span><b>{l.ry ?? 0}</b><small>Rush yds</small></span>
    </div>
  );
}

/** A game, the way a scores app lists it: both teams, the score (winner bright), the status. */
function GameRow({ c, g, mark }: { c: Career; g: Game; mark?: boolean }) {
  const a = teamById(c.league, g.away), h = teamById(c.league, g.home);
  const done = !!g.score;
  const aw = done && g.score![1] > g.score![0], hw = done && g.score![0] > g.score![1];
  return (
    <div className={`lg-game${mark ? ' you' : ''}`}>
      {([[a, g.score?.[1], aw], [h, g.score?.[0], hw]] as const).map(([t, pts, w], i) => (
        <div key={i} className={`lg-side${done && !w ? ' dim' : ''}`} style={{ ['--tc' as string]: t.color, ['--tc2' as string]: t.color2 }}>
          <i className="lg-chip">{t.id}</i><span>{t.city}</span><b>{done ? pts : ''}</b>
        </div>
      ))}
      <span className="lg-status">{done ? `Final${g.ot ? ' · OT' : ''}` : 'Upcoming'}</span>
    </div>
  );
}

function Schedule({ c }: { c: Career }) {
  const me = youPlayer(c);
  const maxWeek = Math.max(...c.season.games.map((g) => g.week));
  const [week, setWeek] = useState(Math.min(c.season.week, maxWeek));
  const games = c.season.games.filter((g) => g.week === week);
  const mine = yourGames(c);
  const pic = useMemo(() => standings(c.league.teams, c.season.games), [c.season.games]);
  const weeks = [...Array.from({ length: REG_WEEKS }, (_, i) => i + 1), ...mine.filter((g) => g.kind !== 'reg').map((g) => g.week)];
  return (
    <div className="cr-grid lg-two">
      <section className="cr-card">
        <h3>Your schedule</h3>
        <ol className="lg-sched">
          {weeks.map((w) => {
            const g = mine.find((x) => x.week === w);
            if (!g) return <li key={w} className="bye"><span className="lg-wk">{w}</span><span className="muted">Bye week</span></li>;
            const home = g.home === me.team, opp = teamById(c.league, home ? g.away : g.home);
            const us = g.score ? (home ? g.score[0] : g.score[1]) : null, them = g.score ? (home ? g.score[1] : g.score[0]) : null;
            const res = us == null ? '' : us > them! ? 'W' : us < them! ? 'L' : 'T';
            const r = pic[opp.id];
            return (
              <li key={w} className={w === c.season.week ? 'now' : ''} style={{ ['--tc' as string]: opp.color, ['--tc2' as string]: opp.color2 }}>
                <span className="lg-wk">{g.kind === 'reg' ? w : WEEK_NAME(w).replace(' round', '')}</span>
                <span className="lg-at">{home ? 'vs' : '@'}</span>
                <i className="lg-chip">{opp.id}</i>
                <span className="lg-opp"><b>{opp.city}</b><small>{opp.name} · {r ? `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}` : '0-0'}</small></span>
                {res ? <span className={`lg-res r-${res}`}>{res} {us}-{them}{g.ot ? ' OT' : ''}</span> : w === c.season.week ? <span className="lg-res next">This week</span> : <span className="lg-res muted">—</span>}
              </li>
            );
          })}
        </ol>
      </section>
      <section className="cr-card">
        <div className="lg-weekbar">
          <button className="btn ghost small" disabled={week <= 1} onClick={() => setWeek(week - 1)} aria-label="Previous week">‹</button>
          <h3>{WEEK_NAME(week)}</h3>
          <button className="btn ghost small" disabled={week >= maxWeek} onClick={() => setWeek(week + 1)} aria-label="Next week">›</button>
        </div>
        <div className="lg-board">
          {games.length ? games.map((g) => <GameRow key={g.id} c={c} g={g} mark={g.home === me.team || g.away === me.team} />) : <p className="muted">No games this week yet.</p>}
        </div>
      </section>
    </div>
  );
}

function Standings({ c, pic }: { c: Career; pic: Record<string, StandingRow> }) {
  const [view, setView] = useState<'div' | 'conf'>('div');
  const me = youPlayer(c);
  return (
    <div className="cr-stack">
      <div className="cr-seg">
        <button className={view === 'div' ? 'on' : ''} onClick={() => setView('div')}>Divisions</button>
        <button className={view === 'conf' ? 'on' : ''} onClick={() => setView('conf')}>Playoff picture</button>
      </div>
      {view === 'div' ? (
        <div className="lg-divs">
          {([0, 1] as const).map((conf) => (
            <div key={conf} className="cr-stack">
              <h2 className="lg-conf">{CONF_NAME[conf]} Conference</h2>
              {([0, 1, 2, 3] as const).map((div) => {
                const ts = c.league.teams.filter((t) => t.conf === conf && t.div === div).sort((a, b) => (pic[b.id]?.pct ?? 0) - (pic[a.id]?.pct ?? 0) || (pic[a.id]?.seed ?? 99) - (pic[b.id]?.seed ?? 99));
                return (
                  <section key={div} className="cr-card lg-tablecard">
                    <h3>{DIV_NAME[div]}</h3>
                    <StandTable c={c} rows={ts} pic={pic} you={me.team!} />
                  </section>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="lg-divs">
          {([0, 1] as const).map((conf) => {
            const sd = seeds(c.league.teams, c.season.games, conf, c.seed);
            const rest = c.league.teams.filter((t) => t.conf === conf && !sd.includes(t.id)).sort((a, b) => (pic[b.id]?.pct ?? 0) - (pic[a.id]?.pct ?? 0));
            return (
              <section key={conf} className="cr-card lg-tablecard">
                <h3>{CONF_NAME[conf]} Conference</h3>
                <StandTable c={c} rows={sd.map((id) => teamById(c.league, id))} pic={pic} you={me.team!} seeded />
                <div className="lg-cut">In the hunt</div>
                <StandTable c={c} rows={rest} pic={pic} you={me.team!} />
              </section>
            );
          })}
          <p className="muted small cr-wide">z: clinched the 1 seed and the bye · y: clinched the division · x: clinched a playoff spot · e: eliminated. Seven teams per conference make it.</p>
        </div>
      )}
    </div>
  );
}

const pctOf = (r?: StandingRow) => (r && r.w + r.l + r.t ? (r.pct >= 1 ? '1.000' : r.pct.toFixed(3).replace(/^0/, '')) : '.000');

function StandTable({ rows, pic, you, seeded }: { c: Career; rows: CTeam[]; pic: Record<string, StandingRow>; you: string; seeded?: boolean }) {
  return (
    <table className="lg-t">
      <thead><tr>{seeded && <th className="num">#</th>}<th>Team</th><th className="num">W-L</th><th className="num">PCT</th><th className="num hide-sm">Div</th><th className="num hide-sm">PF</th><th className="num hide-sm">PA</th><th className="num">Diff</th><th className="num">Strk</th></tr></thead>
      <tbody>
        {rows.map((t, i) => { const r = pic[t.id]; const diff = (r?.pf ?? 0) - (r?.pa ?? 0); return (
          <tr key={t.id} className={t.id === you ? 'you' : ''} style={{ ['--tc' as string]: t.color, ['--tc2' as string]: t.color2 }}>
            {seeded && <td className="num"><span className="lg-seed">{i + 1}</span></td>}
            <td><span className="lg-team"><i className="lg-chip">{t.id}</i><span>{t.city}</span>{r?.clinch ? <em className={`lg-cl c-${r.clinch}`}>{r.clinch}</em> : null}</span></td>
            <td className="num"><b>{rec(r)}</b></td>
            <td className="num muted">{pctOf(r)}</td>
            <td className="num hide-sm muted">{r ? `${r.divW}-${r.divL}` : '0-0'}</td>
            <td className="num hide-sm">{r?.pf ?? 0}</td>
            <td className="num hide-sm">{r?.pa ?? 0}</td>
            <td className={`num ${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}`}>{diff > 0 ? `+${diff}` : diff}</td>
            <td className={`num ${r?.streak?.startsWith('W') ? 'pos' : r?.streak?.startsWith('L') ? 'neg' : ''}`}>{r?.streak || '—'}</td>
          </tr>
        ); })}
      </tbody>
    </table>
  );
}

const LEADER_CATS: [string, string, (l: Line) => string][] = [
  ['py', 'Passing yards', (l) => `${l.pc ?? 0}/${l.pa ?? 0} · ${l.ptd ?? 0} TD`],
  ['ptd', 'Passing TD', (l) => `${(l.py ?? 0).toLocaleString('en-US')} yds · ${l.pint ?? 0} INT`],
  ['rating', 'Passer rating', (l) => `${(l.py ?? 0).toLocaleString('en-US')} yds`],
  ['ry', 'Rushing yards', (l) => `${l.ra ?? 0} car · ${l.rtd ?? 0} TD`],
  ['rcy', 'Receiving yards', (l) => `${l.rec ?? 0} rec · ${l.rctd ?? 0} TD`],
  ['rec', 'Receptions', (l) => `${(l.rcy ?? 0).toLocaleString('en-US')} yds`],
  ['tk', 'Tackles', (l) => `${l.tfl ?? 0} TFL`],
  ['sck', 'Sacks', (l) => `${l.tk ?? 0} tackles`],
  ['int', 'Interceptions', (l) => `${l.pd ?? 0} passes defended`],
];

/** League leaders, the way a stats app shows them: a card per stat with its leader up top, and a full list on tap. */
function Leaders({ c }: { c: Career }) {
  const [open, setOpen] = useState<string | null>(null);
  const all = useMemo(() => Object.fromEntries(LEADER_CATS.map(([k]) => [k, leaders(c.league, c.season, k, 400)])), [c.season.games]);   // eslint-disable-line react-hooks/exhaustive-deps
  const fmt = (v: number | null, k: string) => (v == null ? '—' : k === 'rating' ? v.toFixed(1) : v.toLocaleString('en-US'));
  if (!LEADER_CATS.some(([k]) => all[k].length)) return <section className="cr-card"><h3>League leaders</h3><p className="muted">Leaders show after the first week.</p></section>;
  const C = open ? LEADER_CATS.find((x) => x[0] === open)! : null;
  return (
    <div className="cr-stack">
      <div className="ld-grid">
        {LEADER_CATS.map(([k, label, sub]) => {
          const rows = all[k];
          if (!rows.length) return null;
          const top = rows[0], p = c.league.players[top.id], t = p.team ? teamById(c.league, p.team) : null;
          const youAt = rows.findIndex((r) => r.id === c.you.pid);
          return (
            <section key={k} className={`cr-card ld-card${open === k ? ' on' : ''}`} style={t ? { ['--tc' as string]: t.color, ['--tc2' as string]: t.color2 } : undefined}>
              <div className="ld-head"><h3>{label}</h3><button className="btn ghost small" onClick={() => setOpen(open === k ? null : k)}>{open === k ? 'Close' : 'Top 15'}</button></div>
              <div className={`ld-top${top.id === c.you.pid ? ' you' : ''}`}>
                {t && <i className="lg-chip big">{t.id}</i>}
                <span className="ld-who"><b>{p.name}</b><small>{POS_LABEL[p.slot]}{t ? ` · ${t.city}` : ''}</small><small>{sub(top.line)}</small></span>
                <span className="ld-val">{fmt(statValue(top.line, k), k)}</span>
              </div>
              <ol className="ld-list" start={2}>
                {rows.slice(1, 5).map((r, i) => { const q = c.league.players[r.id]; return (
                  <li key={r.id} className={r.id === c.you.pid ? 'you' : ''}><span className="ld-rk">{i + 2}</span><span className="ld-n">{q.name}<small>{q.team ?? ''}</small></span><b>{fmt(statValue(r.line, k), k)}</b></li>
                ); })}
              </ol>
              {youAt >= 5 && <p className="ld-you">You: <b>{ordinal(youAt + 1)}</b> · {fmt(statValue(rows[youAt].line, k), k)}</p>}
            </section>
          );
        })}
      </div>
      {C && (
        <section className="cr-card">
          <h3>{C[1]} <span className="muted small">{c.season.year} regular season · top 15</span></h3>
          <table className="lg-t"><tbody>
            {all[C[0]].slice(0, 15).map((r, i) => { const p = c.league.players[r.id]; const t = p.team ? teamById(c.league, p.team) : null; return (
              <tr key={r.id} className={r.id === c.you.pid ? 'you' : ''} style={t ? { ['--tc' as string]: t.color, ['--tc2' as string]: t.color2 } : undefined}>
                <td className="num muted">{i + 1}</td><td><b>{p.name}</b> <span className="muted small">{POS_LABEL[p.slot]}</span></td><td>{t && <span className="lg-team"><i className="lg-chip">{t.id}</i><span className="hide-sm">{t.city}</span></span>}</td>
                <td className="num"><b>{fmt(statValue(r.line, C[0]), C[0])}</b></td><td className="muted small hide-sm">{C[2](r.line)}</td>
              </tr>
            ); })}
          </tbody></table>
        </section>
      )}
    </div>
  );
}

const UNITS: [string, string[]][] = [
  ['Offense', ['QB', 'RB', 'WR1', 'WR2', 'WR3', 'TE', 'LT', 'LG', 'C', 'RG', 'RT']],
  ['Defense', ['EDGE1', 'DL1', 'DL2', 'EDGE2', 'LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2']],
  ['Special teams', ['K', 'P']],
];
const tier = (v: number) => (v >= 90 ? 'elite' : v >= 82 ? 'good' : v >= 74 ? 'ok' : 'low');

/** A team page: the identity up top, its season, its depth chart by unit, and where it ranks. */
function TeamTab({ c }: { c: Career }) {
  const me = youPlayer(c);
  const [id, setId] = useState(me.team!);
  const t = teamById(c.league, id), info = teamInfo(c.league, t);
  const pic = useMemo(() => standings(c.league.teams, c.season.games), [c.season.games]);
  const ratings = useMemo(() => c.league.teams.map((x) => ({ t: x, r: teamInfo(c.league, x).rat })), [c.league]);
  const rankBy = (k: 'ovr' | 'off' | 'def') => [...ratings].sort((a, b) => b.r[k] - a.r[k]).findIndex((x) => x.t.id === id) + 1;
  // power: ratings, plus results once games are played
  const power = useMemo(() => [...ratings].map((x) => {
    const r = pic[x.t.id], gp = r ? r.w + r.l + r.t : 0;
    return { ...x, rec: r, score: x.r.ovr + (gp ? (r!.pct - 0.5) * 16 + ((r!.pf - r!.pa) / gp) * 0.25 : 0) };
  }).sort((a, b) => b.score - a.score), [ratings, pic]);
  const ts = c.season.teamStats[id];
  const gp = ts?.g ?? 0;
  const r = pic[id];
  const per = (v: number) => (gp ? (v / gp).toFixed(1) : '—');
  const statRank = (f: (x: typeof ts) => number, low = false) => {
    const vals = c.league.teams.map((x) => ({ id: x.id, v: c.season.teamStats[x.id]?.g ? f(c.season.teamStats[x.id]) / c.season.teamStats[x.id].g : 0 }));
    vals.sort((a, b) => (low ? a.v - b.v : b.v - a.v));
    return vals.findIndex((x) => x.id === id) + 1;
  };
  return (
    <div className="cr-stack">
      <section className="cr-card tm-hero" style={{ ['--tc' as string]: t.color, ['--tc2' as string]: t.color2 }}>
        <span className="cr-chip big">{t.id}</span>
        <div className="tm-id">
          <div className="eyebrow">{CONF_NAME[t.conf]} {DIV_NAME[t.div]}{r ? ` · ${rec(r)}` : ''}{r?.seed ? ` · ${ordinal(r.seed)} seed` : ''}</div>
          <h2>{t.city} <em>{t.name}</em></h2>
        </div>
        <label className="tm-pick"><span className="sr-only">Team</span>
          <select value={id} onChange={(e) => setId(e.target.value)}>{[...c.league.teams].sort((a, b) => a.city.localeCompare(b.city)).map((x) => <option key={x.id} value={x.id}>{x.city} {x.name}{x.id === me.team ? ' (you)' : ''}</option>)}</select>
        </label>
        <div className="tm-dials">
          {(['ovr', 'off', 'def'] as const).map((k) => (
            <span key={k} className={`tm-dial t-${tier(info.rat[k])}`}><b>{info.rat[k]}</b><small>{k === 'ovr' ? 'Overall' : k === 'off' ? 'Offense' : 'Defense'}</small><em>{ordinal(rankBy(k))}</em></span>
          ))}
        </div>
      </section>
      {gp > 0 && ts && (
        <section className="cr-card">
          <h3>{c.season.year} season <span className="muted small">per game · league rank</span></h3>
          <div className="tm-tiles">
            <span><b>{per(ts.pts)}</b><small>Points</small><em>{ordinal(statRank((x) => x.pts))}</em></span>
            <span><b>{r ? (r.pa / gp).toFixed(1) : '—'}</b><small>Allowed</small><em>{ordinal([...c.league.teams].map((x) => ({ id: x.id, v: (pic[x.id]?.pa ?? 0) / Math.max(1, (pic[x.id]?.w ?? 0) + (pic[x.id]?.l ?? 0) + (pic[x.id]?.t ?? 0)) })).sort((a, b) => a.v - b.v).findIndex((x) => x.id === id) + 1)}</em></span>
            <span><b>{per(ts.yds)}</b><small>Yards</small><em>{ordinal(statRank((x) => x.yds))}</em></span>
            <span><b>{per(ts.py)}</b><small>Passing</small><em>{ordinal(statRank((x) => x.py))}</em></span>
            <span><b>{per(ts.ry)}</b><small>Rushing</small><em>{ordinal(statRank((x) => x.ry))}</em></span>
            <span><b>{per(ts.to)}</b><small>Turnovers</small><em>{ordinal(statRank((x) => x.to, true))}</em></span>
          </div>
        </section>
      )}
      <div className="cr-grid">
        {UNITS.map(([unit, slots]) => (
          <section key={unit} className="cr-card">
            <h3>{unit}</h3>
            <ul className="tm-depth">
              {slots.map((slot) => { const p = c.league.players[t.roster[slot]]; return p ? (
                <li key={slot} className={p.id === c.you.pid ? 'you' : ''}>
                  <span className="tm-num" style={{ ['--tc' as string]: t.color, ['--tc2' as string]: t.color2 }}>{p.number}</span>
                  <span className="tm-p"><b>{p.name}</b><small>{POS_LABEL[slot]} · age {p.age}{p.exp === 0 ? ' · rookie' : ''}</small></span>
                  <span className={`tm-ovr t-${tier(p.rating)}`}>{p.rating}</span>
                </li>
              ) : null; })}
            </ul>
          </section>
        ))}
      </div>
      <section className="cr-card">
        <h3>Power rankings <span className="muted small">ratings, plus results once games are played</span></h3>
        <ol className="tm-power">
          {power.map((x, i) => (
            <li key={x.t.id} className={`${x.t.id === me.team ? 'you' : ''}${x.t.id === id ? ' sel' : ''}`} style={{ ['--tc' as string]: x.t.color, ['--tc2' as string]: x.t.color2 }}>
              <span className={`tm-rk${i < 3 ? ' top' : ''}`}>{i + 1}</span>
              <button className="tm-pw" onClick={() => setId(x.t.id)}><i className="lg-chip">{x.t.id}</i><span>{x.t.city} <small>{x.t.name}</small></span></button>
              <span className="tm-rec">{rec(x.rec)}</span>
              <span className={`tm-ovr t-${tier(x.r.ovr)}`}>{x.r.ovr}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Bracket({ c }: { c: Career }) {
  const rounds: [string, string][] = [['wc', 'Wild Card'], ['div', 'Divisional'], ['conf', 'Conference'], ['final', FINAL_NAME]];
  const me = youPlayer(c);
  return (
    <div className="cr-bracket">
      {rounds.map(([k, label]) => {
        const gs = c.season.games.filter((g) => g.kind === k);
        return (
          <section key={k} className="cr-round">
            <h3>{label}</h3>
            {gs.length ? gs.map((g) => {
              const a = teamById(c.league, g.away), h = teamById(c.league, g.home);
              const aw = g.score && g.score[1] > g.score[0], hw = g.score && g.score[0] > g.score[1];
              return (
                <div key={g.id} className={`cr-match${g.home === me.team || g.away === me.team ? ' you' : ''}`}>
                  <span className={aw ? 'win' : g.score ? 'lose' : ''}><TeamTag t={a} /><b>{g.score?.[1] ?? ''}</b></span>
                  <span className={hw ? 'win' : g.score ? 'lose' : ''}><TeamTag t={h} /><b>{g.score?.[0] ?? ''}</b></span>
                </div>
              );
            }) : <p className="muted small">To be decided</p>}
          </section>
        );
      })}
      {c.season.champion && <p className="cr-champ">{teamById(c.league, c.season.champion).city} win the {FINAL_NAME}.</p>}
      <p className="muted small">{LEAGUE_NAME} playoffs: seven teams per conference, the 1 seed gets a bye.</p>
    </div>
  );
}

function CareerSettings({ c, commit, onRetire, onExport, onSlots, onClose }: { c: Career; commit: Commit; onRetire: () => void; onExport: () => void; onSlots?: () => void; onClose: () => void }) {
  const S = c.settings;
  return (
    <section className="cr-card cr-settings">
      <h3>Career settings</h3>
      <div className="cr-form">
        <label className="cr-field"><span className="k">Quarter length (full games)</span>
          <select value={S.qLen / 60} onChange={(e) => commit((x) => { x.settings.qLen = Number(e.target.value) * 60; })}>
            {[2, 3, 4, 5, 6, 8, 10, 12].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </label>
        <label className="cr-field"><span className="k">Moments</span>
          <select value={S.moments} onChange={(e) => commit((x) => { x.settings.moments = e.target.value as typeof S.moments; })}>
            <option value="few">Few: the final drive and overtime</option>
            <option value="normal">Normal: plus the end of the half, red zone and big fourth downs</option>
            <option value="lots">Lots: most drives of a close second half</option>
          </select>
        </label>
        <label className="cr-field"><span className="k">Difficulty</span>
          <select value={S.diff} onChange={(e) => commit((x) => { x.settings.diff = e.target.value as typeof S.diff; })}>
            <option value="rookie">Rookie</option><option value="pro">Pro</option><option value="allpro">All-Pro</option>
          </select>
        </label>
        <label className="cr-field"><span className="k">Tracker speed</span>
          <select value={S.speed} onChange={(e) => commit((x) => { x.settings.speed = e.target.value as typeof S.speed; })}>
            <option value="normal">Normal</option><option value="fast">Fast</option>
          </select>
        </label>
      </div>
      <div className="row">
        <button className="btn" onClick={onExport}>Download save file</button>
        {onSlots && <button className="btn" onClick={onSlots}>Your careers</button>}
        <button className="btn ghost" onClick={onClose}>Done</button>
      </div>
      <button className="btn danger" onClick={onRetire}>Delete this career and start over</button>
    </section>
  );
}
