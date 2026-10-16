/**
 * The share image: a 1080 x 1350 result card (portrait, the shape Instagram, X and group chats show largest), drawn
 * on a canvas in the browser. It carries the score, the rank, the result, one square per call and the address, so a
 * shared result reads on its own and brings people back.
 */
import { realTeam } from '../engine/nfl';
import type { GradeKey } from './grade';

export interface CardData {
  day: number;              // Daily #
  dateLabel: string;        // e.g. "Oct 16"
  title?: string;           // the day's situation kind, e.g. "Two-minute drill"
  performance: number;      // 0-100
  rankLine: string;         // "#12 of 340 today" or "Better than 62% of play-callers"
  teams: [string, string];  // team ids, yours first
  score: [number, number];
  win: boolean;
  ot: boolean;
  grades: GradeKey[];
  coach: string;            // "The Gunslinger"
  streak: number;
  site: string;             // "nfl-2min-drill.com"
}

const W = 1080, H = 1350;
const C = { bg: '#0a0e0c', panel: '#121916', ink: '#edf2ee', muted: '#8b9b91', accent: '#f5c518', turf: '#2c7246', turf2: '#296a41', chalk: 'rgba(255,255,255,.55)' };
const GRADE: Record<GradeKey, string> = { g: '#3fbf6a', y: '#e2bd35', o: '#f08a3c', r: '#ec5a50' };
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', sans-serif";
const BODY = "'Barlow', 'Helvetica Neue', Arial, sans-serif";

function round(x: CanvasRenderingContext2D, l: number, t: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r);
  x.closePath();
}
const lum = (hex: string) => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

export async function drawCard(d: CardData): Promise<HTMLCanvasElement> {
  // the page's own fonts; if they aren't ready the fallbacks still draw a clean card
  try { await Promise.all([document.fonts.load(`800 100px ${DISPLAY}`), document.fonts.load(`600 40px ${BODY}`)]); } catch { /* fallbacks */ }
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
  x.textBaseline = 'alphabetic';

  // brand row
  round(x, 72, 72, 76, 76, 18); x.fillStyle = C.accent; x.fill();
  x.save(); x.translate(110, 110); x.rotate(-0.6); x.fillStyle = '#1b1600';
  x.beginPath(); x.ellipse(0, 0, 25, 15, 0, 0, Math.PI * 2); x.fill();
  x.strokeStyle = C.accent; x.lineWidth = 3.5; x.beginPath(); x.moveTo(-10, 0); x.lineTo(10, 0); x.stroke(); x.restore();
  x.font = `800 60px ${DISPLAY}`; x.textAlign = 'left';
  x.fillStyle = C.ink; x.fillText('THE', 172, 132);
  const wThe = x.measureText('THE ').width;
  x.fillStyle = C.accent; x.fillText('4TH', 172 + wThe, 132);
  x.fillStyle = C.ink; x.fillText(' CALL', 172 + wThe + x.measureText('4TH').width, 132);
  x.textAlign = 'right'; x.fillStyle = C.muted; x.font = `700 40px ${DISPLAY}`;
  x.fillText(`DAILY #${d.day} · ${d.dateLabel.toUpperCase()}`, W - 72, 128);

  // the game: team chips and the final score
  const [a, b] = d.teams.map((id) => { try { return realTeam(id); } catch { return null; } });
  const chip = (cx: number, id: string, color: string, color2: string) => {
    round(x, cx - 90, 210, 180, 92, 16); x.fillStyle = color; x.fill();
    x.fillStyle = color2 || (lum(color) > 0.6 ? '#111' : '#fff'); x.font = `800 58px ${DISPLAY}`; x.textAlign = 'center';
    x.fillText(id, cx, 277);
  };
  chip(200, d.teams[0], a?.color ?? '#33443b', a?.color2 ?? '#fff');
  chip(W - 200, d.teams[1], b?.color ?? '#33443b', b?.color2 ?? '#fff');
  x.fillStyle = C.ink; x.font = `800 110px ${DISPLAY}`; x.textAlign = 'center';
  x.fillText(`${d.score[0]}–${d.score[1]}`, W / 2, 296);
  round(x, W / 2 - 92, 322, 184, 56, 28); x.fillStyle = d.win ? '#1f7a40' : '#8a2a22'; x.fill();
  x.fillStyle = '#fff'; x.font = `800 38px ${DISPLAY}`;
  x.fillText(`${d.win ? 'WIN' : 'LOSS'}${d.ot ? ' · OT' : ''}`, W / 2, 363);

  // the score
  x.fillStyle = C.muted; x.font = `700 36px ${BODY}`;
  x.fillText((d.title ? `${d.title} · ` : '').toUpperCase() + 'PERFORMANCE', W / 2, 468);
  x.fillStyle = C.accent; x.font = `800 300px ${DISPLAY}`;
  x.fillText(String(d.performance), W / 2 - 40, 740);
  const wScore = x.measureText(String(d.performance)).width;
  x.fillStyle = C.muted; x.font = `700 70px ${DISPLAY}`; x.textAlign = 'left';
  x.fillText('/100', W / 2 - 40 + wScore / 2 + 8, 740);

  // the rank, as a pill
  x.textAlign = 'center'; x.font = `800 50px ${DISPLAY}`;
  const rank = d.rankLine.toUpperCase();
  const rw = Math.min(W - 144, x.measureText(rank).width + 72);
  round(x, (W - rw) / 2, 784, rw, 84, 42); x.fillStyle = 'rgba(245,197,24,.14)'; x.fill();
  x.strokeStyle = 'rgba(245,197,24,.55)'; x.lineWidth = 3; x.stroke();
  x.fillStyle = C.ink; x.fillText(rank, W / 2, 844);

  // one square per call
  const gs = d.grades.slice(0, 16);
  const sz = gs.length > 10 ? 50 : 64, gap = 14;
  const total = gs.length * sz + (gs.length - 1) * gap;
  gs.forEach((g, i) => { round(x, (W - total) / 2 + i * (sz + gap), 914, sz, sz, 12); x.fillStyle = GRADE[g]; x.fill(); });
  x.fillStyle = C.muted; x.font = `600 30px ${BODY}`;
  x.fillText(`${gs.length} call${gs.length === 1 ? '' : 's'}, each graded against every option`, W / 2, 914 + sz + 52);

  // coach profile and streak
  x.fillStyle = C.ink; x.font = `800 52px ${DISPLAY}`;
  x.fillText(`COACHED LIKE ${d.coach.toUpperCase()}`, W / 2, 1100);
  if (d.streak > 1) { x.fillStyle = C.accent; x.font = `700 36px ${BODY}`; x.fillText(`${d.streak}-day streak`, W / 2, 1150); }

  // the field at the bottom, with the invitation and the address
  const fy = 1190;
  for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? C.turf2 : C.turf; x.fillRect(0, fy + i * 40, W, 40); }
  x.strokeStyle = C.chalk; x.lineWidth = 3;
  for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(0, fy + i * 40); x.lineTo(W, fy + i * 40); x.stroke(); }
  x.fillStyle = '#fff'; x.font = `800 50px ${DISPLAY}`; x.textAlign = 'left';
  x.fillText('CAN YOU BEAT ME?', 72, fy + 98);
  x.textAlign = 'right'; x.fillStyle = C.accent; x.font = `800 50px ${DISPLAY}`;
  x.fillText(d.site.toUpperCase(), W - 72, fy + 98);
  return cv;
}

export const toBlob = (cv: HTMLCanvasElement) => new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));

/**
 * Share the card as an image where the device can (phones), with the text and link alongside; otherwise fall back
 * to sharing or copying the text. 'cancelled' means the player closed the share sheet.
 */
export async function shareCard(blob: Blob, text: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  const file = new File([blob], 'the-4th-call.png', { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share || !nav.canShare?.({ files: [file] })) return 'unsupported';
  try {
    await nav.share({ files: [file], text });
    return 'shared';
  } catch (e) {
    return (e as Error)?.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}

export function download(blob: Blob, name = 'the-4th-call.png') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
