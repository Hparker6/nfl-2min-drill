/**
 * Sound and light music, synthesized in the browser with the Web Audio API: no audio files, nothing to license,
 * nothing to download. Browsers only allow audio after the player interacts with the page, so nothing plays until
 * unlock() runs from a tap or a key press. Everything here is a no-op where Web Audio isn't available (tests, old
 * browsers), and nothing here touches the game's state.
 */
import type { Sound } from './fx';

type Ctx = AudioContext;
const has = () => typeof window !== 'undefined' && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);

// note frequencies used below
const N = { A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5 };

/** The music: four bars, C - Am - F - G, at an easy tempo. Each chord is a pad plus a soft arpeggio. */
const TEMPO = 88;
const CHORDS: { bass: number; pad: number[] }[] = [
  { bass: N.C3, pad: [N.C4, N.E4, N.G4] },
  { bass: N.A2, pad: [N.A3, N.C4, N.E4] },
  { bass: N.F3, pad: [N.F3, N.A3, N.C4] },
  { bass: N.G3, pad: [N.G3, N.B3, N.D4] },
];
const ARP = [[0, 1, 2, 1, 0, 1, 2, 1], [0, 2, 1, 2, 0, 2, 1, 2]];   // two patterns, alternated every four bars

const BIG: Sound[] = ['turnoverBad', 'turnoverGood', 'tdFor', 'tdAgainst', 'win', 'loss'];

class Engine {
  private ctx: Ctx | null = null;
  private sfx: GainNode | null = null;
  private mus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private sound = true;
  private music = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;          // when the next eighth note of the music is due
  private step = 0;          // which eighth note, counting from the start
  private bigUntil = 0;      // a big sound is playing until this time: small ones wait their turn

  /** From a tap or a key press: create (or resume) the audio context, and start the music if it is on. */
  unlock() {
    if (!has()) return;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
      this.sfx = ctx.createGain(); this.sfx.gain.value = 1; this.sfx.connect(master);
      this.mus = ctx.createGain(); this.mus.gain.value = 0; this.mus.connect(master);
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.ctx = ctx;
      document.addEventListener('visibilitychange', () => this.sync());
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().then(() => this.sync()).catch(() => {});
    this.sync();
  }

  configure(o: { sound: boolean; music: boolean }) {
    this.sound = o.sound;
    this.music = o.music;
    this.sync();
  }

  /** Music plays while it is on, the page is visible and audio is unlocked. */
  private sync() {
    const c = this.ctx;
    if (!c || !this.mus) return;
    const want = this.music && c.state === 'running' && !document.hidden;
    const now = c.currentTime;
    this.mus.gain.cancelScheduledValues(now);
    this.mus.gain.setTargetAtTime(want ? MUSIC_LEVEL : 0, now, 0.25);
    if (want && !this.timer) {
      this.next = now + 0.1;
      this.timer = setInterval(() => this.schedule(), 50);
    } else if (!want && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private schedule() {
    const c = this.ctx!;
    const eighth = 60 / TEMPO / 2;
    while (this.next < c.currentTime + 0.2) {
      const t = this.next, i = this.step;
      const bar = Math.floor(i / 8) % CHORDS.length, e = i % 8;
      const ch = CHORDS[bar];
      if (e === 0) {
        for (const f of ch.pad) this.tone(f, t, eighth * 8, { type: 'triangle', gain: 0.05, attack: 0.5, release: 0.9, out: this.mus!, cutoff: 1400 });
        this.tone(ch.bass, t, eighth * 7, { type: 'sine', gain: 0.12, attack: 0.05, release: 0.6, out: this.mus! });
      }
      const pat = ARP[Math.floor(i / 32) % ARP.length];
      this.tone(ch.pad[pat[e]] * 2, t, eighth * 1.6, { type: 'sine', gain: 0.045, attack: 0.005, release: 0.3, out: this.mus! });
      if (e === 0 || e === 4) this.tone(120, t, 0.14, { type: 'sine', gain: 0.12, attack: 0.002, release: 0.12, to: 48, out: this.mus! });
      if (e % 2 === 1) this.hiss(t, 0.035, { gain: 0.018, filter: 'highpass', freq: 7000, out: this.mus! });
      this.next += eighth;
      this.step++;
    }
  }

  /** A sound effect. Small ones are skipped while a big one is still sounding, so they never pile up. */
  play(name: Sound) {
    const c = this.ctx;
    if (!c || !this.sound || c.state !== 'running') return;
    const t = c.currentTime + 0.01;
    const big = BIG.includes(name);
    if (!big && t < this.bigUntil) return;
    if (big) { this.bigUntil = t + 1.6; this.duck(t, 2.2); }
    const o = this.sfx!;
    switch (name) {
      case 'whistle': {
        // a referee's two-tone trill
        for (const f of [2900, 3150]) this.tone(f, t, 0.3, { type: 'sine', gain: 0.035, attack: 0.01, release: 0.08, vibrato: [32, 110], out: o });
        break;
      }
      case 'hit':
        this.hiss(t, 0.14, { gain: 0.3, filter: 'lowpass', freq: 600, out: o });
        this.tone(110, t, 0.16, { type: 'sine', gain: 0.35, attack: 0.002, release: 0.14, to: 42, out: o });
        break;
      case 'chime':
        this.tone(N.E5, t, 0.3, { type: 'triangle', gain: 0.08, attack: 0.005, release: 0.25, out: o });
        this.tone(N.G5, t + 0.09, 0.4, { type: 'triangle', gain: 0.08, attack: 0.005, release: 0.35, out: o });
        break;
      case 'cheer': this.crowd(t, 1.6, 'up'); break;
      case 'groan': this.crowd(t, 1.2, 'down'); break;
      case 'turnoverBad':
        this.hiss(t, 0.14, { gain: 0.3, filter: 'lowpass', freq: 600, out: o });
        this.tone(110, t, 0.16, { type: 'sine', gain: 0.35, attack: 0.002, release: 0.14, to: 42, out: o });
        [N.E4, N.C4, N.A3].forEach((f, k) => this.tone(f, t + 0.05 + k * 0.17, 0.22, { type: 'sawtooth', gain: 0.07, attack: 0.01, release: 0.12, cutoff: 1300, out: o }));
        this.crowd(t + 0.25, 1.3, 'down');
        break;
      case 'turnoverGood':
        [N.G4, N.C5, N.E5].forEach((f, k) => this.tone(f, t + k * 0.1, 0.22, { type: 'square', gain: 0.05, attack: 0.005, release: 0.12, cutoff: 2600, out: o }));
        this.crowd(t + 0.1, 1.8, 'up');
        break;
      case 'tdFor':
        [N.C5, N.E5, N.G5, N.C6].forEach((f, k) => this.tone(f, t + k * 0.12, k === 3 ? 0.7 : 0.16, { type: 'square', gain: 0.05, attack: 0.005, release: k === 3 ? 0.5 : 0.08, cutoff: 3000, out: o }));
        this.crowd(t, 2.2, 'up');
        break;
      case 'tdAgainst':
        this.tone(N.D3, t, 0.7, { type: 'triangle', gain: 0.09, attack: 0.02, release: 0.5, out: o });
        this.crowd(t, 1.3, 'down');
        break;
      case 'win': {
        const seq = [N.C5, N.E5, N.G5, N.C6];
        seq.forEach((f, k) => this.tone(f, t + k * 0.13, 0.2, { type: 'square', gain: 0.05, attack: 0.005, release: 0.1, cutoff: 3000, out: o }));
        for (const f of [N.C5, N.E5, N.G5, N.C6]) this.tone(f, t + 0.6, 1.3, { type: 'triangle', gain: 0.055, attack: 0.02, release: 0.9, out: o });
        this.crowd(t, 3, 'up');
        this.bigUntil = t + 2.6;
        break;
      }
      case 'loss':
        [N.A4, N.F4, N.D4].forEach((f, k) => this.tone(f, t + k * 0.32, 0.45, { type: 'triangle', gain: 0.07, attack: 0.02, release: 0.35, out: o }));
        this.tone(N.D3, t + 0.96, 1.2, { type: 'triangle', gain: 0.08, attack: 0.05, release: 0.9, out: o });
        this.crowd(t + 0.2, 1.4, 'down');
        this.bigUntil = t + 2.4;
        break;
      case 'gradeGood':
        this.tone(N.C6, t, 0.25, { type: 'sine', gain: 0.04, attack: 0.005, release: 0.2, out: o });
        break;
      case 'ring':
        // a phone: two tones together, two short bursts
        for (const k of [0, 0.42]) for (const f of [440, 480]) this.tone(f, t + k, 0.34, { type: 'sine', gain: 0.05, attack: 0.01, release: 0.04, out: o });
        break;
      case 'drum': {
        // a snare roll that speeds up over a second and a half
        let at = t;
        for (let k = 0; k < 22; k++) { this.hiss(at, 0.05, { gain: 0.05 + k * 0.004, filter: 'bandpass', freq: 2200, q: 0.7, out: o }); at += Math.max(0.035, 0.11 - k * 0.004); }
        break;
      }
      case 'gradeBad':
        this.tone(N.E3, t, 0.25, { type: 'triangle', gain: 0.05, attack: 0.005, release: 0.2, out: o });
        this.tone(N.C3, t + 0.12, 0.3, { type: 'triangle', gain: 0.05, attack: 0.005, release: 0.25, out: o });
        break;
    }
  }

  /** The music steps back while a big moment plays. */
  private duck(t: number, dur: number) {
    if (!this.mus || !this.music) return;
    const g = this.mus.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(MUSIC_LEVEL * 0.25, t, 0.05);
    g.setTargetAtTime(MUSIC_LEVEL, t + dur, 0.4);
  }

  private tone(freq: number, t: number, dur: number, o: { type: OscillatorType; gain: number; attack: number; release: number; out: AudioNode; to?: number; cutoff?: number; vibrato?: [number, number] }) {
    const c = this.ctx!;
    const osc = c.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    let lfo: OscillatorNode | null = null;
    if (o.vibrato) {
      lfo = c.createOscillator();
      const depth = c.createGain();
      lfo.frequency.value = o.vibrato[0];
      depth.gain.value = o.vibrato[1];
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain, t + o.attack);
    g.gain.setValueAtTime(o.gain, Math.max(t + o.attack, t + dur - o.release));
    g.gain.linearRampToValueAtTime(0, t + dur);
    let node: AudioNode = osc;
    if (o.cutoff) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.cutoff; node.connect(f); node = f; }
    node.connect(g).connect(o.out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private hiss(t: number, dur: number, o: { gain: number; filter: BiquadFilterType; freq: number; q?: number; out: AudioNode; attack?: number; to?: number }) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.to) f.frequency.linearRampToValueAtTime(o.to, t + dur);
    if (o.q) f.Q.value = o.q;
    const g = c.createGain();
    const a = o.attack ?? 0.003;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain, t + a);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(f).connect(g).connect(o.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** A crowd: band-passed noise that swells and fades (rising for a cheer, sinking for a groan). */
  private crowd(t: number, dur: number, way: 'up' | 'down') {
    const o = this.sfx!;
    if (way === 'up') {
      this.hiss(t, dur, { gain: 0.16, filter: 'bandpass', freq: 900, to: 1500, q: 0.6, attack: dur * 0.3, out: o });
      this.hiss(t + 0.05, dur * 0.9, { gain: 0.07, filter: 'bandpass', freq: 2400, q: 0.8, attack: dur * 0.3, out: o });
    } else {
      this.hiss(t, dur, { gain: 0.14, filter: 'bandpass', freq: 560, to: 300, q: 1, attack: dur * 0.25, out: o });
    }
  }
}

const MUSIC_LEVEL = 0.45;
export const audio = new Engine();
