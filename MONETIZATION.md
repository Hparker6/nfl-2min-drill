# Monetization: what is in place and how to turn it on

Nothing here is live until it is deployed, and no ads show until every step under "Turning ads on" is done.

## What the site runs on

- **Framework:** Vite 7 + React 18 + TypeScript, a single-page app (`index.html` → `src/main.tsx` → `src/App.tsx`).
  Modes are hash routes (`#survivor`, `#practice`, `#career`).
- **Hosting:** Cloudflare Workers with static assets (`wrangler.jsonc`). The Worker (`server/site/worker.js`) serves
  the leaderboard API at `/v1/*` and renders `/leaderboard/` and `/stats/`. Everything else is the Vite build in
  `dist/`. **Pushing to `main` deploys**: Cloudflare's Git integration runs `npm run build` and deploys the Worker.
  Build variables (`VITE_*`) are set in the Cloudflare dashboard, not in the repository.
- **Security headers:** `public/_headers` (every static page) and `PAGE_HEADERS` in `server/site/worker.js` (the
  leaderboard and stats pages). Their Content-Security-Policy decides which outside scripts may run.
- **Analytics:** Google Analytics 4 (`src/game/analytics.ts`), plus Cloudflare Web Analytics added by Cloudflare.
  Only gameplay events go to GA; no names, nicknames or contact details.

## What this change adds

| Piece | Where | Behavior |
| --- | --- | --- |
| AdSense verification tag | `<head>` of `index.html`, `public/404.html`, `public/how-to-play/index.html`, and the page template in `server/site/worker.js` | Exactly the snippet from the AdSense dashboard (`ca-pub-2581780385461126`), once per page. The CSP does **not** allow Google's ad domains yet, so browsers block the script and no ads can show, even if Auto ads is switched on in the AdSense dashboard. |
| Footer links | `src/App.tsx` | Feedback (`VITE_FEEDBACK_URL`) and Support the developer (`VITE_SUPPORT_URL`), next to the existing About & privacy. Each link only shows when its variable is set. |
| Ad slot | `src/ui/AdSlot.tsx`, used once at the top of the footer | Renders nothing unless `VITE_ADS=adsense` and a valid `VITE_ADSENSE_CLIENT` and `VITE_ADSENSE_SLOT` are set. It also renders nothing while a game screen or a Career live game is mounted, so an ad is never next to the play list, Snap, Next play or the clock buttons. An unfilled or blocked slot leaves no space and no label. |
| Analytics | `src/game/analytics.ts` | `game_start` already existed, and `spot_complete` is the game-complete event; it keeps its name so GA history stays continuous. `play_again` fires once when a player picks another game after finishing one: a new Survivor run, Survivor or Practice from the finished Daily, or a new Practice spot after playing one. |

## AdSense verification

1. Deploy (see "Deploying" below), then open `https://nfl-2min-drill.com/` → View source and confirm the
   `adsbygoogle.js?client=ca-pub-2581780385461126` line is in the `<head>`.
2. In AdSense → Sites → nfl-2min-drill.com, choose the "AdSense code snippet" method and click Verify.
3. **If AdSense says it cannot find the code**, its checker may be trying to run the script. Either use the
   meta-tag method, which AdSense offers on the same screen, or apply the CSP change in step 4 below early.
   Ads still won't show from the CSP change alone unless Auto ads is on or an ad unit is configured.
4. **Add `public/ads.txt`.** AdSense will ask for it once the site is approved; it isn't needed to verify. The
   exact line is shown in AdSense → Sites. Copy it from there; don't type it from memory.

## Turning ads on (only after AdSense approves the site)

1. **Pick a placement.** In AdSense → Ads → By ad unit, create a display unit and copy its slot ID (a number).
   Keep Auto ads **off**, because Auto ads places ads anywhere, including over the game. The site's slot is
   built to stay away from controls.
2. **Set the build variables** in Cloudflare (Workers & Pages → nfl-2min-drill → Settings → Build → Variables):
   - `VITE_ADS=adsense`
   - `VITE_ADSENSE_CLIENT=ca-pub-2581780385461126`
   - `VITE_ADSENSE_SLOT=<slot ID>`
3. **Allow Google's ad domains** in the Content-Security-Policy in `public/_headers`, and in `PAGE_HEADERS` in
   `server/site/worker.js` if ads should also run on the leaderboard and stats pages. Use the domain list from
   Google's current AdSense CSP guidance. At the time of writing it covers `pagead2.googlesyndication.com`,
   `*.googlesyndication.com`, `*.doubleclick.net`, `*.google.com` and `*.adtrafficquality.google` across
   `script-src`, `img-src`, `connect-src` and a new `frame-src`.
4. **Consent.** Google requires a certified consent tool (CMP) for visitors in the EEA, UK and Switzerland before
   serving them ads. AdSense → Privacy & messaging provides one.
5. **Update the About & privacy text** in `src/ui/Modals.tsx`. It currently says only GA receives anonymous
   events; with ads on it must say that Google may use cookies to serve and measure ads, and link Google's
   "How Google uses information from sites that use our services".
6. **Check before going live.** Run `npm run build`, then `npx wrangler dev`, and check desktop and phone widths.
   The ad should appear only below the page on non-game screens (Daily results, Survivor summary, Practice
   builder, Career hub) and never during a game.

## Support link

Set `VITE_SUPPORT_URL` to a page you own: Ko-fi, Buy Me a Coffee, GitHub Sponsors, or a Stripe Payment Link. Taking
money for a game that uses "NFL" in its domain and real player names adds trademark and publicity-rights risk. Get
the legal review listed in TODO.md before charging.

## Deploying

1. Set any new variables in Cloudflare first (step 2 above). A variable that is added after a build only takes
   effect on the next build.
2. Merge the `monetization` branch into `main` and push: `git checkout main && git merge monetization && git push`.
   Cloudflare builds and deploys automatically, in about a minute.
3. Check the live site: view source for the verification tag, check the footer links, and play one Daily on a
   phone.
4. **To roll back,** run `git revert` on the merge and push, or use Deployments → Rollback in Cloudflare.
