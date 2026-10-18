# Launch Checklist

Three parts: what to check on your machine, what needs your decision, and what to verify once the site is live.
Commands are for Git Bash from the repository root. In PowerShell, use `curl.exe` instead of `curl`, and set build
variables with `$env:VITE_SITE_URL='https://nfl-2min-drill.com'` on its own line before the command.

**Pushing to `main` deploys.** The site is a Git-connected Cloudflare Workers build (see `wrangler.jsonc`), so
`git push` is the deploy step. Don't push until sections A and B are done.

## A. Local checks

### A1. Build and tests

```bash
VITE_SITE_URL=https://nfl-2min-drill.com npm run build   # type-check + production build into dist/
npm test                                                  # 20 files, 183 tests at last run
node --check server/site/worker.js                        # the Worker parses
```

Pass: the build ends with `✓ built in …`, the tests report `183 passed`, and `node --check` prints nothing.

### A2. Review the diff

```bash
git status --short                 # expect 7 modified files and the new marketing/ folder
git diff --stat
git diff                           # read every line
git diff -- server/site/worker.js  # the noindex flag and page titles
git diff -- src/                   # only text and aria labels; no logic
git status --short marketing/      # new, untracked
```

Check that the diff touches no gameplay, analytics, monetization or Cloudflare configuration:

```bash
git diff --stat -- src/engine src/game src/ui/AdSlot.tsx public/_headers wrangler.jsonc   # expect no output
```

### A3. SEO and accessibility (on the build output)

```bash
grep -oE '<title>[^<]*|<meta name="(description|robots)"[^>]*>|<link rel="canonical"[^>]*>' dist/index.html
grep -oE '<title>[^<]*|<meta name="robots"[^>]*>|<link rel="canonical"[^>]*>' dist/how-to-play/index.html
cat dist/robots.txt dist/sitemap.xml
grep -n "INDEXABLE" server/site/worker.js
```

Expect:
- Home title `The 4th Call: Free 2-Minute Drill Football Strategy Game`, robots `index, follow`, canonical
  `https://nfl-2min-drill.com/`.
- How-to-play title `How to Play The 4th Call: Controls & 2-Minute Drill Strategy`, canonical
  `https://nfl-2min-drill.com/how-to-play/`.
- robots.txt allows everything and names the sitemap. The sitemap lists exactly `/` and `/how-to-play/`.
- `INDEXABLE` is `false` for `/leaderboard/` and `/stats/`, and the page template prints `noindex, follow` from it.

Optional, to see the Worker pages locally (downloads Wrangler, the tool Cloudflare's build already uses):

```bash
npx wrangler dev                 # then, in a second terminal:
curl -s http://localhost:8787/leaderboard/ | grep -oE '<title>[^<]*|<meta name="robots"[^>]*>'
curl -s http://localhost:8787/stats/       | grep -oE '<title>[^<]*|<meta name="robots"[^>]*>'
```

Optional, Lighthouse on the local build (mobile settings):

```bash
npm run preview                  # serves dist/ at http://localhost:4173, then in a second terminal:
npx lighthouse@12.8.2 http://localhost:4173/ --form-factor=mobile --only-categories=performance,accessibility,seo --view
```

The accessibility fixes (a name for the logo link, a role for the "has the ball" marker) should clear the
`aria-command-name`, `link-name` and `aria-prohibited-attr` findings. One known issue remains: some team-color chips
on the scoreboard have low contrast. It's cosmetic and isn't in this change.

### A4. Marketing assets

- [ ] Open `marketing/assets/end-card.png`. It should be 1080×1920 and show "Link in bio", `nfl-2min-drill.com` and the
      no-affiliation line, with nothing in the bottom fifth of the frame.
- [ ] The tracker has the same column count on every row:
      ```bash
      awk -F, '{print NF}' marketing/WEEKLY_CONTENT_TRACKER.csv | sort -u    # expect: 23
      ```
- [ ] Every linked file exists:
      ```bash
      grep -ohE '\]\([^)# ]+[)#]' marketing/*.md | sed -E 's/^\]\(//; s/[)#]$//' | grep -v '^http' | sort -u | while read f; do [ -e "marketing/$f" ] && echo "ok $f" || echo "MISSING $f"; done
      ```
- [ ] Skim [VIDEO_IDEAS.md](VIDEO_IDEAS.md): the Conditional and Mode columns say which videos depend on a moment
      happening and which need real-roster modes.

## B. Needs your approval (nothing here has been done)

| # | Action | How |
|---|---|---|
| B1 | **Commit** the SEO, accessibility, README and marketing changes | `git add -A && git commit -m "SEO metadata, noindex thin pages, a11y labels, README, marketing kit"` |
| B2 | **Push = deploy** to Cloudflare | `git push origin main`, then watch the build in Cloudflare → Workers & Pages → nfl-2min-drill → Deployments |
| B2a | **Daily rule start dates** | New Daily rules start on dated constants in `src/engine/scenario.ts`: `FAIR_FROM` (`2026-10-19`, fair clocks) and `COV_FROM` (`2026-10-20`, coverage schemes). Deploy before those UTC dates, or move them to dates after the deploy, so nobody's in-progress Daily changes mid-day |
| B3 | **Always Use HTTPS** (the HTTP homepage currently returns 200, not a redirect) | Cloudflare dashboard → nfl-2min-drill.com → SSL/TLS → Edge Certificates → **Always Use HTTPS: On** |
| B4 | **Real team and player names in marketing videos** | Decide, ideally after a short consult with an IP lawyer. Until then, record Career mode (see CONTENT_PLAYBOOK.md section 3) |
| B5 | Any other **production setting** (DNS, caching rules, Worker settings) | Not needed for launch. Make no changes |
| B6 | Any **analytics implementation** change | None needed. The only candidate (a UTM on the share link) is described in CONTENT_PLAYBOOK.md section 10 and is optional |

### Monetization: separate follow-up tasks (AdSense stays off)

The live site isn't monetization-ready, and nothing here changes that. Each task needs its own approval and testing:

1. **Content Security Policy:** the policy in `public/_headers` blocks the AdSense script that every page loads, which
   shows as a console error. Showing ads would need Google's ad domains (scripts, frames, images) added there and in the
   Worker's `PAGE_HEADERS`.
2. **ads.txt:** `https://nfl-2min-drill.com/ads.txt` returns 404. AdSense expects one line with your publisher ID.
3. **Consent:** serving personalized ads to visitors in the EEA, UK or Switzerland requires a Google-certified consent
   management platform. GA4 consent handling may need review at the same time.
4. **Ad placements:** `VITE_ADS`, `VITE_ADSENSE_CLIENT` and `VITE_ADSENSE_SLOT` stay unset until the site is approved and
   items 1–3 are done. See MONETIZATION.md.

## C. After deployment

Run these once the Cloudflare build shows the new deployment as active.

### C1. Redirects

```bash
curl -sI http://nfl-2min-drill.com/ | grep -iE '^HTTP|^location'          # expect 301 → https://nfl-2min-drill.com/ (only after B3)
curl -sI https://www.nfl-2min-drill.com/ | grep -iE '^HTTP|^location'     # expect 301 → https://nfl-2min-drill.com/
curl -sI https://nfl-2min-drill.com/how-to-play | grep -iE '^HTTP|^location'   # expect a redirect to /how-to-play/
curl -sI https://nfl-2min-drill.com/leaderboard | grep -iE '^HTTP|^location'   # expect 301 → /leaderboard/
curl -s -o /dev/null -w '%{http_code}\n' https://nfl-2min-drill.com/nope         # expect 404
```

### C2. Metadata, canonicals, sitemap

```bash
curl -s https://nfl-2min-drill.com/ | grep -oE '<title>[^<]*|<link rel="canonical"[^>]*>|<meta name="robots"[^>]*>'
curl -s https://nfl-2min-drill.com/how-to-play/ | grep -oE '<title>[^<]*|<link rel="canonical"[^>]*>|<meta name="robots"[^>]*>'
curl -s https://nfl-2min-drill.com/robots.txt
curl -s https://nfl-2min-drill.com/sitemap.xml
```

Expect the same values as A3. If the old "NFL 2-Minute Drill Game" title still shows, the deploy hasn't finished or
was cached. Wait a few minutes.

### C3. Intended noindex

```bash
curl -s https://nfl-2min-drill.com/leaderboard/ | grep -oE '<title>[^<]*|<meta name="robots"[^>]*>'   # noindex, follow
curl -s https://nfl-2min-drill.com/stats/       | grep -oE '<title>[^<]*|<meta name="robots"[^>]*>'   # noindex, follow
curl -s https://nfl-2min-drill.com/ | grep -c 'noindex'                                               # expect 0
```

### C4. Gameplay on desktop and mobile (10 minutes, by hand)

- [ ] Desktop Chrome: play today's Daily to the end. The brief, call panel, play animation, result card and end screen
      all work, and the header logo still returns to the Daily.
- [ ] Phone (a real one if possible): the same flow. The scoreboard and field pin while the call list scrolls, and the
      Snap button is reachable.
- [ ] Survivor and Practice each start a game. Career opens.
- [ ] Footer links (How to play, Leaderboard, Stats) open, and their "Play" buttons return to the game.

### C5. GA4 events and hostname filtering

1. GA4 → Reports → **Realtime**. If it offers a comparison or filter on **Hostname**, set it to exactly
   `nfl-2min-drill.com`. If not, the `test` source below identifies your own visit.
2. In a private window, open `https://nfl-2min-drill.com/?utm_source=test&utm_medium=launch_check`, take the headset,
   finish a game and press a "Play again" option.
3. Within a minute, Realtime should show `page_view`, `game_start`, `call_made`, `spot_complete` and `play_again`, and
   the source `test`.
4. One-time setup (CONTENT_PLAYBOOK.md section 10): register the event-scoped custom dimensions `mode` and `win` (and
   optionally `from` and `to`), and mark `game_start` as a key event. Registering affects reporting from that day on
   only.
5. Cloudflare dashboard → Analytics & Logs → Web Analytics → the nfl-2min-drill.com site: visits appear.

### C6. Search Console

1. Search Console → choose the **nfl-2min-drill.com** property (not another site's).
2. Sitemaps → submit `https://nfl-2min-drill.com/sitemap.xml`. Status should become "Success" with 2 discovered pages.
   You can remove an older submission that listed 4 pages.
3. URL Inspection → `https://nfl-2min-drill.com/` → Test live URL → Request indexing. Do the same for `/how-to-play/`.
4. URL Inspection on `/leaderboard/` should report "Excluded by 'noindex' tag" once it's recrawled. That's intended.
5. Optional: run `npm run indexnow` to ping Bing and the other IndexNow engines.
6. Optional: paste the home page URL into the [Schema Markup Validator](https://validator.schema.org/). The `WebSite`
   and `VideoGame` data should parse without errors. Google shows no rich result for this type, so the Rich Results
   Test may report "no items", and that's expected.

Search changes take days to weeks to show up, so check Search Console monthly, not daily.
