# Launch to-do: accounts and the Coach's Edition

The order of operations from here to charging real money, as a checklist. Details for each step are in
[server/accounts/SETUP.md](server/accounts/SETUP.md); the branch rules are in [HANDOFF.md](HANDOFF.md). Tick things
here as you go so the next session (or the next PC) knows where you are. Updated 2026-10-20.

Three stages. Each stage has to pass before the next starts, and nothing in stages 1–2 touches the live site.

## Stage 0: housekeeping (today)

- [ ] **Rotate the Resend key** that was pasted into a chat on 2026-10-20 (Resend → API Keys → delete `re_T5cw…`,
      create a new one). Treat the old one as public.
- [ ] On each machine you work from: `git checkout coachs-edition && git pull`, `npm install`, `npx wrangler login`.
- [ ] Copy `.dev.vars.example` to `.dev.vars` on that machine (git-ignored) and fill it in as the steps below call
      for it. Never paste a key into a chat, an issue, or a committed file.
- [ ] Decide the title question: the branch reverts the homepage title to "The 4th Call: Free 2-Minute Drill
      Football Strategy Game" (commit `c76f508`). Keep that only if it's deliberate; it changes the SEO measurement.

## Stage 1: sandbox on your own machine (no external accounts needed for sign-in)

Goal: sign in, buy the edition with a test card, and see every check in SETUP.md §5 pass, all on localhost.

- [x] `AUTH_PEPPER` in `.dev.vars`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
- [x] Terminal 1: `npm run build && npx wrangler d1 migrations apply DB --local --env dev && npx wrangler dev --env dev`
- [x] Terminal 2: `DEV_API=http://localhost:8787 npm run dev` (PowerShell: `$env:DEV_API='http://localhost:8787'; npm run dev`)
- [x] Open `http://localhost:5173/?edition=account`, request a sign-in; the link and code print in terminal 1
      (`MAIL_MODE` is `console` locally, so Resend isn't needed yet). Sign in, sign out, sign in with the code.
- [x] **Stripe, test mode:** create the product "Coach's Edition", one-time **4.99 USD**; note the `price_…` id.
      Create a restricted test key (`rk_test_…`: Checkout Sessions write, Charges and Disputes read).
- [x] Install the Stripe CLI, `stripe login`, then start the listener from SETUP.md §5 and copy the `whsec_…`.
- [x] `.dev.vars`: `PAYMENTS=on`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`; restart wrangler.
      `curl localhost:8787/v1/me` must say `"payments":"test"`.
- [x] Run the 14 checks in SETUP.md §5. **All 14 pass (2026-10-20, work PC, Stripe sandbox):**
      1–3 buy with 4242 → paid / active / granted · 4 forged return and someone else's session → not found, owns nothing ·
      5 unsigned webhook → 400 · 6 same event twice → one purchase · 7 buy again → 409 · 8 fresh sign-in → owned ·
      9 $1 refund → partially_refunded, still owned · 10 rest refunded → revoked · 11 dispute won → owned again ·
      12 dispute lost → not owned · 13 PAYMENTS=off → checkout 503, owners keep it · 14 delete → account and entitlement
      gone, purchase row kept unlinked, re-signup owns nothing.
      Notes: events that arrive before their purchase get a 503 on purpose (Stripe retries them on staging/production;
      the local CLI doesn't, so `stripe events resend <evt>` by hand). While PAYMENTS=off the webhook answers 404, so
      Stripe holds and retries events until it's back on.
- [ ] Optional here, required for staging: try Resend for real. Set `MAIL_MODE=resend`, `MAIL_FROM=onboarding@resend.dev`
      and `RESEND_API_KEY` in `.dev.vars`. Until the domain is verified, Resend only delivers to your own account email.

## Stage 2: staging on Cloudflare (real services, test money)

Goal: the same checks passing on a real Worker, a real D1 and real email, with Stripe still in test mode.

- [x] **Resend domain:** (verified 2026-10-20; the `rsend` CNAME has to be DNS only) add `nfl-2min-drill.com` in Resend → Domains and create the DNS records it shows (MX and TXT on
      `send`, TXT `resend._domainkey`, a `_dmarc` TXT) in Cloudflare DNS, unproxied, exactly as Resend prints them
      (SETUP.md §2). Wait for "Verified". Don't touch the site's existing records.
      *If the attorney review changes the domain, this is redone on the new one.*
- [x] **Database:** `npx wrangler d1 list` shows `the-fourth-call-database` (`42a1a193-…`). Then
      `npx wrangler d1 migrations apply DB --env staging --remote`, and verify:
      `npx wrangler d1 execute DB --env staging --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`
- [x] **First deploy, to learn the address:** `npm run build && npx wrangler deploy --env staging`. Accounts stay
      off on this deploy because `SITE_ORIGIN` is empty on purpose. Copy the exact URL Wrangler prints
      (`https://nfl-2min-drill-staging.<your-subdomain>.workers.dev`).
- [x] Put that URL in `wrangler.jsonc` → `env.staging.vars.SITE_ORIGIN`. Commit and push the branch.
- [x] **Secrets on the staging Worker** (prompts for each; nothing in files):
      `npx wrangler secret put AUTH_PEPPER --env staging` (a new random value, not the local one),
      `… RESEND_API_KEY …`, `… STRIPE_SECRET_KEY …` (test key), `… STRIPE_PRICE_ID …`.
- [x] **Stripe webhook endpoint for staging:** Dashboard (test mode) → Developers → Webhooks → add
      `https://<staging-url>/v1/stripe/webhook` with the same event list as the CLI command in SETUP.md §5; copy its
      signing secret → `npx wrangler secret put STRIPE_WEBHOOK_SECRET --env staging`.
- [x] Set `PAYMENTS` to `"on"` in the staging vars (it's a var, not a secret), redeploy:
      `npm run build && npx wrangler deploy --env staging`.
- [x] On the staging URL (done 2026-10-20: email sign-in, purchase, unsigned and duplicate webhooks pass): `/v1/me` shows accounts on and `"payments":"test"`; sign in with a real email through Resend;
      run the 14 checks again against staging. Record results in SETUP.md or here.
- [ ] Check the staging Worker's logs (`npx wrangler tail --env staging`) during the run: no addresses, links, codes
      or keys should ever appear, only HTTP statuses.

## Stage 3: live (real money; only after the reviews)

Each item here is an owner decision or an external approval, not a code task, except the last two.

- [ ] **Legal review** (already in TODO.md): the domain and the real NFL names once money changes hands; whether the
      LLC is the seller; terms of sale; refund and dispute policy; the privacy policy covering accounts and Stripe.
- [ ] **Tax / merchant of record:** standard Stripe (you handle tax) or Stripe's managed option. Decide before the
      first live sale.
- [ ] **Stripe live mode:** activate the account (business details, bank), recreate the product and price in live
      mode, create a live restricted key and a live webhook endpoint for the production URL.
- [ ] **Resend:** a sending address on the final domain (a dedicated one such as `signin@` is fine), domain verified,
      a production API key separate from staging's.
- [ ] **Production config** (code change on the branch, reviewed): add the D1 binding, `ACCOUNTS`, `SITE_ORIGIN`
      (`https://nfl-2min-drill.com`), `MAIL_MODE`, `MAIL_FROM` and `PAYMENTS` at the top level of `wrangler.jsonc`;
      create the production D1 database (a separate one, not staging's) and apply the migrations to it;
      set the production secrets with `npx wrangler secret put NAME` (no `--env`).
- [ ] **Switch production from the preview gate to account-based ownership** (`src/game/edition.ts`), and flip
      `LIVE_PAYMENTS_ALLOWED` to `true` in `server/accounts/config.ts`: one reviewed commit, by you.
- [ ] **Security pre-launch list** in server/accounts/SECURITY.md: real Turnstile keys, Stripe Radar 3DS rule,
      Stripe receipts on, DMARC to quarantine, separate production secrets incl. `SUPPORT_TO`, log monitoring.
- [ ] **AdSense vs. buyers:** if the edition promises no ads, the ad slot must respect the entitlement before ads go on.
- [ ] Merge `coachs-edition` into `main` (that deploys). Then on production: buy once yourself with a real card for
      the smallest sanity check, refund it, and watch the logs for an hour.
- [ ] Update HANDOFF.md and this file: what's live, what's left.

## Where the pieces live

| Thing | Where |
|---|---|
| Local secrets | `.dev.vars` (git-ignored) |
| Staging / production secrets | Cloudflare Worker secrets via `wrangler secret put` |
| Non-secret settings per environment | `wrangler.jsonc` → `env.staging.vars` / top-level `vars` |
| Database ids | `wrangler.jsonc` → `d1_databases` (not secret) |
| Migrations | `server/db/migrations/` |
| Every setting and failure mode | `server/accounts/SETUP.md` |
