/** The career share card: a season (or a title) as a 1080 x 1350 image, in the team's colors. */
import { passerRating, type Line } from './box';

export interface CareerCardData {
  name: string; number: number; arch: string; year: number; team: string; color: string; color2: string;
  record: string; line: Line; ovr: number; headline: string; site: string;
}

const W = 1080, H = 1350;
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', sans-serif";
const BODY = "'Barlow', 'Helvetica Neue', Arial, sans-serif";

export async function careerCard(d: CareerCardData): Promise<HTMLCanvasElement> {
  try { await Promise.all([document.fonts.load(`800 100px ${DISPLAY}`), document.fonts.load(`600 40px ${BODY}`)]); } catch { /* fallbacks */ }
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;
  x.fillStyle = '#0a0e0c'; x.fillRect(0, 0, W, H);
  // the team band
  const g = x.createLinearGradient(0, 0, W, 560);
  g.addColorStop(0, d.color); g.addColorStop(1, '#0a0e0c');
  x.fillStyle = g; x.fillRect(0, 0, W, 560);
  x.fillStyle = d.color2; x.fillRect(0, 556, W, 8);
  // the number, huge, behind the name
  x.globalAlpha = 0.18; x.fillStyle = '#fff'; x.font = `800 520px ${DISPLAY}`; x.textAlign = 'right';
  x.fillText(String(d.number), W - 40, 500); x.globalAlpha = 1;
  x.textAlign = 'left';
  x.fillStyle = '#f5c518'; x.font = `800 44px ${DISPLAY}`;
  x.fillText(`THE 4TH CALL · CAREER`, 72, 120);
  x.fillStyle = '#fff'; x.font = `800 112px ${DISPLAY}`;
  x.fillText(d.name.toUpperCase(), 72, 300, W - 144);
  x.font = `600 40px ${BODY}`; x.fillStyle = 'rgba(255,255,255,.85)';
  x.fillText(`#${d.number} · ${d.arch} · ${d.team}`, 72, 365, W - 144);
  x.font = `800 72px ${DISPLAY}`; x.fillStyle = '#f5c518';
  x.fillText(d.headline.toUpperCase(), 72, 480, W - 144);
  // the numbers
  const l = d.line;
  const cells: [string, string][] = [
    [d.record, 'RECORD'], [String(d.ovr), 'OVERALL'], [(l.py ?? 0).toLocaleString('en-US'), 'PASS YDS'],
    [String(l.ptd ?? 0), 'TD'], [String(l.pint ?? 0), 'INT'], [String(passerRating(l)), 'RATING'],
  ];
  cells.forEach(([v, k], i) => {
    const cx = 72 + (i % 3) * 312, cy = 690 + Math.floor(i / 3) * 230;
    x.fillStyle = '#121916'; x.beginPath(); x.roundRect(cx, cy - 120, 288, 196, 22); x.fill();
    x.fillStyle = '#edf2ee'; x.font = `800 96px ${DISPLAY}`; x.textAlign = 'center';
    x.fillText(v, cx + 144, cy + 8, 260);
    x.fillStyle = '#8b9b91'; x.font = `700 30px ${BODY}`;
    x.fillText(k, cx + 144, cy + 56);
  });
  x.textAlign = 'left';
  // the field and the invitation
  const fy = 1190;
  for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? '#296a41' : '#2c7246'; x.fillRect(0, fy + i * 40, W, 40); }
  x.fillStyle = '#fff'; x.font = `800 50px ${DISPLAY}`;
  x.fillText('BUILD YOUR OWN QB', 72, fy + 98);
  x.textAlign = 'right'; x.fillStyle = '#f5c518';
  x.fillText(d.site.toUpperCase(), W - 72, fy + 98);
  return cv;
}
