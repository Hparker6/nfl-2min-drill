# The 4th Call

A browser game about late-game football play-calling. You get the score, the clock, the timeouts and 22 players on the
field; you call the plays (27 of them), manage the clock and call the defense. Every decision is graded by playing the
rest of the game out thousands of times for every option you had.

- **Daily**: three spots a day, the same for everyone (by UTC date), resumable after a refresh, shareable result.
- **Survivor**: random spots back to back; one loss ends the run.
- **Practice**: build any spot; optional Coach mode shows each option's win chance before you call it.

Teams and players are fictional. Results come from a simplified simulation written for this game; grades are its
estimates, not official evaluations or real-world probabilities.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine tests (Vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ at http://localhost:4173
```

Requires Node 18 or newer.

## Configure before deploying

Copy `.env.example` to `.env.production` (or set the same variables in your host's build settings):

| Variable | Required | What it does |
| --- | --- | --- |
| `VITE_SITE_URL` | Recommended | Your public address, e.g. `https://your-domain.com` (no trailing slash). Makes the social-preview image and canonical link absolute, which link previews need. |
| `VITE_GA_ID` | Optional | A Google Analytics 4 measurement ID (`G-…`). Without it, no analytics code is loaded at all. |

Analytics events (when enabled): `game_start`, `call_made`, `spot_complete`, `daily_complete`, `survivor_end`, `share`.
No personal data is sent. If you enable analytics for visitors in the EU/UK, you may need a consent banner.

## Deploy

The build is a static site in `dist/` with relative asset paths and hash-based navigation (`#survivor`,
`#practice`), so it needs no server rewrites. Any static host works:

- **Netlify / Vercel / Cloudflare Pages**: connect the repository, build command `npm run build`, output directory
  `dist`, Node 18+. Add `VITE_SITE_URL` (and optionally `VITE_GA_ID`) as build environment variables. Point your
  domain at the project in the host's dashboard.
- **Any other static host / S3 / GitHub Pages**: run `npm run build` locally with `.env.production` in place and
  upload the contents of `dist/`.

`public/404.html` is the not-found page (Netlify, Cloudflare Pages and GitHub Pages use it automatically).

## Project layout

- `src/engine/`: the football engine (pure TypeScript). `sim.ts` resolves plays and runs the clock, `evaluate.ts`
  values decisions by simulation, `scenario.ts` builds the daily/survivor spots, `worker.ts` runs evaluations off the
  main thread. Tests in `sim.test.ts`.
- `src/game/`: session (deterministic replay of saved picks), grading, storage, sharing, analytics.
- `src/ui/`: React screens and the SVG field renderer (`field.ts`).
