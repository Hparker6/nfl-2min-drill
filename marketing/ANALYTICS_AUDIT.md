# Analytics Audit: The 4th Call

Audit date: 2026-10-17. Scope: the code in this repository, the live site's responses, and test runs in a local
browser. **No GA4, Search Console or Cloudflare account data was available**, so every number from those tools in
the brief is treated as unverified. What follows says which conclusions come from code, which from measurement, and
which need account access.

## 1. Summary and confidence

- **The tracking code is sound and singular:** one GA4 tag (loaded by `src/game/analytics.ts`), no Tag Manager, no
  duplicate tag. Cloudflare Web Analytics is injected by Cloudflare at the edge on every page. High confidence (code).
- **The ~56K events are consistent with real gameplay.** One complete Daily game measured locally fired 177 events, 83
  of them `phase`. 56K events / ~303 users is ~185 per user: about one game each. Medium confidence: the GA4 numbers
  include other sites in the property and could not be filtered here.
- **Four counting problems were found, and all four are fixed locally (not deployed):**
  1. Non-production traffic (local development, `vite preview`, automated test runs) sent events to the shared
     property. Fixed: analytics now runs only on `nfl-2min-drill.com`.
  2. Closing a tab fired `leave` twice. Fixed.
  3. A refresh right after starting a Daily reported a second, fresh `game_start`. Fixed.
  4. In Career mode every handed-over drive fired its own `game_start`, so one career game counted as several. Fixed:
     one `game_start` per career game played.
- **Our own test traffic is in the data.** During this work, headless test runs against a local build loaded the
  production tag (hostname `localhost`, removed by a hostname filter), and two Lighthouse audits loaded the live site on
  2026-10-17 (hostname `nfl-2min-drill.com`, *not* removed by a hostname filter; they have no gameplay events). Your own
  play-testing is in the data too: see the internal-traffic filter in section 5. The follow-up verification in section 11
  blocked every analytics request, so it added nothing.

**Confidence overall: medium for the event model (code-verified, locally measured), low for any current user count
until the hostname-filtered GA4 exploration in section 5 is built.**

## 2. Architecture and tracking inventory

| Layer | What it is | Where | Pages it sees |
|---|---|---|---|
| GA4 (gtag.js) | Loaded by `initAnalytics()` at app start; measurement ID built in (`VITE_GA_ID` overrides, `off` disables) | `src/game/analytics.ts`, `src/main.tsx` | The game page only (`/`, including `#survivor`, `#practice`, `#career`) |
| Cloudflare Web Analytics | Beacon injected by Cloudflare into HTML responses (verified with a browser user agent) | Cloudflare dashboard, not in code | Every page: `/`, `/how-to-play/`, `/leaderboard/`, `/stats/` |
| Cloudflare HTTP analytics | Edge request counts, status codes | Cloudflare dashboard | Every request, including assets, redirects, bots |
| Search Console | Google search results | Google | Search impressions and clicks, not visits |

- **Page views:** GA4's automatic `page_view` on load (`send_page_view: true`). Modes are hash routes (`#survivor`…);
  the app reports them as a custom `screen_view` event with a `mode` parameter. Whether GA4's enhanced measurement also
  sends a `page_view` on a hash change is not determined from code: check in DebugView (section 9).
- **Consent:** none. GA4 runs for every visitor. The recommendation before ads go live is in section 11.
- **AdSense:** the AdSense script tag is in the pages, but neither Content Security Policy allows Google's ad
  domains, so the browser blocks it. No ads or ad cookies run today (verified on the live header).
- **Environments:** before this audit GA4 ran on any hostname. Now it runs only on `nfl-2min-drill.com` and
  `www.nfl-2min-drill.com` (`www` redirects to the apex at the edge, so it should never actually appear).
- **Redirects (live, verified):** `http://` → `https://` 301; `www` → apex 301; `/how-to-play` → `/how-to-play/` 307;
  `/index.html` → `/` 307; `/leaderboard` and `/stats` → trailing slash 301. Canonical tags point at the apex.
- **Personal data:** none sent. Event parameters are game state (mode, call keys, grades, counts). The leaderboard
  nickname is never sent to analytics. `anonymize_ip` is a no-op in GA4, which does not store IPs.

### Event inventory

Firing counts are from one measured Daily game (26 calls) unless noted.

| Event | Where it fires | Meaning | Duplication / volume | Status |
|---|---|---|---|---|
| `page_view` (auto) | gtag config on load | The game page loaded | Once per load | Code-verified |
| `screen_view` | `App.tsx`, on mode change | Switched to daily / survivor / practice / career / everyone | Once per mode visit. **Not** a reserved name for web streams (checked against Google's list); the browser sends it with `mode` (verified in a blocked-request capture). GA4 receipt to confirm in DebugView | Sent; receipt unconfirmed |
| `modal_open` | `App.tsx` | Help, stats, settings or about opened | Per open | Code-verified |
| `brief_shown` | `GameScreen.tsx` | The pre-game brief is on screen | Once per game shown | Measured: 1 |
| `game_start` | `GameScreen.tsx` (Take the headset; resume on load), `Career.tsx` (career game) | A game was started (`resumed: false`) or resumed (`resumed: true`) | **Fixed:** refresh-after-start double count; per-drive counting in Career | Measured: 1 |
| `phase` | `GameScreen.tsx`, every phase change | Internal state: auto / deciding / snapping / result / over | **High volume: 83 of 177 events.** Low value: the same funnel is in decision_shown, call_made, result_shown | Measured; kept for now (retirement steps in section 11) |
| `decision_shown` | `GameScreen.tsx` | A decision is on the board | Per decision | Measured: 23 |
| `call_made` | `GameScreen.tsx` | The player made a call (a tempo and a play in one tap send two, by design: two decisions) | Per decision made | Measured: 26 |
| `result_shown` | `GameScreen.tsx` | A graded play result is on screen | Per snap the player called | Measured: 20 |
| `grade_failed` | `GameScreen.tsx` | Grading couldn't finish (the play stood) | Rare | Code-verified |
| `next_play` | `GameScreen.tsx` | Player moved on from a result | Per result | Measured: 20 |
| `replay` | `GameScreen.tsx` | Watched a play again | Per replay | Code-verified |
| `spot_complete` | `GameScreen.tsx` `finish()`, guarded by a ref | A game ended (`win`, `calls`). The "completed game" event | Once per game | Measured: 1 |
| `daily_complete` | `Daily.tsx` | The Daily ended (`win`, `performance`) | Once per Daily, alongside spot_complete (by design) | Measured: 1 |
| `play_again` | `Daily.tsx`, `Survivor.tsx`, `Practice.tsx` | Chose another game after finishing (`from`, `to`) | Per click | Code-verified |
| `survivor_new_run`, `survivor_end` | `Survivor.tsx` | A Survivor run began / ended | Once each per run | Code-verified |
| `practice_setup` | `Practice.tsx` | Set up a Practice spot | Per setup | Code-verified |
| `leaderboard_submit` | `Daily.tsx` | Posted a Daily score | Per post | Code-verified |
| `share` | `share.ts`, `Daily.tsx` | Shared a result (`what`, `method`) | Per share | Code-verified |
| `welcome_link` | `Daily.tsx` | First-visit links clicked | Per click | Code-verified |
| `career_start` | `Career.tsx` | A career was created (`arch`) | Once per career | Code-verified |
| `career_game` | `Career.tsx` | A career game finished (`how`: sim, moments, full) | Once per game | Code-verified |
| `leave` | `analytics.ts`, tab hidden or page closed | Where the player was when they left | **Fixed:** was two per tab close | Unit-tested |
| `app_error` | `analytics.ts`, `career/Boundary.tsx` | An uncaught error (message only) | Per error | Code-verified |

Not implemented, and not added: `drive_complete` (the game's unit is the late-game spot; `spot_complete` is the
completed-game event, and a separate drive event would add volume without a question it answers) and
`career_progression` (no evidence yet that it's needed; draft night, level-ups and upgrades could be added later).

## 3. Event model and counting rules

| Metric | Definition | Source |
|---|---|---|
| Qualified visit | A GA4 session with hostname `nfl-2min-drill.com`, excluding internal traffic. Bots that run JavaScript can still appear; GA4 removes known bots only | GA4 |
| Game start | `game_start` with `resumed = false` | GA4 |
| Active player | A user with at least one `call_made` | GA4 |
| Completed game | `spot_complete` (all modes except career moments) or `career_game` with `how` ≠ `sim` | GA4 |
| Gameplay conversion | Qualified sessions with a `game_start` (`resumed = false`) ÷ qualified sessions, same date range | GA4 funnel |
| Completion rate | Users who reached `spot_complete` after `game_start` ÷ users with `game_start`, in a closed funnel over a date range that ended at least a day ago (games can be resumed later) | GA4 funnel |
| Returning player | User property `days_played` ≥ 2 (the game sets it from its own saved history, so it survives cookie resets but is per browser), or GA4 "returning" users | GA4 |
| Engagement | GA4's own definitions: an engaged session lasts 10+ seconds, has a key event, or has 2+ page/screen views; engagement time is time with the page in focus | GA4 |

What these don't measure: a Cloudflare "visit" is not a unique person; a Search Console impression is not a visit; a
page view is not a game start; GA4 users are browsers (cookies), not people, and an ad blocker hides the user entirely.

**Event parameters, consistent across the gameplay events:** `mode` (daily, survivor, practice, career) on every
gameplay event except `play_again` (`from`, `to`). No game id is sent: GA4 funnels work per user and session, and an id
would add a high-cardinality parameter with no report that needs it.

## 4. Issues

**Verified (code or measurement), fixed locally:**
- Analytics ran on every hostname (local, preview, tests). `src/game/analytics.ts`.
- `leave` fired twice on tab close. `src/game/analytics.ts`.
- `game_start` double-counted a refresh right after starting, and counted each Career drive. `src/ui/GameScreen.tsx`,
  `src/ui/career/Career.tsx`.

**Verified, not changed (needs your decision):**
- `phase` is about half of all events and largely duplicates the decision / call / result funnel. Kept for now, by
  your decision; section 11 lists how to retire it safely.
- No consent mechanism. If the site serves visitors in the EEA, UK or Switzerland, analytics cookies generally need
  consent first (and AdSense requires a certified consent tool for personalized ads). Recommendation in section 11.
- GA4 doesn't run on `/how-to-play/`, `/leaderboard/` or `/stats/`, so landing on those pages never shows up in GA4.
  That's acceptable (they're small static pages, and Cloudflare covers them), but GA4 landing-page reports will only
  ever show `/`.

**Suspected (needs GA4 access to confirm):**
- The 7m27s average engagement time may mix in the other sites in the property.
- Whether enhanced measurement sends extra `page_view`s on hash changes.

**Needs account access:** every count in the brief (GA4 users, sessions, events, channels; Cloudflare visits and
status codes; Search Console queries). No query report was provided, so Search Console queries could not be grouped.

## 5. GA4: isolate this site

1. **Internal traffic (do this first):** Admin → Data streams → (the web stream) → Configure tag settings → Define
   internal traffic → Create: rule name `Owner`, IP address equals your public IP (search "what is my IP"). Then Admin
   → Data settings → Data filters → the "Internal traffic" filter → set to **Active**. Applies going forward only.
2. **Hostname filter in every exploration:** Explore → Free form → Variables: add dimensions *Date, Hostname, Landing
   page + query string, Session source / medium, Device category*, metrics *Sessions, Active users, New users, Engaged
   sessions, Engagement rate, Average engagement time per session, Event count, Key events*. Settings → Filters →
   **Hostname exactly matches `nfl-2min-drill.com`**. (Add `www.nfl-2min-drill.com` as "or" only if it ever appears;
   the edge redirect should prevent it.) Rows: Session source / medium; Columns: Device category.
3. **Gameplay events table:** same exploration, add dimension *Event name*, filter Event name matches regex
   `^(game_start|call_made|result_shown|spot_complete|daily_complete|career_game)$`.
4. **Custom dimensions** (Admin → Custom definitions): event-scoped `mode`, `resumed`, `win`, `how`; user-scoped
   `days_played`. Without these, parameters can't be used as dimensions. Applies going forward only.
5. **Key events** (Admin → Events): mark `game_start`, `spot_complete` and `career_game` (`spot_complete` doesn't
   fire in Career; see section 11).
6. **Funnel exploration** (Explore → Funnel, open funnel off, hostname filter as above): (1) `session_start`, (2)
   `game_start` with `resumed` = false, (3) `call_made`, (4) `result_shown`, (5) `spot_complete`. Breakdown: Session
   source / medium. Step 5 is the completed game; a separate drive step isn't measured (see section 2).
7. **A separate property** is justified only if the hostname filter becomes a burden: it would give clean standard
   reports, but changing the live measurement ID splits history. Not recommended now.

## 6. Reconciling the platforms

| | GA4 | Cloudflare Web Analytics | Cloudflare HTTP | Search Console |
|---|---|---|---|---|
| Counts | Browsers that ran gtag on the game page | Page loads that ran the beacon, on every page | Every request | Google search impressions and clicks |
| Bots | Known bots removed | Some removed | All counted | n/a |
| Blocked by ad blockers | Often | Less often | Never | n/a |
| Time zone | Property's | UTC by default | UTC | Pacific time |
| Delay | Minutes (Realtime) to ~a day | Minutes | Minutes | ~2 days |

Expected relationships: Cloudflare page views > GA4 page views (more pages, fewer blocked scripts, more bots). GA4
sessions on `/` should be well under Cloudflare visits. Search Console clicks should roughly match GA4
`google / organic` sessions on `/`, minus blocked tags and pages GA4 doesn't run on.

**Cloudflare 3xx:** mostly expected: `http` → `https`, `www` → apex, trailing slashes and `/index.html` (all verified
live). **Cloudflare 4xx:** likely sources, verified as 404 live: `/favicon.ico` (browsers ask for it by default; the
site declares an SVG icon), `/ads.txt` (AdSense crawls it), old hashed `/assets/…` files after every deploy (tabs open
during a deploy, crawlers), and probes like `/wp-login.php`. Confirm with Cloudflare's path breakdown before judging
any of it as malicious; a cheap fix for the first is a `favicon.ico` file.

**Search Console grouping (when the query export is available):** branded: `4th call`, `the 4th call`; generic intent:
`2 minute drill`, `two minute drill game`, `play calling game`, `football strategy game`; competitor-branded: other
games' names (for example Sega's "NFL 2 Minute Drill"); everything else ambiguous or irrelevant. Intent from a query is
a guess, not a fact.

## 7. Code changes (local, not deployed)

| File | Change | Why | Risk |
|---|---|---|---|
| `src/game/analytics.ts` | Run only on `nfl-2min-drill.com` / `www.`; `leaveOnce` sends one `leave` per time away | Non-production events and double `leave` | Local and preview builds no longer report (intended) |
| `src/ui/GameScreen.tsx` | A resume always reports `resumed: true`; career moments don't send `game_start` | Double-counted starts | `game_start` (resumed = false) counts drop to real starts |
| `src/ui/career/Career.tsx` | One `game_start` (`mode: career`, `how`) when a career game is played | Career starts were per drive | New `how` parameter |
| `src/game/analytics.test.ts` | Tests for the hostname gate, single `leave`, no-op without the tag | | |

Event names are unchanged. Awaiting your approval: a consent mechanism before ads (section 11) and a `favicon.ico`.
`phase` stays for now.

## 8. Build and tests

Production build succeeds; type check clean; 23 test files, 198 tests pass (3 new in `src/game/analytics.test.ts`). The event counts in section 2 come from a
headless browser playing a full Daily with a stand-in tag that recorded events locally and sent nothing.

## 9. Manual validation (after deploying the fixes)

Install the "Google Analytics Debugger" Chrome extension (it turns on DebugView for your browser only), then open
GA4 → Admin → DebugView. Don't send test events just to fill reports: one pass through each case is enough.

- [ ] First visit to `https://nfl-2min-drill.com/`: `page_view`, `session_start`, `first_visit`, one `screen_view`
      with `mode = daily`. If `screen_view` never shows in DebugView, rename it (for example `mode_view`); otherwise keep it.
- [ ] Take the headset: one `game_start` with `resumed = false`, then `decision_shown`.
- [ ] Make a call: `call_made`, then `result_shown` once graded.
- [ ] Finish the game: one `spot_complete` (and `daily_complete` for the Daily).
- [ ] Refresh mid-game: one `game_start` with `resumed = true`, no `resumed = false`.
- [ ] Switch tabs and close the tab: one `leave`, not two.
- [ ] Career: play a game in Moments mode; exactly one `game_start` (`mode = career`), several `call_made`, one
      `career_game` at the end.
- [ ] Local: run `npm run preview`, open DevTools → Network, filter `collect`: no requests to google-analytics.
- [ ] With an ad blocker on: no GA requests (expected; those visitors are invisible to GA4 but not to Cloudflare).
- [ ] DevTools → Network, filter `collect?v=2`: each request's `en=` is the event name. Expect one request per hit to
      `google-analytics.com`. A copy to `www.google.com` blocked by the security policy is expected (section 11).

## 10. Weekly dashboard

Hostname-filtered, internal traffic excluded, Monday to Sunday, GA4 time zone:

| Tile | Definition |
|---|---|
| Qualified sessions | Sessions, hostname filter |
| Game starts | `game_start` where `resumed` = false |
| Gameplay conversion | Sessions with a game start ÷ sessions |
| Active players | Users with `call_made` |
| Completed games | `spot_complete` + `career_game` (not sim) |
| Completion rate | Funnel step 5 ÷ step 2, previous complete week |
| Engaged players by source | Users with `call_made`, by Session source / medium |
| Returning players | Users with `days_played` ≥ 2 |
| Search | Search Console clicks, impressions, CTR, position (property for this domain only) |
| Cloudflare cross-check | Web Analytics page views for `/` |

## Trust table

| Can be trusted now | Provisional | Can't be measured reliably yet |
|---|---|---|
| The event model and where each event fires (code) | Any GA4 count before the hostname filter and internal-traffic filter are applied | Unique humans (no tool measures people) |
| Events per played game (measured: ~177 for a 26-call Daily) | Game starts before the fix deploys (double counts) | Returning players across devices or after clearing storage |
| Search Console clicks/impressions as search data | Engagement time (shared property) | `screen_view` receipt until seen in DebugView |
| Redirect behavior and canonicals (verified live) | Cloudflare visits as a traffic trend | Visitors with ad blockers (invisible to GA4) |
| | Source/medium for in-app browser traffic | Landing on `/how-to-play/`, `/leaderboard/`, `/stats/` in GA4 |

## 11. Follow-up verification (2026-10-17)

### How it was verified, without sending data

A throwaway Chrome profile loaded the **local build** on the production hostname (an HTTP proxy served `dist/` for
`nfl-2min-drill.com` and refused any connection to the real site). Every request to Google Analytics was intercepted,
recorded and **failed**, so nothing reached GA4; Cloudflare's beacon was blocked the same way. A second profile loaded
the local build on `localhost`.

Two earlier attempts in this verification loaded the **live site** instead of the local build (the hostname mapping
didn't take, then Chrome upgraded to HTTPS). Those runs made ordinary page and asset requests and two read-only
leaderboard lookups; their GA4 and Cloudflare-beacon requests were blocked like the rest. They did confirm what
production does today (below).

### Results

| Check | Result | Evidence |
|---|---|---|
| Analytics only on `nfl-2min-drill.com` | **Pass.** On `localhost`, gtag.js is never requested; on `nfl-2min-drill.com` it loads | Blocked-request capture, both hosts; unit test `analyticsAllowed` |
| `game_start` once per new game | **Pass.** One `game_start` (`resumed = false`) when the Daily starts | Capture |
| Daily resume isn't a new game | **Pass.** After a refresh mid-game: one `game_start` with `resumed = true`. Production today sends `resumed = false` if the refresh comes before the first call (fixed) | Capture, live and local |
| Career drives aren't separate games | **Pass.** A bowl game in Moments mode with three handed-over drives: one `game_start` (`mode = career`, `how = moments`), one `career_start`, 20 `call_made` | Capture |
| One `leave` per exit | **Pass** locally (1 on a reload); **production sends 2** today | Capture, live and local |
| `screen_view` sent | **Yes**, on each load, with `mode` | Capture |
| Each hit, two endpoints | gtag sends each hit to `www.google-analytics.com/g/collect` and also tries `www.google.com/g/collect` with the same sequence number (`_s`). That's gtag's own behavior, not our code firing twice. The test proxy served the build without the site's security headers, so both copies showed. In production the Content Security Policy doesn't allow `www.google.com`, so the browser blocks the copy and GA4 gets each hit once | Capture; live header |

### `spot_complete`: confirmed

It exists (`GameScreen.tsx`, `finish()`), fires once per game (guarded by a ref; measured once in a full Daily), and
fires in Daily, Survivor and Practice. It does **not** fire for Career games (their moments end through the segment
path); Career's completed game is `career_game` (`how` = moments or full; `sim` means the game wasn't played). It
doesn't fire if the player leaves before the final whistle, which is the intended meaning: a completed game.
**Recommendation:** mark both `spot_complete` and `career_game` as key events, and count completed games as
`spot_complete` + `career_game` where `how` ≠ `sim`.

### `phase`: kept, and how to retire it safely

`phase` stays for now (83 of 177 events in a measured game). To stop it once it's shown to add nothing:

1. In GA4, check that no exploration, audience, key event, custom dimension or report uses `phase` (Admin → Events,
   Admin → Audiences, Admin → Custom definitions, and each saved exploration).
2. Confirm the funnel you rely on is covered without it: `decision_shown` (on the board) → `call_made` → `result_shown`
   → `next_play` / `spot_complete`, and `leave` for where people drop off (it carries the phase as a parameter from
   `setContext`, independent of the `phase` event).
3. Remove the one line that emits it: `track('phase', …)` in the phase effect in `src/ui/GameScreen.tsx`. Keep the
   `setContext(...)` call in the same effect, so `leave` and `app_error` still report where the player was.
4. Remove `'phase'` from the `EventName` type in `src/game/analytics.ts`, run the tests, deploy, and annotate the date
   in GA4 so the drop in event volume is explained.

### Consent before ads go live (not legal advice)

What applies:
- **AdSense:** Google requires a **Google-certified CMP integrated with the IAB TCF** to serve personalized ads in the
  EEA and UK (since 16 January 2024) and Switzerland (since 31 July 2024). Without one, that traffic is limited to
  non-personalized or limited ads. Google's own CMP (AdSense → Privacy & messaging → European regulations message) is
  on the certified list.
- **GA4 in the EEA:** analytics cookies need consent under the ePrivacy rules. **Google Consent Mode v2**
  (`analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`) is how the consent choice reaches Google's
  tags; Google requires it for EEA/UK ad measurement.
- **GA4 in the UK:** the Data (Use and Access) Act 2025 added a consent exception for purely statistical cookies, but
  commentary consistently says it doesn't cover GA4, because the data goes to Google, which uses it for its own
  purposes. Treat UK visitors like EEA visitors.

The simplest compliant setup:
1. In AdSense, create and publish the **European regulations message** (Google's certified CMP) for the EEA, UK and
   Switzerland. It's free and is delivered by the AdSense script, which is already in the pages but blocked by the
   security policy today (step 3).
2. In `src/game/analytics.ts`, before the `config` call, set Consent Mode defaults to **denied** for those regions
   (`gtag('consent', 'default', { analytics_storage, ad_storage, ad_user_data, ad_personalization: 'denied', region:
   [EEA countries, 'GB', 'CH'] })`), and let the CMP's choice update them. Everyone else keeps today's behavior.
   This is Consent Mode's "advanced" setup: before a choice, GA4 sends cookieless pings without identifiers. The
   cautious "basic" setup sends nothing until the visitor agrees, for a little more code (load the tag only after
   the consent tool reports a yes). Some EU regulators view even cookieless pings as needing consent, so ask your
   privacy adviser which to use.
3. Allow the consent message's domains (for example `fundingchoicesmessages.google.com`) and the AdSense domains in
   the Content Security Policy, in both `public/_headers` and the Worker's page headers. Today neither policy allows
   any Google ad domain, which is why no ads run. While testing, the browser console lists anything still blocked.
4. Test with a VPN from an EEA country: the message appears, GA4 sends no cookies before a choice, and DebugView
   shows the consent state.

This is a separate change that needs your approval, and it's worth a short check with a privacy professional before
ads go live. Sources: AdSense Help on the certified-CMP requirement (support.google.com/adsense/answer/13554116);
Google Analytics Help on reserved event names (support.google.com/analytics/answer/13316687); ICO and law-firm
summaries of the Data (Use and Access) Act 2025; consent-mode guides from Cookiebot, CookieYes and Simo Ahava.

### Exact next steps

1. **Approve, commit and deploy** the analytics fixes: three source files and one new test file, none committed.
2. **GA4 (you):** the internal-traffic filter for your IP; custom dimensions `mode`, `resumed`, `win`, `how`,
   `days_played`; key events `game_start`, `spot_complete`, `career_game`.
3. **After deploying, in DebugView:** confirm `screen_view` is received, each event counts once (not twice despite
   the two endpoints), one `leave` per exit, one `game_start` per new game.
4. **Build the hostname-filtered exploration and funnel** (section 5) and use only data from the deploy date forward
   for counts of game starts.
5. **Before ads:** the consent setup above, the AdSense CSP and `ads.txt`.
6. **Later:** retire `phase` with the steps above once it's shown to add nothing.
7. **Measurement ID in docs:** it was removed from `README.md` and `marketing/CONTENT_PLAYBOOK.md` (local, not
   committed). It's still in the page's JavaScript and in git history, which is normal: a GA4 measurement ID is
   public by design and isn't a secret.
