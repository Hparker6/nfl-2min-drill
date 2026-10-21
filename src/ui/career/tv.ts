/** A team's colors as the CSS variables career screens use: the chip text is always readable on the team color. */
import { chipInk } from '../Scoreboard';

export const tv = (t: { color: string; color2: string }) => ({ ['--tc' as string]: t.color, ['--tc2' as string]: chipInk(t.color, t.color2) });
