/**
 * Overtime's coin toss, the way it goes at midfield: you call it in the air, it lands, and the winner chooses to
 * receive or kick (the AI always takes the ball). In the third period of a playoff overtime there's no new toss: the
 * team that lost the opening one gets the choice. Shared by the late-game spots (GameScreen) and your career games
 * (LiveGame); the screen around it applies the call and the choice.
 */
import { useEffect, useRef, useState } from 'react';
import type { Coin, State, TeamInfo } from '../engine/types';
import { audio } from '../game/audio';
import { fmtClock } from '../game/describe';

interface Props {
  s: State;                       // stage 'toss'
  teams: [TeamInfo, TeamInfo];
  onCall: (c: Coin) => void;
  onChoose: (recv: boolean) => void;
  onContinue: () => void;         // the other team has the choice: let it play out
}

const FLIP_MS = 1500;
const cap = (c: Coin) => (c === 'heads' ? 'Heads' : 'Tails');

export function CoinToss({ s, teams, onCall, onChoose, onContinue }: Props) {
  const coin = s.coin;
  // the coin spins when it's called on this screen; one already down (a resumed game) just shows how it landed
  const [flipping, setFlipping] = useState(false);
  const hadCoin = useRef(!!coin);
  useEffect(() => {
    if (!coin || hadCoin.current) return;
    hadCoin.current = true;
    setFlipping(true);
    const t = setTimeout(() => { setFlipping(false); audio.play(coin.won === 0 ? 'cheer' : 'groan'); }, FLIP_MS);
    return () => clearTimeout(t);
  }, [coin]);

  const third = (s.q ?? 5) > 5;
  const regular = !s.po;
  const mine = coin?.pick === 0;
  const them = teams[1].city;
  // the period's length (the toss comes before any of it runs): 10 and 15 minutes in a real game, less with short quarters
  const len = s.t % 60 === 0 ? `${s.t / 60}-minute` : fmtClock(s.t);

  let head: string, text: string;
  if (!coin) {
    head = 'Coin toss';
    text = 'Tied at the end of regulation. Call it in the air.';
  } else if (flipping) {
    head = `You called ${coin.call}`;
    text = 'It’s in the air…';
  } else if (third) {
    head = mine ? 'Your choice' : `${them}’s choice`;
    text = `Third overtime period. ${mine ? 'You' : them} lost the opening toss, so the choice to receive or kick is ${mine ? 'yours' : 'theirs'}.`;
  } else {
    head = coin.won === 0 ? 'You won the toss' : 'You lost the toss';
    text = coin.won === 0 ? `${cap(coin.face)}. Your choice:` : `${cap(coin.face)}. ${them} won it and will receive.`;
  }

  return (
    <section className="toss" aria-live="polite">
      <div className="eyebrow">Overtime</div>
      <h2 className="toss-head">{head}</h2>
      <div className="coin-stage" aria-hidden>
        <div className={`coin${flipping ? ` flip-${coin!.face}` : coin && !third ? ` show-${coin.face}` : ''}`}>
          <span className="coin-face heads">H</span>
          <span className="coin-face tails">T</span>
        </div>
      </div>
      <p className="toss-text">{text}</p>
      {!coin && (
        <div className="toss-opts">
          <button className="btn primary big" onClick={() => onCall('heads')} autoFocus>Heads</button>
          <button className="btn primary big" onClick={() => onCall('tails')}>Tails</button>
        </div>
      )}
      {coin && !flipping && mine && (
        <div className="toss-opts">
          <button className="btn primary big toss-pick" onClick={() => onChoose(true)} autoFocus>
            Receive<small>Ball first. They still get a possession: score, and they have to match it</small>
          </button>
          <button className="btn big toss-pick" onClick={() => onChoose(false)}>
            Kick<small>They go first. On your possession you know exactly what you need</small>
          </button>
        </div>
      )}
      {coin && !flipping && !mine && (
        <div className="toss-opts"><button className="btn primary big" onClick={onContinue} autoFocus>Continue</button></div>
      )}
      <p className="toss-rule muted small">
        NFL overtime: both teams get the ball at least once (unless the kicking team scores a safety on the first
        possession). Still tied after that, the next score wins.{' '}
        {regular ? `Regular season: one ${len} period, two timeouts each; still tied, it’s a tie.` : `Playoff rules: ${len} periods, three timeouts each per two periods, played until someone wins.`}
      </p>
    </section>
  );
}
