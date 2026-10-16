# The 4th Call

A browser game about late-game football play-calling. You get the score, the clock, the timeouts and 22 players on the
field; you call the plays (27 of them), manage the clock and call the defense. Every decision is graded by playing the
rest of the game out thousands of times for every option you had.

- **Daily**: three spots a day, the same for everyone (by UTC date), resumable after a refresh, shareable result.
- **Survivor**: random spots back to back; one loss ends the run.
- **Practice**: build any spot; optional Coach mode shows each option's win chance before you call it.

Rosters, jersey numbers and season statistics come from nflverse (CC-BY 4.0; see scripts/build-rosters.mjs, which
also documents how the 0-100 game ratings are computed from those statistics). Game situations are made up. Results
come from a simplified simulation written for this game; grades are its
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
| `VITE_SITE_URL` | Required for search | Your public address, e.g. `https://your-domain.com` (no trailing slash). Makes the social-preview image, canonical link and structured data absolute, and adds `sitemap.xml` plus its line in `robots.txt`. Without it, search engines get no sitemap and no canonical URL. |
| `VITE_GA_ID` | Optional | Google Analytics 4 measurement ID. The site tag (`G-WVFFZZWS61`) is built in; set this to use another, or `off` to load no analytics (for local builds). |
| `VITE_FEEDBACK_URL`, `VITE_SUPPORT_URL` | Optional | The footer's Feedback and Support the developer links (`https://` or `mailto:`). Not shown when empty. |
| `VITE_ADS`, `VITE_ADSENSE_CLIENT`, `VITE_ADSENSE_SLOT` | Optional | Display ads, off by default. See [MONETIZATION.md](MONETIZATION.md) before setting them. |

Analytics events (when enabled): `game_start`, `call_made`, `game_complete`, `play_again`, `daily_complete`, `survivor_end`, `share` (the full list is in `src/game/analytics.ts`).
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

## Search (SEO)

The title, description and the text that crawlers read (the pre-render fallback in `index.html` and the "A free
2-minute drill football game" blurb in the footer) target searches like "nfl 2 min drill", "2 minute drill game" and
"football play-calling game". The domain (nfl-2min-drill.com) matches the same phrase. `vite.config.ts` adds JSON-LD (`WebSite` + `VideoGame`), `robots.txt` and `sitemap.xml` at build
time from `VITE_SITE_URL`. After deploying:

1. Add the site in [Google Search Console](https://search.google.com/search-console) (a Domain property, verified by
   DNS), submit `https://your-domain.com/sitemap.xml`, and use URL Inspection → Request indexing on the home page.
2. Do the same in [Bing Webmaster Tools](https://www.bing.com/webmasters) (it can import from Search Console).
3. Get linked: the GitHub repo's website field, and posts where football fans are (subreddits, Discords, X). A new
   site with no inbound links ranks for very little, whatever its tags say.

The page uses "NFL" in its title and copy; keep the no-affiliation disclaimer (footer, About, fallback text) in place.
"NFL" is the league's trademark and "NFL 2 Minute Drill" is also the name of Sega's arcade game. Open search tasks
are in [TODO.md](TODO.md).

## Project layout

- `src/engine/`: the football engine (pure TypeScript). `sim.ts` resolves plays and runs the clock, `evaluate.ts`
  values decisions by simulation, `scenario.ts` builds the daily/survivor spots, `worker.ts` runs evaluations off the
  main thread. Tests in `sim.test.ts`.
- `src/game/`: session (deterministic replay of saved picks), grading, storage, sharing, analytics.
- `src/ui/`: React screens and the SVG field renderer (`field.ts`).

## Rosters and player ratings

The game uses real teams and players. `src/data/nfl-rosters.json` is generated, never hand-edited:

```bash
node scripts/build-rosters.mjs 2025     # downloads nflverse data into data-cache/ (git-ignored) and rebuilds the JSON
```

- **Source:** [nflverse](https://github.com/nflverse/nflverse-data) rosters (names, jersey numbers, positions) and
  regular-season player statistics, licensed **CC-BY 4.0**. The season is recorded in the JSON and shown in the game.
- **Ratings:** every 0–100 rating is computed by `scripts/build-rosters.mjs` from that season's statistics, by the
  formulas documented at the top of that script (rank among the league's starters at the position, mapped to 52–98).
  Linemen, kickers and low-snap players have no usable individual stats and are marked `estimated`. These are this
  game's own ratings, not official measurements and not any other game's ratings.
- **Starters:** the most-used player at each position on each team that season.
- **Checks:** `validateRoster()` (src/engine/roster.ts) runs on every team in the test suite: missing players,
  duplicate or position-illegal jersey numbers, missing or out-of-range ratings, stat-derived ratings with no season.

### Rights: read before a public launch

- The **data license (CC-BY 4.0)** requires attribution to nflverse, which the About page and this file give.
- **Team names and nicknames are NFL trademarks** and **players' names and identities** are the players' own. Using
  them to identify real teams and players in an unaffiliated fan game, with no logos, no marks and a clear
  no-affiliation disclaimer, is how this build is set up, but public availability of the data does not by itself grant
  every commercial use. Using many current players' identities in a commercial product normally involves the NFL
  Players Association's group licensing. Have this reviewed by a lawyer before a commercial launch; the fictional
  roster generator (engine/scenario.ts `makeTeam`) is still there as a fallback if you need to switch back.

## The daily and the leaderboard

The Daily is one game a day, the same for everyone (by UTC date). Its situation type rotates through a weekly
shuffle of seven kinds (two-minute drill, dig out of the hole, win it on this drive, close it out, goal-line stand,
four downs to win, fourth-down call), and the two teams are never the same as the day before.

The end-of-day screen shows the score, a percentile against **simulated play-callers** (`src/data/percentiles.json`,
regenerate with `npm run percentiles` after balance changes), the coach profile, a share card and, when connected,
**Everyone today**: your rank, a histogram and today's best.

"Everyone today" is served by the site's own Worker (`server/site/worker.js`, configured in `wrangler.jsonc`): the
static game from `dist/`, and the leaderboard API under `/v1/`. Scores are kept in Durable Objects (one per day, plus
one for the all-days summary), which the migration in `wrangler.jsonc` creates on deploy, so there is nothing to set
up by hand. The worker stores a nickname, the score and the grade string per browser token per day; nothing
identifying. Names are cleaned and obvious abuse is replaced with "Coach". Scores are self-reported by the browser, so
treat the board as friendly competition, not a contest with prizes.

Run the site and the leaderboard locally with `npm run build && npx wrangler dev`. `VITE_LEADERBOARD_URL` points the
game at a different server, or `off` turns the board off; the Vite dev server has no Worker, so the board is off
there.
