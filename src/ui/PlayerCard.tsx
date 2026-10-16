/** A player's details, shown on hover or keyboard focus. Ratings are game ratings, labeled as such. */
import { POS_NAME } from '../engine/data';
import { ATTR_NAME, GROUP_ATTRS, SLOT_GROUP } from '../engine/roster';
import type { TeamInfo } from '../engine/types';

const SOURCE: Record<string, string> = {
  generated: 'Fictional player · generated game ratings',
  stats: "Game ratings from this season's stats (nflverse)",
  estimated: 'Game ratings estimated (no individual stats)',
};

export function PlayerCard({ team, pos }: { team: TeamInfo; pos: string }) {
  const p = team.players[pos];
  if (!p) return null;
  const group = SLOT_GROUP[pos];
  const attrs = group ? GROUP_ATTRS[group] : [];
  return (
    <div className="pcard" role="status" aria-live="polite">
      <div className="pcard-head">
        <span className="pcard-num" style={{ background: team.color, color: team.color2 }}>{p.number ?? '–'}</span>
        <span className="pcard-name">
          <b>{p.name}</b>
          <span>{POS_NAME[pos] ?? pos} · {team.city} {team.name}</span>
        </span>
        <span className="pcard-ovr" title="Overall game rating: the average of this player's position ratings">{p.rating}</span>
      </div>
      {p.attrs && (
        <ul className="pcard-attrs">
          {attrs.map((a) => {
            const v = p.attrs![a];
            return v == null ? null : (
              <li key={a}>
                <span>{ATTR_NAME[a]}</span>
                <i aria-hidden><b style={{ width: `${v}%` }} /></i>
                <em>{v}</em>
              </li>
            );
          })}
        </ul>
      )}
      <p className="pcard-src">{SOURCE[p.source ?? 'generated']}. 0–100, for this game only.</p>
    </div>
  );
}
