/**
 * Weather on the field: falling rain, drifting snow, or wind streaks, drawn on a canvas over the field. Purely
 * cosmetic: it never blocks a tap. With reduced motion it draws one still frame.
 */
import { useEffect, useRef } from 'react';
import type { Weather } from '../engine/types';

interface P { x: number; y: number; vx: number; vy: number; s: number; a: number; ph: number; life: number }

export function WeatherLayer({ weather }: { weather?: Weather }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !weather || weather === 'clear') return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    const ps: P[] = [];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const count = () => Math.round((W * H) / (weather === 'snow' ? 6000 : weather === 'rain' ? 3500 : 6500));
    const spawn = (fresh: boolean): P => {
      if (weather === 'rain') return { x: rnd(-0.1 * W, 1.1 * W), y: fresh ? rnd(0, H) : rnd(-40, -5), vx: 90, vy: rnd(700, 1000), s: rnd(8, 16), a: rnd(0.25, 0.55), ph: 0, life: 1 };
      if (weather === 'snow') return { x: rnd(-20, W + 20), y: fresh ? rnd(0, H) : rnd(-20, -4), vx: rnd(-8, 8), vy: rnd(25, 60), s: rnd(1.2, 3.2), a: rnd(0.5, 0.95), ph: rnd(0, Math.PI * 2), life: 1 };
      // wind: streaks that gust across, fading in and out
      return { x: fresh ? rnd(-W * 0.3, W) : rnd(-W * 0.3, -20), y: rnd(0, H), vx: rnd(360, 700), vy: rnd(-10, 10), s: rnd(60, 180), a: rnd(0.35, 0.7), ph: rnd(0, Math.PI * 2), life: rnd(0.6, 1.6) };
    };
    const size = () => {
      const r = cv.getBoundingClientRect();
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ps.length = 0;
      for (let i = 0; i < count(); i++) ps.push(spawn(true));
    };
    size();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null;
    ro?.observe(cv);
    let raf = 0, last = performance.now(), t = 0;
    const draw = (dt: number) => {
      t += dt;
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round';
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (weather === 'rain') {
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.y > H + 20) ps[i] = spawn(false);
          ctx.strokeStyle = `rgba(200, 222, 255, ${p.a})`; ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.012, p.y - p.s); ctx.stroke();
        } else if (weather === 'snow') {
          p.ph += dt * 1.6;
          p.x += (p.vx + Math.sin(p.ph) * 18) * dt; p.y += p.vy * dt;
          if (p.y > H + 6) ps[i] = spawn(false);
          if (p.x < -24) p.x = W + 20; else if (p.x > W + 24) p.x = -20;
          ctx.fillStyle = `rgba(255, 255, 255, ${p.a})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); ctx.fill();
        } else {
          p.ph += dt * 2;
          p.x += p.vx * dt; p.y += (p.vy + Math.sin(p.ph) * 14) * dt;
          p.life -= dt * 0.5;
          if (p.x > W + p.s || p.life <= 0) ps[i] = spawn(false);
          const a = p.a * Math.min(1, p.life) * (0.6 + 0.4 * Math.sin(t * 3 + p.ph));
          const g = ctx.createLinearGradient(p.x - p.s, p.y, p.x, p.y);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(235, 245, 255, ${Math.max(0, a)})`);
          ctx.strokeStyle = g; ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.moveTo(p.x - p.s, p.y + Math.sin(p.ph) * 3); ctx.quadraticCurveTo(p.x - p.s * 0.5, p.y - 3, p.x, p.y); ctx.stroke();
        }
      }
    };
    if (reduced) { draw(0); return () => ro?.disconnect(); }
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!document.hidden) draw(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [weather]);
  if (!weather || weather === 'clear') return null;
  return <canvas ref={ref} className={`wx-layer wx-${weather}`} aria-hidden />;
}
