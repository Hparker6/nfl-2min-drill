# Handoff: `coachs-edition` (accounts and the Coach's Edition purchase)

For any Claude Code session picking this branch up. Written 2026-10-20 after the first successful sandbox purchase.
Read this, then [LAUNCH_TODO.md](LAUNCH_TODO.md) for the ordered checklist and
[server/accounts/SETUP.md](server/accounts/SETUP.md) for every setting and the 14-step Stripe test.

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

## 5. Next, in order

1. Finish SETUP.md §5 checks 4, 7–14 locally and record them in LAUNCH_TODO.md (stage 1).
2. Stage 2 (staging on Cloudflare): verify `nfl-2min-drill.com` in Resend (DNS from Resend's dashboard), apply the
   migrations to the real D1 (`--env staging --remote`), deploy staging once to learn its URL, put that URL in
   `SITE_ORIGIN`, set the five secrets with `wrangler secret put … --env staging`, add a Stripe test webhook endpoint
   for `https://<staging>/v1/stripe/webhook`, set `PAYMENTS` on, redeploy, repeat the 14 checks there.
3. Stage 3 (live) is the owner's: legal review, tax/merchant of record, Stripe live activation, production D1 and
   secrets, the reviewed commit that adds production bindings and flips `LIVE_PAYMENTS_ALLOWED`, then the merge.

## 6. Where secrets go

| Where | What |
|---|---|
| `.dev.vars` (git-ignored, per machine) | local: `AUTH_PEPPER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `RESEND_API_KEY`, `PAYMENTS` |
| `npx wrangler secret put NAME --env staging` (or no `--env` for production) | the same names on Cloudflare |
| `wrangler.jsonc` | only non-secrets: bindings, database ids, `ACCOUNTS`, `SITE_ORIGIN`, `MAIL_MODE`, `MAIL_FROM`, `PAYMENTS` |
| Never | GitHub secrets (Cloudflare's Git integration deploys, not Actions), `VITE_*` (public JavaScript), chats |
