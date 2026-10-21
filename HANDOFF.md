# Handoff: `coachs-edition` (accounts and the Coach's Edition purchase)

## START HERE (updated 2026-10-22, end of the work-PC session)

**Three branches matter:**

| Branch | What it is | Status |
|---|---|---|
| `main` | The live site (nfl-2min-drill.com). Pushing it deploys. | Unchanged since `8bc5726` (kickoff cam). |
| `live-ads` | `main` + the leaderboard integrity fix + ads. **Ready to go live.** | Pushed. Waiting on the owner (Claude Code's permission check blocks pushes to `main`). |
| `coachs-edition` | Everything else: accounts, the $4.99 Coach's Edition, Stripe, the Coach's Playbook, career and game polish. Deployed to staging only. | Pushed. Waits on Stripe live (the owner needs an EIN first). |

**To put ads and the leaderboard fix live (the owner):** from the repo folder, `git push origin live-ads:main`, or open
https://github.com/Hparker6/nfl-2min-drill/pull/new/live-ads, create the pull request and merge it. Then:
- AdSense → Sites: the site showed **"Getting ready"** (Google's review) and ads.txt **"Not found"** on 2026-10-22,
  because ads.txt wasn't live yet. Once `live-ads` is live, `https://nfl-2min-drill.com/ads.txt` must show
  `google.com, pub-2581780385461126, DIRECT, f08c47fec0942fa0`; Google re-checks within about a day. No ads fill until
  the site is approved. Unfilled slots take no space and show no label, so nothing looks broken meanwhile.
- **Keep AdSense Auto ads OFF** (AdSense → Ads → By site → nfl-2min-drill.com). Auto ads would place ads next to the
  play controls (policy risk, accidental clicks) and for Coach's Edition buyers, who paid for no ads.
- After it's live, **merge `main` back into `coachs-edition`** before the next merge the other way: both branches
  changed `server/site/worker.js`, `src/ui/AdSlot.tsx`, `src/game/site.ts`, `public/_headers`, `index.html` and the
  pages with the same intent (`coachs-edition` also has the owner check in AdSlot); resolve toward `coachs-edition`.

**Ads, where they are (both branches):** one display unit, `initial_ad_unit`, slot `4281334746`, publisher
`ca-pub-2581780385461126` (both public; `src/game/site.ts`). Placements: the game's end-of-game screen (Daily, Survivor,
Practice; `AdSlot where="end"` in `GameScreen.tsx`), Career's postgame, the page footer (never while a game is on
screen), the How to play guide (three, between sections), the leaderboard and stats pages. The game loads Google's
script itself (`src/ui/AdSlot.tsx`, 1.5 s after the page draws, only where an ad renders); the static and Worker pages
use `public/ads.js` (their CSP allows no inline script). On `coachs-edition`, owners of the edition see none and their
browser never loads the script. Next revenue step (owner): apply for AdSense's H5 Games Ads for rewarded ads ("watch
an ad to continue your Survivor run").

**What's left before the $4.99 sells:** section 5 below. In short: the owner gets an EIN, activates Stripe live, sets
it up (product $4.99, descriptor THE 4TH CALL, Radar 3DS rule, receipts), creates a Turnstile widget; Claude then does
the production config (item 9, needs the owner's explicit OK in the chat), the live webhook, the merge, and one real
purchase + refund together. `NR_FROM` (engine rule date, `src/engine/scenario.ts`) must be later than that merge day.

**Working on another machine:** `git fetch && git checkout coachs-edition && git pull`, `npm install`. Secrets are
not in git: `.dev.vars` (local, see section 6) and Cloudflare Worker secrets (already set on staging). The staging
site is https://nfl-2min-drill-staging.houston-parker.workers.dev (add `?edition=owned` to preview what an owner sees).
Run tests from the repo root: `npx vitest run --root <absolute repo path>`.

For any Claude Code session picking this branch up. Written 2026-10-20 after the first successful sandbox purchase.
Read this, then [LAUNCH_TODO.md](LAUNCH_TODO.md) for the ordered checklist and
[server/accounts/SETUP.md](server/accounts/SETUP.md) for every setting and the 14-step Stripe test.
Security controls mapped to the OWASP Top 10 (web and API), the threat model and the pre-launch checklist:
[server/accounts/SECURITY.md](server/accounts/SECURITY.md). Hardened 2026-10-20 (`434e0df`, `8d5b3a6`): body caps,
cookie shape check, extra headers, Stripe id and path allowlists, an audit log, Cloudflare Turnstile on the open
forms, and a **Help & refunds form** (`/v1/support`, migration 0003, stored then emailed to `SUPPORT_TO`). All deployed
and verified on staging (a form submission reached the owner's inbox). Staging uses Turnstile's **test** keys.

## 1. Rules (don't skip)

- **Pull first:** `git checkout coachs-edition && git pull origin coachs-edition`. Small commits, push when a piece is done.
- **Never merge into `main` and never push to `main` from this branch.** Pushing `main` deploys the live site.
- **Never rewrite pushed history** (no rebase, squash, amend, force-push). Fix forward.
- **Never commit** `.dev.vars`, `.wrangler/`, `docs/legal/`, or any key. They're git-ignored; the repo is public.
  If a key is ever pasted into a chat, treat it as leaked: rotate it in the provider's dashboard.
- **Run the checks after changes:** `npm run typecheck`, `npm run build`, and the suite from the repo root:
  `npx vitest run --root <absolute repo path>`. Running Vitest from a parent folder picks up a different config and
  reports false failures (5-second timeouts, a `scripts/percentiles` error). 343 tests pass as of this handoff.
- Don't change `LIVE_PAYMENTS_ALLOWED` (`server/accounts/config.ts`) or add a D1 binding at the top level of
  `wrangler.jsonc`. Both are the owner's reviewed call; either one turns real behavior on in production.

## 2. What exists and what's verified

**Code (all on this branch, pushed):**
- Passwordless email accounts (`server/accounts/`): single-use link + 6-digit code, hashed sessions in a `__Host-`
  cookie, rate limits, no account enumeration, account deletion. D1 migrations `0001_accounts`, `0002_purchases`.
- Stripe Checkout, test mode only: the server creates the session at its fixed price, verifies webhook signatures,
  records each event once (idempotent), re-reads the session from Stripe's API, handles refunds and disputes.
  Live keys are refused in code.
- Sign-in email through Resend's HTTP API (`mailer.ts`): `MAIL_MODE=resend` + `RESEND_API_KEY` secret + `MAIL_FROM`.
  Locally `MAIL_MODE=console` prints the link and code to the Worker log instead.
- Coach's Edition features behind the gate (Career Legacy, three career slots, the ladder), hidden in production builds.
- A `staging` Wrangler environment bound to the real D1 database `the-fourth-call-database`
  (`42a1a193-5c81-495a-bf0b-730eae04098f`), accounts on, `PAYMENTS` off, **`SITE_ORIGIN` empty on purpose** until the
  staging Worker's real address is known (it must be exact; sign-in links are built from it).
- Production (top level of `wrangler.jsonc`): **no D1 binding**, so every account and payment route answers 404.
  The live site is `main`, untouched by any of this.

**Verified 2026-10-20 in the local sandbox (wrangler dev + Vite, Stripe sandbox account, Stripe CLI):**
- Sign in by code from the Worker log: works.
- Checkout → Stripe-hosted page → `4242 4242 4242 4242` → `checkout.session.completed` → purchase `paid`, entitlement
  `active`, webhook outcome `granted` (SETUP.md §5 checks 1–3).
- Unsigned webhook → 400, nothing recorded (check 5). Same event delivered twice → still one purchase, one
  entitlement, one webhook record (check 6).
- **Then all the rest (checks 4, 7–14) on the same day, driven through the API and Stripe's test API/CLI: every one
  passes.** Results and the two notes (early events get a deliberate 503; webhook is 404 while payments are off) are
  in LAUNCH_TODO.md. Stage 1 is complete; next is stage 2 (staging).

**Set up on the owner's work PC (not in git):** `.dev.vars` with `AUTH_PEPPER`, a Stripe sandbox restricted/secret
test key, the webhook secret from `stripe listen`, the `price_…` id for "Coach's Edition" (one-time, 4.99 USD),
`RESEND_API_KEY`, `PAYMENTS=on`. The Stripe CLI is installed (winget) and logged in to the sandbox. The local D1
(`.wrangler/`) has the migrations applied and one test purchase. The owner's personal PC has none of this yet.

## 2a. Staging status (2026-10-20, later the same day)

- **Live at https://nfl-2min-drill-staging.houston-parker.workers.dev** (Worker `nfl-2min-drill-staging`, separate from
  the production Worker `nfl-2min-drill`). `/v1/me` answers `{"signedIn":false,"payments":"test"}`.
- D1 `the-fourth-call-database`: migrations 0001 and 0002 applied remotely; all tables present.
- `SITE_ORIGIN` set to the address above (commit `21defd1`); `PAYMENTS` on for staging only (`3549d9e`).
- Worker secrets set on staging: `AUTH_PEPPER` (its own random value), `RESEND_API_KEY`, `STRIPE_SECRET_KEY`
  (sandbox test key), `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` (from the endpoint below).
- Stripe sandbox webhook endpoint `we_1USgg2PcRHl4G0ky2cQvfxOl` → `<staging>/v1/stripe/webhook`, the 8 events.
- Resend: domain `nfl-2min-drill.com` **verified** (id `73c4740d-…`, us-east-1). DNS in Cloudflare: TXT
  `resend._domainkey`, MX + TXT `send`, CNAME `rsend` (must be **DNS only**, not proxied, or Resend can't see it),
  TXT `_dmarc` `v=DMARC1; p=none;`. A staging sign-in email from `signin@nfl-2min-drill.com` was delivered to Gmail.
- **Verified on staging 2026-10-20:** real sign-in email (Resend) → sign in → test checkout → "Payment confirmed";
  D1 shows purchase `paid`, entitlement `active`, webhook `granted`, delivered by Stripe on the first try. Unsigned
  webhook → 400; the same event re-delivered by Stripe → still one of each. The staging build shows the Account panel
  and edition preview because `isStaging()` (`src/game/edition.ts`) matches its workers.dev host; production doesn't.
- **Not run on staging:** refunds, disputes, kill switch, delete, forged return (all passed locally on identical code).
  Extra test accounts on staging need real inboxes (sign-in codes arrive by email); don't use made-up addresses there,
  bounces hurt the new domain's sending reputation.
- New-domain mail lands in Gmail's spam at first; mark "Not spam". Tighten `_dmarc` from `p=none` before launch.
- Stripe Link shows "Pay later" and saved methods even with a card-only session; that's a Stripe dashboard setting.

## 3. Running the sandbox

```bash
# terminal 1: the Worker with accounts on (reads .dev.vars; local D1 on disk)
npm run build && npx wrangler d1 migrations apply DB --local --env dev && npx wrangler dev --env dev --port 8787
# terminal 2: the game, proxying /v1 to the Worker
DEV_API=http://localhost:8787 npm run dev           # PowerShell: $env:DEV_API='http://localhost:8787'; npm run dev
# terminal 3: Stripe events forwarded to the Worker (must stay open while testing purchases)
stripe listen --forward-to localhost:8787/v1/stripe/webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,charge.refunded,charge.dispute.created,charge.dispute.updated,charge.dispute.closed,charge.dispute.funds_withdrawn,charge.dispute.funds_reinstated
```
Open `http://localhost:5173/?edition=account#account`. The Account panel is also under the header's Settings icon.
`curl localhost:8787/v1/me` should answer `{"signedIn":false,"payments":"test"}`.

Looking at records: `npx wrangler d1 execute DB --local --env dev --command "SELECT status FROM purchases"` (also
`entitlements`, `webhook_events`). Re-deliver an event: `stripe events resend <evt_id>`.

## 4. Things that bit us (so they don't bite you)

- **"Confirming…" that never finishes** = `stripe listen` isn't running. The purchase is fine in Stripe; the webhook
  never reached the Worker. Start the listener and `stripe events resend` the `checkout.session.completed` event.
- **`/v1/me` says `payments: off` although `.dev.vars` is right** = a stale `workerd` from an earlier `wrangler dev`
  still holds port 8787 and answers with old settings. Check `netstat -ano | findstr :8787`; if two listeners, kill
  every `node` process running wrangler and every `workerd`, then start one Worker.
- Stopping a background `wrangler dev` from a tool doesn't always kill its `workerd` children. Same fix.
- `.dev.vars` values override `vars` in `wrangler.jsonc` for `wrangler dev` (that's how `PAYMENTS=on` works locally).
- Don't edit `.dev.vars` with PowerShell's `Set-Content -Encoding utf8`: Windows PowerShell 5.1 adds a byte-order mark,
  which corrupts the first variable's name. Edit it in the editor or write UTF-8 without BOM.
- A test buyer who ticked "Save my information with Link" gets Stripe's Link login instead of the card form next time;
  use a new email (any `@example.com` address works locally) for repeat test purchases.
- The Stripe-hosted checkout shows Bank/Klarna next to Card even though the session is `payment_method_types: ['card']`;
  that's Stripe Link's wallet. Turn it off in Stripe → Settings → Payment methods if unwanted. Not a code issue.
- The branch's commit `c76f508` reverted the homepage `<title>` to the pre-SEO one. The owner knows; decide before
  this branch ever merges (it resets the SEO measurement window described in `marketing/GOOGLE_SEO_MEASUREMENT.md`).

## 5. What's left before the $4.99 goes live (updated 2026-10-21)

Stages 1 (local sandbox) and 2 (staging) are done: on staging, sign-in email from `login@nfl-2min-drill.com`, a test
purchase, auto-unlock, and a refund that revoked it automatically all work. What remains, in order:

**The owner's (blocked on an EIN: do the Stripe part at home)**
1. [ ] **Get the EIN**, then **activate Stripe live** (business details, bank account, identity). In the live dashboard:
   - [ ] Product "The 4th Call: Coach's Edition", **one-time, $4.99 USD**. Send Claude its **price ID** (`price_…`, not a secret).
   - [ ] Statement descriptor **`THE 4TH CALL`** (Settings → Business → Public details), so buyers recognize the charge.
   - [ ] Radar rule **"Request 3D Secure if 3DS is recommended by Radar"** on.
   - [ ] Customer receipts on for successful payments and refunds (Settings → Emails).
   - [ ] Optional: switch off "buy now, pay later" methods (Settings → Payment methods). The code already allows cards only.
   - The live **secret key** and **webhook secret** never go in a chat: paste them at `npx wrangler secret put …` prompts.
2. [ ] **Turnstile widget** for `nfl-2min-drill.com` (Cloudflare dashboard → Turnstile → Add widget, mode Managed). Send
   Claude the **site key** (public); keep the secret for `npx wrangler secret put TURNSTILE_SECRET`.
3. [ ] **Delete the old Resend key** `re_BHVK…` (Resend → API Keys). The newer key is the one staging uses.
4. [ ] **Finish the staging walkthrough** (LAUNCH_TODO.md stage 2b): send a Help & refunds request while signed in
   (it should reach your inbox with "refunds before: 1"), then try Account → Delete my account.
5. [ ] Optional, not blocking: a short IP-lawyer consult once sales pass a few hundred dollars (the real NFL team and
   player names; Career is already a fictional league).

**Claude's (can start on 6–9 before the EIN; 10–11 need the live keys)**
6. [x] **Done 2026-10-21:** `NR_FROM = '2026-11-15'` (`src/engine/scenario.ts`). **If the merge to `main` happens on or
   after that date, move it past the merge day first** (tested in `rules.test.ts`). Was: give the bug-sweep engine rules their own start date after the merge day. They ride on the overtime flag
   (`otOn`, `OT_FROM = 2026-10-21`), and production `main` doesn't have them, so merging as is would change
   dailies people already played on the live site (saved games would replay differently). Keep the legacy digest.
7. [x] **Done 2026-10-21:** on the live site the edition shows only once `/v1/me` answers `payments: "live"` (remembered
   in `the4thcall:account:payments`), so merging changes nothing visible until live payments are on; checked with a
   production build (server off: nothing new shows; live: the star, Help & refunds, "Buy … $4.99" without test-mode
   wording). Locked features get a "Get the Coach's Edition" button. The live Turnstile site key goes in
   `LIVE_SITE_KEY` (`src/ui/Turnstile.tsx`, public, used on `nfl-2min-drill.com` only): **set it before
   `TURNSTILE_SECRET` goes on production, or sign-in there will fail the bot check.** Was:
   **Production purchase screens:** the edition gate (`src/game/edition.ts`) is staging-only by design; switch it to
   account-based ownership in production. The Buy button only shows when `payments === 'test'` (`Account.tsx`), and
   the panel says "Preview… test mode": show the live button and drop the preview wording when payments are live.
   The ad slot already hides for owners once the gate reads ownership.
8. [~] **Production database:** created 2026-10-21: `the-fourth-call-prod`, id `5fbc0458-441f-45df-9045-a61e6ecc5e1c`,
   region WNAM, empty. Migrations 0001–0004 still to apply (`npx wrangler d1 migrations apply DB --remote`), which
   needs the top-level binding from item 9 first.
9. [ ] **Needs the owner's explicit OK in the session** (Claude Code's permission check blocked it on 2026-10-21 as a
   production change). **To unblock:** the owner says in the chat "approved: make the production config change and flip
   live payments" (or allows it at Claude Code's permission prompt, or makes the two edits by hand: the top-level
   `d1_databases` + `vars` block in `wrangler.jsonc` described below, and `LIVE_PAYMENTS_ALLOWED = true` in
   `server/accounts/config.ts`, with its test in `purchases.test.ts` updated). Nothing goes live from this commit alone:
   it only matters once merged to `main` and the production secrets exist. **Production config** (one reviewed commit): top-level D1 binding, `ACCOUNTS`, `SITE_ORIGIN=https://nfl-2min-drill.com`,
   `MAIL_MODE=resend`, `MAIL_FROM=The 4th Call <login@nfl-2min-drill.com>`, `PAYMENTS`, the real Turnstile site key in the
   build, and `LIVE_PAYMENTS_ALLOWED` flipped. Production secrets via `npx wrangler secret put` (no `--env`):
   `AUTH_PEPPER` (new random value), `RESEND_API_KEY`, `STRIPE_SECRET_KEY` (live), `STRIPE_PRICE_ID`,
   `STRIPE_WEBHOOK_SECRET`, `TURNSTILE_SECRET`, `SUPPORT_TO`.
10. [ ] **Live webhook endpoint** `https://nfl-2min-drill.com/v1/stripe/webhook`, the same events as staging plus
    `radar.early_fraud_warning.created`. Then the pre-launch list in server/accounts/SECURITY.md.
11. [ ] **Merge `coachs-edition` into `main`** (that deploys everything on the branch at once: purchases, the career
    work, the tour), with the owner's go-ahead. Decide the homepage `<title>` first (section 4, last bullet).
12. [ ] **Final check, together:** one real $4.99 purchase, confirm the edition unlocks, refund it in the Stripe
    dashboard, confirm it's removed. Then update this file and LAUNCH_TODO.md with what's live.

## 6. Where secrets go

| Where | What |
|---|---|
| `.dev.vars` (git-ignored, per machine) | local: `AUTH_PEPPER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `RESEND_API_KEY`, `PAYMENTS` |
| `npx wrangler secret put NAME --env staging` (or no `--env` for production) | the same names on Cloudflare |
| `wrangler.jsonc` | only non-secrets: bindings, database ids, `ACCOUNTS`, `SITE_ORIGIN`, `MAIL_MODE`, `MAIL_FROM`, `PAYMENTS` |
| Never | GitHub secrets (Cloudflare's Git integration deploys, not Actions), `VITE_*` (public JavaScript), chats |

## Deep bug sweep (2026-10-20)
Four review passes (server, UI, engine, career/renderers) plus two fuzz harnesses (`scripts/fuzz.gen.test.ts`, `server/accounts/fuzz.test.ts`). Fixed on this branch:
- Server: webhook status transitions are guarded (`WHERE status = ?`, the event row only lands if the purchase ended in that state, else 503 so Stripe resends); events about charges we never recorded stop retrying after an hour (`NotOurs`); dispute inquiries (`warning_*`) change nothing; wrong code guesses no longer kill a sign-in link; sign-in/support bodies get a 400 instead of a crash on bad JSON.
- UI: game end waits (≤3 s) for grades in flight and late grades never write back; keyboard shortcuts ignore dialogs/inputs; Survivor double-submit guard; grader job timeout (90 s) and worker errors surfaced; Daily rolls over at midnight while open; Turnstile widget resets after an error; leaderboard/account responses are shape-checked; an app-level error boundary (`main.tsx`).
- Career: set-aside-save notice hook order; offseason always leaves an offer (no soft-lock); trade news year; jersey-number check excludes you; kick-cam/field handoff races; a top seed's bye is not elimination; Draft timers cleared on unmount; boundary deletes the slot on screen.
- Engine (date-gated by `State.nr`, on from the OT_FROM daily and in Survivor/Practice/full games; older dailies replay unchanged, legacy digest `d98bb4e7` still holds): scramble into own end zone is a safety; untimed down after a defensive foul at 0:00; no try after a walk-off touchdown; blocked punt fallen on in the end zone / return past the goal line scores; kneel-out counts the two-minute warning; OT second possession that scores but stays behind ends without a kickoff; hold penalty inside the 20 rounds down (never yl 0); grading seconds across a period change. Tests: `src/engine/rules.test.ts`.
- Decision for the owner: out-of-bounds stops the clock only inside 2:00 (NFL: 5:00 of the 4th). Documented choice; not changed.
- Deferred (low): Daily/Survivor side effects inside `setStore` updaters; dev-only `Secure` cookie on Safari; LiveGame render perf.

## Career and first-game polish (2026-10-21, on this branch, staging only)
- **Change your mind mid-game** (`src/ui/career/LiveGame.tsx`): an "Every snap / The moments" switch at the top of a live
  career game; inside a drive you took over, "Sim this drive", "Just the moments" (from every snap) and "Sim to the end"
  (the play in motion finishes first: `GameScreen` `segment.leave`); the moment prompt has "Sim to the end" too. XP only
  depends on sim vs played, so switching costs nothing.
- **Live tracker** (`src/ui/career/Tracker.tsx`): a drive chart (every snap of the drive on its own row: passes arc,
  runs straight, incompletions ×, losses and turnovers red, the ball gliding to its spot), the last play called big, a
  flash on scores and picks, your QB's live line, the drives with a bar of where each went. Taller on phones.
- **Hub**: Home rebuilt around a game-day panel (matchup, OVR/OFF/DEF compared, storylines, the play buttons), then
  goals / your season / division; the awards race shows once it has data; the header is the team's color band. Team
  chips everywhere in career go through `tv()` (readable text on any team color). Postgame score in the same band.
  Fixed: "2:60" in the scoring list (`mmss`, `fmtSecs`).
- **First-game tour** (`src/ui/Tour.tsx`): up to six spotlight notes at a brand-new player's first Daily call (steps
  whose part isn't on screen skip themselves), "Skip tour", Escape, remembered in `store.seenTour`.
- Phone header: the Coach's Edition button is a star there, and the mode tabs' column shrinks instead of overlapping.
- 2026-10-22 follow-ups: Leaders tab fixed (its `.ld-n` class collided with the ladder's: renamed `.ld-name`); the
  Player tab is a player card (jersey, overall, level/XP, skill points), attributes with their effect, abilities as
  cards with an unlock button; the Team page and draft night's team-on-the-clock card use the dark team band (the old
  fade left white text on white). The NFL's 5:00 out-of-bounds rule (with `nr`, from NR_FROM for dailies). `App.update`
  applies each change once. Local Safari sign-in (plain dev cookie on localhost only). Clutch ratings built once per
  game. Career stays a fictional league for launch (owner's call, option 3); real teams can come later.
- 2026-10-22 **Ready for the live site, waiting on the owner's push** (Claude Code's permission check blocks pushes to
  `main`): branch `live-ads` = `main` + the leaderboard integrity fix (`bb78514`) + ads on (`71c83bb`: CSP allows
  AdSense, the script loads only where an ad shows, footer + end-of-game placements, unit `4281334746`, `ads.txt`).
  To ship: `git push origin live-ads:main`, or merge https://github.com/Hparker6/nfl-2min-drill/pull/new/live-ads.
  The same changes are on this branch (the ad slot also skips Coach's Edition owners here). Keep AdSense Auto ads off.
- 2026-10-22 **The Coach's Playbook** (Coach's Edition): Hook and ladder, Statue of Liberty, Halfback pass, Fake punt
  (fourth down, with the field goal and punt), Surprise onside (1 in 5 recovered; a plain onside is 1 in 8) and Squib
  kick (1 in 5 recovered, otherwise a short field). `Call.premium`; offered when `State.pb` (GameScreen sets it for an
  owner); the AI never calls them, so every saved game and digest is unchanged. Honest odds, graded like every call;
  balance in `scripts/playbook.gen.test.ts` (a playbook play is the best call in about 7% of spots). A Daily made with
  one is starred on the leaderboard (`SpotResult.pb` → the score post's `pb` → the Durable Object's `pb` column).

