/**
 * Career Legacy screens (Coach's Edition): the record book (a Hub tab), retiring from the offseason, the Hall of Fame
 * ceremony, and the career slots with the Hall of every career that retired.
 */
import { useMemo, useState } from 'react';
import { passerRating } from '../../career/box';
import { ARCH, ordinal, youPlayer, type Career } from '../../career/career';
import { FINAL_NAME, LEAGUE_NAME, teamById } from '../../career/league';
import {
  careerTotals, canRetire, ensureLegacy, GAME_STATS, HOF, legacyScore, mainTeam, RECORD_STATS, recordsHeld, seasonBests, verdict, type Retirement,
} from '../../career/legacy';
import { listSlots, loadHall, SLOT_COUNT, type SlotMeta } from '../../career/save';
import { WEEK_NAME } from '../../career/season';
import { legacyCard } from '../../career/card';
import { download, shareCard, toBlob } from '../../game/shareImage';
import { EDITION_NAME, EDITION_PRICE, ownsEdition } from '../../game/edition';
import { EDITION_POINTS, EditionLock } from '../EditionLock';
import { TeamTag } from './Hub';
import { useCountUp } from './Screens';

const n = (v: number | undefined) => (v ?? 0).toLocaleString('en-US');

/** The record book: a Hub tab while the career is going, and the bottom of the ceremony once it's over. */
export function RecordBook({ c }: { c: Career }) {
  const L = ensureLegacy(c);
  const T = careerTotals(c.history);
  const bests = seasonBests(c.history);
  const team = (id: string) => c.league.teams.find((t) => t.id === id);
  const annals = [...L.annals].reverse();
  const awardList = Object.entries(T.awards).sort((a, b) => b[1] - a[1]);
  return (
    <div className="cr-grid">
      <section className="cr-card cr-wide">
        <h3>Career <span className="muted small">{T.seasons ? `${T.seasons} season${T.seasons === 1 ? '' : 's'}, regular season` : 'your first season is under way'}</span></h3>
        {T.seasons ? (
          <>
            <div className="cr-statline lg-totals">
              <span><b>{T.w}-{T.l}{T.t ? `-${T.t}` : ''}</b><small>Record</small></span>
              <span><b>{n(T.line.pc)}/{n(T.line.pa)}</b><small>Comp/Att</small></span>
              <span><b>{n(T.line.py)}</b><small>Pass yds</small></span>
              <span><b>{n(T.line.ptd)}</b><small>TD</small></span>
              <span><b>{n(T.line.pint)}</b><small>INT</small></span>
              <span><b>{passerRating(T.line)}</b><small>Rating</small></span>
              <span><b>{n(T.line.ry)}</b><small>Rush yds</small></span>
              <span><b>{n(T.line.rtd)}</b><small>Rush TD</small></span>
            </div>
            <p className="muted small">
              Playoffs: {T.playoffs} trip{T.playoffs === 1 ? '' : 's'}, {T.finals} {FINAL_NAME}{T.finals === 1 ? '' : 's'}, {T.titles} title{T.titles === 1 ? '' : 's'}.
              {T.po.pa ? ` In the playoffs: ${n(T.po.py)} yards, ${n(T.po.ptd)} TD, ${n(T.po.pint)} INT.` : ''}
              {awardList.length ? ` Honors: ${awardList.map(([k, v]) => (v > 1 ? `${k} ×${v}` : k)).join(', ')}.` : ''}
            </p>
          </>
        ) : <p className="muted">Career totals start counting when your first season ends.</p>}
      </section>

      <section className="cr-card">
        <h3>Best seasons</h3>
        {bests.length ? (
          <table className="cr-t"><tbody>{bests.map((b) => <tr key={b.key}><td>{b.label}</td><td className="num"><b>{b.key === 'rating' ? b.v : n(b.v)}</b></td><td className="num muted">{b.year}</td></tr>)}</tbody></table>
        ) : <p className="muted small">After your first full season.</p>}
      </section>

      <section className="cr-card">
        <h3>Best games <span className="muted small">since {L.since}</span></h3>
        {Object.keys(L.games).length ? (
          <table className="cr-t"><tbody>{GAME_STATS.filter(([k]) => L.games[k]).map(([k, label]) => {
            const g = L.games[k]!, t = team(g.opp);
            return <tr key={k}><td>{label}</td><td className="num"><b>{n(g.v)}</b></td><td className="small muted">{g.year} {WEEK_NAME(g.week)}{t ? <> · vs {t.city}</> : null}</td></tr>;
          })}</tbody></table>
        ) : <p className="muted small">Play a game and your best ones show here.</p>}
      </section>

      <section className="cr-card">
        <h3>League records <span className="muted small">single season, since {L.since}</span></h3>
        {Object.keys(L.records).length ? (
          <table className="cr-t"><tbody>{RECORD_STATS.filter(([k]) => L.records[k]).map(([k, label]) => {
            const r = L.records[k]!, t = team(r.team);
            return <tr key={k} className={r.you ? 'you' : ''}><td>{label}</td><td className="num"><b>{n(r.v)}</b></td><td className="small">{r.name}{t ? <span className="muted"> · {t.id}</span> : null} <span className="muted">{r.year}</span></td></tr>;
          })}</tbody></table>
        ) : <p className="muted small">Set when a season ends.</p>}
      </section>

      <section className="cr-card cr-wide">
        <h3>{LEAGUE_NAME} history</h3>
        {annals.length ? (
          <div className="cr-scroll">
            <table className="cr-t lg-annals">
              <thead><tr><th>Year</th><th>Champion</th><th className="num">Final</th><th>Runner-up</th><th>MVP</th><th>Defensive POY</th><th>You</th></tr></thead>
              <tbody>{annals.map((a) => {
                const ch = a.champion ? team(a.champion) : undefined, ru = a.runnerUp ? team(a.runnerUp) : undefined;
                const mvp = a.awards.find((x) => x.key === 'mvp'), dpoy = a.awards.find((x) => x.key === 'dpoy');
                return (
                  <tr key={a.year} className={a.you?.playoff === 'Won the Gridiron Bowl' ? 'you' : ''}>
                    <td>{a.year}</td>
                    <td>{ch ? <TeamTag t={ch} /> : '—'}</td>
                    <td className="num">{a.final ? `${a.final[0]}-${a.final[1]}` : ''}</td>
                    <td className="small">{ru ? ru.city : ''}</td>
                    <td className={`small${mvp?.you ? ' lg-you' : ''}`}>{mvp ? `${mvp.player} (${mvp.team})` : ''}</td>
                    <td className="small">{dpoy ? `${dpoy.player} (${dpoy.team})` : ''}</td>
                    <td className="small muted">{a.you ? `${a.you.w}-${a.you.l}${a.you.t ? `-${a.you.t}` : ''}${a.you.playoff ? ` · ${a.you.playoff}` : ''}` : 'before your draft'}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <p className="muted small">The league's history starts when this season ends.</p>}
      </section>
    </div>
  );
}

/** The Hall of Fame case, line by line. */
function CaseList({ parts, total }: { parts: { label: string; detail: string; pts: number }[]; total: number }) {
  return (
    <table className="cr-t lg-case">
      <tbody>
        {parts.map((p) => <tr key={p.label}><td>{p.label}</td><td className="small muted">{p.detail}</td><td className="num"><b>{Math.round(p.pts)}</b></td></tr>)}
        <tr className="lg-total"><td>Legacy score</td><td className="small muted">first ballot {HOF.first} · Hall {HOF.hof} · Ring of Honor {HOF.ring}</td><td className="num"><b>{total}</b></td></tr>
      </tbody>
    </table>
  );
}

/** The offseason's last choice: play on, or hang them up (with where the vote would land today). */
export function RetireCard({ c, onRetire }: { c: Career; onRetire: () => void }) {
  if (!canRetire(c)) return null;
  if (!ownsEdition()) {
    return <EditionLock title="Retire into the Hall of Fame" blurb="End a career on your terms: a retirement ceremony, the Hall of Fame vote with every point of your case explained, a record book, the league's history and a card to share."
      points={EDITION_POINTS} />;
  }
  const me = youPlayer(c);
  const L = ensureLegacy(c);
  const { total } = legacyScore(c.history, recordsHeld(L));
  const v = verdict(total, c.history.length, mainTeam(c.history));
  const go = () => { if (confirm(`Retire ${c.you.name}? The career ends here: no more seasons. Its record book stays in this slot.`)) onRetire(); };
  return (
    <section className="cr-card lg-retire">
      <h3>Hang them up?</h3>
      <p className="muted">{c.you.name} is {me.age}, with {c.history.length} season{c.history.length === 1 ? '' : 's'} played. If he retired today: <b className="lg-gold">{v.title}</b>{v.eligible ? `, ${v.vote}% of the first-ballot vote` : `. The Hall needs ${HOF.seasons} seasons`} (legacy score {total}).</p>
      <button className="btn" onClick={go}>Retire and face the Hall of Fame vote</button>
    </section>
  );
}

/** The ceremony: the vote, the verdict, the case, the card, and the record book below. */
export function Retired({ c, onSlots }: { c: Career; onSlots: () => void }) {
  const L = ensureLegacy(c);
  const r: Retirement = L.retired!;
  const v = r.verdict;
  const T = careerTotals(c.history);
  const ring = v.ring ? c.league.teams.find((t) => t.id === v.ring) : undefined;
  const vote = useCountUp(v.vote, 1600);
  const [msg, setMsg] = useState<string | null>(null);
  const years = `${c.history[0]?.year ?? r.year}–${r.year}`;
  const owned = ownsEdition();
  const share = async () => {
    const t = ring ?? teamById(c.league, c.history[c.history.length - 1]?.team ?? c.league.teams[0].id);
    const cv = await legacyCard({
      name: c.you.name, number: c.you.number, arch: ARCH[c.you.arch].name, years, team: `${t.city} ${t.name}`, color: t.color, color2: t.color2,
      title: v.title, vote: v.vote, site: location.host || 'nfl-2min-drill.com',
      cells: [[String(T.seasons), 'SEASONS'], [`${T.w}-${T.l}`, 'RECORD'], [n(T.line.py), 'PASS YDS'], [n((T.line.ptd ?? 0) + (T.line.rtd ?? 0)), 'TOTAL TD'], [String(T.titles), 'TITLES'], [String(r.score), 'LEGACY']],
    });
    const blob = await toBlob(cv);
    if (!blob) return;
    const res = await shareCard(blob, `${c.you.name}: ${v.title}. ${T.seasons} seasons, ${n(T.line.py)} yards, ${T.titles} title${T.titles === 1 ? '' : 's'}. Build your own QB: https://nfl-2min-drill.com/#career`);
    if (res === 'unsupported') { download(blob, 'the-4th-call-legacy.png'); setMsg('Saved the image.'); }
  };
  if (!owned) {
    return (
      <div className="cr-page">
        <section className="cr-card"><div className="eyebrow">Retired · {years}</div><h1>{c.you.name}</h1><p className="muted">This career is over. Its ceremony and record book are part of the {EDITION_NAME}.</p><button className="btn" onClick={onSlots}>Your careers</button></section>
      </div>
    );
  }
  return (
    <div className="cr-page">
      <section className={`cr-card lg-hall tier-${v.tier}`}>
        <div className="eyebrow">Retired at {r.age} · {years} · {T.seasons} season{T.seasons === 1 ? '' : 's'}</div>
        <h1>{c.you.name}</h1>
        <div className="lg-vote" aria-label={`${v.vote}% of the first-ballot vote`}>
          <i style={{ width: `${vote}%` }} /><span className="lg-line" style={{ left: '80%' }} aria-hidden><em>80% to get in</em></span>
        </div>
        <p className="lg-votes"><b>{vote}%</b> of the first-ballot vote</p>
        <h2 className="lg-verdict">{v.title}</h2>
        <p className="cr-lede">
          {v.tier === 'first' && `Elected the first year he was eligible.`}
          {v.tier === 'hof' && `Short of 80% on the first ballot, elected in his ${ordinal(v.electedIn!)} year of eligibility.`}
          {v.tier === 'ring' && (v.eligible ? `Not enough for the Hall, but ${ring?.city ?? 'his team'} put${ring ? 's' : ''} him in the Ring of Honor.` : `${HOF.seasons} seasons are needed for the Hall. ${ring?.city ?? 'His team'} put${ring ? 's' : ''} him in the Ring of Honor.`)}
          {v.tier === 'solid' && (v.eligible ? 'Not a Hall of Fame case, but a career most quarterbacks would take.' : `A good run, and ${HOF.seasons} seasons are needed for the Hall.`)}
          {v.tier === 'short' && 'Short, and his.'}
          {ring && (v.tier === 'first' || v.tier === 'hof') ? ` He goes in as a member of the ${ring.city} ${ring.name}.` : ''}
        </p>
        <div className="row">
          <button className="btn primary" onClick={share}>Share your legacy</button>
          <button className="btn" onClick={onSlots}>Your careers</button>
        </div>
        {msg && <p className="muted small">{msg}</p>}
      </section>
      <section className="cr-card">
        <h3>The case</h3>
        <CaseList parts={r.parts} total={r.score} />
      </section>
      <RecordBook c={c} />
    </div>
  );
}

/** The record book tab: locked for players without the edition. */
export function LegacyTab({ c }: { c: Career }) {
  if (!ownsEdition()) {
    return <EditionLock title="The record book" blurb={`Your career totals, best seasons and best games, the ${LEAGUE_NAME}'s records, and every champion and award winner, kept as the seasons go. When you're done, retire into the Hall of Fame.`} />;
  }
  const L = ensureLegacy(c);
  const { total } = legacyScore(c.history, recordsHeld(L));
  const v = verdict(total, c.history.length, mainTeam(c.history));
  return (
    <div className="cr-stack">
      {c.history.length > 0 && <p className="lg-proj">If he retired today: <b className="lg-gold">{v.title}</b> · legacy score {total} <span className="muted">· retire from the offseason</span></p>}
      <RecordBook c={c} />
    </div>
  );
}

/** The career slots and the Hall. Slot 1 is free; 2 and 3 come with the edition. */
export function Slots({ current, onOpen, onClose }: { current: number; onOpen: (slot: number) => void; onClose?: () => void }) {
  const slots = useMemo(() => listSlots(), []);
  const hall = useMemo(() => loadHall(), []);
  const owned = ownsEdition();
  return (
    <div className="cr-page">
      <section className="cr-card">
        <div className="eyebrow">Career mode</div>
        <h1>Your <em>careers</em></h1>
        <p className="muted">Up to {SLOT_COUNT} careers in this browser, each in its own league. Download a save file (Career settings) to keep one safe or move it to another device.</p>
        <div className="lg-slots">
          {slots.map((m, i) => {
            const slot = i + 1, locked = slot > 1 && !owned;
            return <SlotCard key={slot} slot={slot} m={m} on={slot === current} locked={locked} onOpen={() => onOpen(slot)} />;
          })}
        </div>
        {!owned && <p className="muted small">Slots 2 and 3 are part of the {EDITION_NAME} ({EDITION_PRICE} once, not on sale yet).{slots.slice(1).some(Boolean) ? ' Careers already in them are kept.' : ''}</p>}
        {onClose && <button className="btn ghost" onClick={onClose}>Back</button>}
      </section>
      {owned && hall.length > 0 && (
        <section className="cr-card">
          <h3>Your Hall <span className="muted small">every career that retired, best first</span></h3>
          <table className="cr-t">
            <thead><tr><th>Quarterback</th><th>Years</th><th>Verdict</th><th className="num">W-L</th><th className="num">Yds</th><th className="num">TD</th><th className="num">Titles</th><th className="num">Score</th></tr></thead>
            <tbody>{hall.map((h) => (
              <tr key={h.id}><td><b>#{h.number} {h.name}</b><div className="small muted">{h.arch} · {h.teamName}</div></td><td className="small">{h.first}–{h.last}</td><td className={`small tier-${h.tier}`}>{h.title}</td><td className="num">{h.w}-{h.l}</td><td className="num">{n(h.py)}</td><td className="num">{h.td}</td><td className="num">{h.titles}</td><td className="num"><b>{h.score}</b></td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function SlotCard({ slot, m, on, locked, onOpen }: { slot: number; m: SlotMeta | null; on: boolean; locked: boolean; onOpen: () => void }) {
  const what = !m ? 'Empty' : m.retired ? `Retired · ${m.retired}` : m.phase === 'college' ? 'Before the draft' : m.phase === 'draft' ? 'Draft night' : `${m.year} · ${m.seasons} season${m.seasons === 1 ? '' : 's'} played`;
  return (
    <button className={`lg-slot${on ? ' on' : ''}${locked ? ' locked' : ''}`} onClick={onOpen} disabled={locked} aria-current={on ? 'true' : undefined}>
      <span className="k">Slot {slot}{on ? ' · current' : ''}</span>
      {m ? <b>#{m.number} {m.name}</b> : <b className="muted">{locked ? 'Coach’s Edition' : 'New career'}</b>}
      <span className="small muted">{m ? `${ARCH[m.arch as keyof typeof ARCH]?.name ?? ''}${m.team ? ` · ${m.team}` : ''}${m.ovr ? ` · ${m.ovr} OVR` : ''}` : locked ? 'Locked' : 'Start one here'}</span>
      <span className="small">{what}</span>
    </button>
  );
}
