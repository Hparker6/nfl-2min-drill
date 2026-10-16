import { useState } from 'react';
import { FRANCHISES } from '../engine/data';
import { customScenario, genScenario, type Scenario, type SpotParams } from '../engine/scenario';
import { fmtClock } from '../game/describe';
import type { Store } from '../game/storage';
import { GameScreen } from './GameScreen';

interface Props {
  store: Store;
  update: (fn: (s: Store) => void) => void;
}

const DEFAULT: SpotParams = {
  you: 'PDX', them: 'AUS', side: 'off', t: 105, lead: -3, yl: 25, down: 1, dist: 10, to: [2, 2], running: false, home: 0,
};

export function Practice({ store, update }: Props) {
  const [p, setP] = useState<SpotParams>(DEFAULT);
  const [sc, setSc] = useState<Scenario | null>(null);
  const [n, setN] = useState(0);
  const hints = store.settings.hints;
  const set = <K extends keyof SpotParams>(k: K, v: SpotParams[K]) => setP((x) => ({ ...x, [k]: v }));

  const build = () => { setSc(customScenario(p, `practice:${Date.now()}`)); setN((x) => x + 1); };
  const random = () => { setSc(genScenario(`practice:rand:${Date.now()}`, 'practice')); setN((x) => x + 1); };

  if (sc) {
    const meta = (
      <div className="meta">
        <div className="meta-l">
          <h1 className="meta-title">Practice</h1>
          <span className="meta-sub">{hints ? 'Coach mode: win chance shown on every option' : 'Not scored or saved'}</span>
        </div>
      </div>
    );
    return (
      <GameScreen key={`${sc.id}:${n}`} sc={sc} saved={[]} settings={store.settings} hints={hints} meta={meta} label="Practice" autoStart={false}
        startLabel="Play it" briefExtra={<button className="btn ghost" onClick={() => setSc(null)}>Change the spot</button>}
        onPicks={() => {}} onDone={() => {}} onContinue={() => setSc(null)} continueLabel="Back to the builder" />
    );
  }
  const yourSide = p.side === 'off';
  return (
    <div className="page">
      <div className="meta"><div className="meta-l"><h1 className="meta-title">Practice</h1><span className="meta-sub">Build any late-game spot and play it out. Not scored or saved.</span></div></div>
      <section className="summary builder">
        <div className="form">
          <label>You<select value={p.you} onChange={(e) => set('you', e.target.value)}>{FRANCHISES.map((f) => <option key={f[0]} value={f[0]} disabled={f[0] === p.them}>{f[1]} {f[2]}</option>)}</select></label>
          <label>Them<select value={p.them} onChange={(e) => set('them', e.target.value)}>{FRANCHISES.map((f) => <option key={f[0]} value={f[0]} disabled={f[0] === p.you}>{f[1]} {f[2]}</option>)}</select></label>
          <label>Who has the ball
            <select value={p.side} onChange={(e) => set('side', e.target.value as 'off' | 'def')}>
              <option value="off">You (call the offense)</option>
              <option value="def">They do (call the defense)</option>
            </select>
          </label>
          <label>Your lead <output>{p.lead > 0 ? `+${p.lead}` : p.lead}</output>
            <input type="range" min={-16} max={10} value={p.lead} onChange={(e) => set('lead', Number(e.target.value))} />
          </label>
          <label>Time left <output>{fmtClock(p.t)}</output>
            <input type="range" min={5} max={480} step={1} value={p.t} onChange={(e) => set('t', Number(e.target.value))} />
          </label>
          <label>Ball on <output>{p.yl === 50 ? 'midfield' : p.yl < 50 ? `${yourSide ? 'your' : 'their'} own ${p.yl}` : `${yourSide ? 'their' : 'your'} ${100 - p.yl}`}</output>
            <input type="range" min={1} max={99} value={p.yl} onChange={(e) => set('yl', Number(e.target.value))} />
          </label>
          <label>Down
            <select value={p.down} onChange={(e) => set('down', Number(e.target.value))}>{[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d}</option>)}</select>
          </label>
          <label>To go <output>{p.dist}</output>
            <input type="range" min={1} max={25} value={p.dist} onChange={(e) => set('dist', Number(e.target.value))} />
          </label>
          <label>Your timeouts
            <select value={p.to[0]} onChange={(e) => set('to', [Number(e.target.value), p.to[1]])}>{[0, 1, 2, 3].map((d) => <option key={d}>{d}</option>)}</select>
          </label>
          <label>Their timeouts
            <select value={p.to[1]} onChange={(e) => set('to', [p.to[0], Number(e.target.value)])}>{[0, 1, 2, 3].map((d) => <option key={d}>{d}</option>)}</select>
          </label>
          <label className="check"><input type="checkbox" checked={p.running} onChange={(e) => set('running', e.target.checked)} /> Clock running</label>
          <label className="check"><input type="checkbox" checked={hints} onChange={(e) => update((s) => { s.settings.hints = e.target.checked; })} /> Coach mode: show win chance on every option</label>
        </div>
        <div className="row">
          <button className="btn primary big" onClick={build}>Set it up ▸</button>
          <button className="btn big" onClick={random}>Random spot</button>
        </div>
      </section>
    </div>
  );
}
