# Accounts, sign-in email and test purchases: setup

Everything here is **off in production**: the production Worker has no database binding, so `/v1/auth/*`, `/v1/me`,
`/v1/checkout*` and `/v1/stripe/webhook` answer 404. Live Stripe keys are refused in code
(`LIVE_PAYMENTS_ALLOWED = false` in `config.ts`). This file covers local development, staging and the manual Stripe
test run. Nothing below creates anything by itself; every account, key and DNS record is created by you.

Never commit secrets. Locally they live in `.dev.vars` (git-ignored); in Cloudflare they are Worker secrets
(`wrangler secret put NAME --env <env>`). Never put them in a `VITE_` variable: those are built into the public
JavaScript.

## 1. Settings

| Name | Kind | Needed for | Format (never paste real values into the repo) |
|---|---|---|---|
| `DB` | D1 binding (wrangler.jsonc) | accounts | the environment's D1 database |
| `ACCOUNTS` | var | accounts | `on` |
| `SITE_ORIGIN` | var | accounts | the site's own origin: `https://…`, or `http://localhost:5173` locally |
| `DEV_ORIGINS` | var | local only | extra localhost origins, comma-separated (others are ignored) |
| `AUTH_PEPPER` | **secret** | accounts | 32+ random characters (see `.dev.vars.example` for a command that makes one) |
| `MAIL_MODE` | var | sign-in email | `console` (localhost only) or `resend` |
| `MAIL_FROM` | var | `resend` | `The 4th Call <sign-in@mail.your-domain>` on a domain verified in Resend |
| `RESEND_API_KEY` | **secret** | `resend` | `re_…`, a key with sending access only, limited to that domain |
| `PAYMENTS` | var | checkout | `on` (anything else: off) |
| `STRIPE_SECRET_KEY` | **secret** | checkout | `sk_test_…` or (better) a restricted `rk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | **secret** | checkout | `whsec_…` for this environment's webhook endpoint |
| `STRIPE_PRICE_ID` | **secret or var** | checkout | `price_…`: one-time, 4.99 USD, test mode |

How each fails: accounts without `DB`, `ACCOUNTS=on`, a valid `SITE_ORIGIN` or a long enough `AUTH_PEPPER` → every
route 404. Email that isn't fully configured (or `console` anywhere but localhost) → asking for a sign-in answers
503, writes nothing and sends nothing, and the Worker logs why (`sign-in email is off: …`). Payments not fully
configured, or a live key → checkout 503 and no webhook route.

## 2. Sign-in email: the provider

Chosen: **Resend**, over its HTTP API with `fetch` (no SDK; `mailer.ts`).

| | Resend (chosen) | Cloudflare Email Service | Postmark | Amazon SES |
|---|---|---|---|---|
| Works from a Worker | yes, plain HTTPS API | yes, native binding | yes, HTTPS API | yes, but requests need AWS SigV4 signing (more code) |
| Cost at launch volume | free tier (third-party sources: 3,000 a month, 100 a day) | needs the **Workers Paid** plan; 3,000 a month included, then $0.35 per 1,000 | free developer tier around 100 a month, then from about $15 a month | about $0.10 per 1,000 (pricing changing for new accounts) |
| Status | established | **public beta** (April 2026) | established | established |
| Domain verification | SPF, DKIM, MX for bounces (DNS) | domain on Cloudflare | SPF, DKIM, Return-Path | SPF, DKIM, MAIL FROM |
| Setup effort | low | low if on Workers Paid | low (account approval) | highest |

Check prices and limits on each provider's own site before signing up; the figures above come partly from third-party
pages. Cloudflare Email Service is a good later switch (no outside provider at all) once it leaves beta, if you're on
Workers Paid: it only needs another mailer next to `resendMailer`.

What the provider receives: the recipient's address and the message (the sign-in link and the 6-digit code). What
the Worker logs when sending fails: the provider's HTTP status only. The code is in the body, not the subject, so it
doesn't show on lock screens. A message that couldn't be sent is retired at once: its link and code never work.

### Resend setup (you do this)

1. Create a Resend account.
2. Add the sending domain. Staging's `MAIL_FROM` is `The 4th Call <signin@nfl-2min-drill.com>`, so the domain to add is
   `nfl-2min-drill.com`. (A subdomain such as `mail.nfl-2min-drill.com` would keep sign-in mail apart from any other mail
   from the domain; then `MAIL_FROM` and the record names below change to match.) **If the attorney's advice changes the
   site's domain, the sending domain changes with it.**
3. Resend shows the DNS records to add. **Copy the exact names and values from Resend's dashboard**; their usual shape
   for the root domain is:

   | Type | Name | Value | Notes |
   |---|---|---|---|
   | MX | `send` | `feedback-smtp.<region>.amazonses.com`, priority 10 | bounces and complaints |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF for the `send` subdomain only: it doesn't change the root's SPF |
   | TXT | `resend._domainkey` | the DKIM public key Resend gives you | DKIM |
   | TXT | `_dmarc` (if there isn't one) | e.g. `v=DMARC1; p=none;` (add `rua=mailto:<you>` for reports) | DMARC, recommended |

   In Cloudflare DNS these are plain DNS records (MX and TXT can't be proxied). Don't remove or change any existing
   records for the site itself.
4. Wait for Resend to show the domain as verified.
5. Create an API key with **sending access only**, limited to that domain. Copy it once, straight into the secret
   (step 3 of staging below). Don't paste it anywhere else.
6. `MAIL_FROM` is already set for staging in `wrangler.jsonc`; change it if you verify a different domain.

## 3. Local development (no email provider needed)

```bash
cp .dev.vars.example .dev.vars          # then fill in AUTH_PEPPER (and Stripe test values for section 5)
npm run build
npx wrangler d1 migrations apply DB --local --env dev
npx wrangler dev --env dev              # the Worker on :8787; sign-in links and codes print here
# another terminal:
DEV_API=http://localhost:8787 npm run dev
# open http://localhost:5173/?edition=account
```

`MAIL_MODE=console` is set for `dev` in wrangler.jsonc and works only because `SITE_ORIGIN` is localhost. To try real
delivery locally instead, set `MAIL_MODE=resend`, `MAIL_FROM` and `RESEND_API_KEY` in `.dev.vars`.

## 4. Staging

The `staging` environment in `wrangler.jsonc` is a separate Worker (`nfl-2min-drill-staging`, on workers.dev) bound to
the D1 database `the-fourth-call-database` (already created, staging only; its id is in `wrangler.jsonc`. An id alone
gives no access, but it is now in a public repo). `SITE_ORIGIN` is empty on purpose, so accounts stay off until it's
set to the right address.

1. **The database:** done (`the-fourth-call-database`).
2. **Create the tables:** `npx wrangler d1 migrations apply DB --remote --env staging`.
3. **Secrets:**
   `npx wrangler secret put AUTH_PEPPER --env staging` (new random value; never reuse the local one)
   `npx wrangler secret put RESEND_API_KEY --env staging`
4. **`SITE_ORIGIN`** in `wrangler.jsonc` → `env.staging.vars`: the staging Worker's exact URL, which includes your
   account's workers.dev subdomain: `https://nfl-2min-drill-staging.<your-subdomain>.workers.dev` (the first deploy
   prints it; the dashboard shows your subdomain under Workers & Pages). **Not** `https://nfl-2min-drill-staging.workers.dev`:
   that host doesn't exist, and a name like it could be registered by someone else, who would then receive the sign-in
   links. Copy the address from Cloudflare, don't type it.
5. **Deploy staging only:** `npm run build && npx wrangler deploy --env staging`. This does not touch production.
6. **Check:** `https://<staging>/v1/me` answers `{"signedIn":false,"payments":"off"}`; sign in with your own address.
7. **Recommended:** put staging behind Cloudflare Access (Zero Trust) so only you can open it, with a bypass rule for
   `/v1/stripe/webhook` (Stripe can't sign in). A workers.dev address is public otherwise.

Production builds: Wrangler now warns that several environments are defined and none was named. Production still
deploys the top level, as the dry run shows. To make that explicit, set the Cloudflare build's deploy command to
`npx wrangler deploy --env=""` (dashboard → the Worker → Settings → Build).

## 5. Stripe test mode: manual checklist

Do this locally (section 3) or on staging. **Test mode only.** Live keys are refused in code, so don't use one.

### Before you start (you do this)

- [ ] In a Stripe account, **test mode**: create a product "Coach's Edition" with a **one-time** price of **4.99 USD**.
      Note its `price_…` id.
- [ ] Create a **restricted test key** (`rk_test_…`) with write access to Checkout Sessions and read access to Charges
      and Disputes. Or use the test secret key (`sk_test_…`).
- [ ] Install the Stripe CLI and run `stripe login`.
- [ ] Start forwarding events and copy the `whsec_…` it prints:
      `stripe listen --forward-to localhost:8787/v1/stripe/webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,charge.refunded,charge.dispute.created,charge.dispute.updated,charge.dispute.closed,charge.dispute.funds_withdrawn,charge.dispute.funds_reinstated`
- [ ] In `.dev.vars`: `PAYMENTS=on`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`. Restart
      `wrangler dev --env dev`.
- [ ] `curl localhost:8787/v1/me` shows `"payments":"test"`.

To look at the records at any point:
`npx wrangler d1 execute DB --local --env dev --command "SELECT status, user_id IS NOT NULL AS linked FROM purchases"`
(and the same with `entitlements`, `webhook_events`).

### The checks

| # | Do this | Expect | ✓ |
|---|---|---|---|
| 1 | Sign in (Account, code from the wrangler log). Click **Buy … (test mode)** | Redirect to `checkout.stripe.com`, showing 4.99 USD and card only | |
| 2 | Pay with `4242 4242 4242 4242`, any future date, any CVC | Back at `/#purchase=cs_test_…`; "Confirming…", then "Payment confirmed"; `stripe listen` shows `checkout.session.completed` → 200 | |
| 3 | Check the records | `purchases`: one row, `paid`; `entitlements`: `active`; `webhook_events`: outcome `granted` | |
| 4 | **Forged return:** open `/#purchase=cs_test_madeup12345` while signed in as a different, non-paying account | Never confirms; that account still doesn't own it | |
| 5 | **Unsigned webhook:** `curl -X POST localhost:8787/v1/stripe/webhook -H "content-type: application/json" -d "{}"` | 400 `bad signature`; nothing recorded | |
| 6 | **Duplicate:** `stripe events resend <evt id from step 2>` | 200 `{"received":true,"duplicate":true}`; still one purchase and one entitlement | |
| 7 | **Already owned:** try Buy again (or `POST /v1/checkout` with your session cookie) | 409 "You already own…" (the button is hidden) | |
| 8 | **Restore:** a private window or another browser; sign in with the same email | Account shows the edition owned | |
| 9 | **Partial refund:** Dashboard → the payment → refund $1.00 | `partially_refunded`; still owned | |
| 10 | **Full refund:** refund the rest | `refunded`; not owned; entitlement `revoked`, reason `refunded` | |
| 11 | **Dispute, won:** a new account buys with `4000 0000 0000 0259` (it is disputed automatically) | `disputed`, not owned. Then in the Dashboard submit evidence with the text `winning_evidence` → `dispute_won`, owned again | |
| 12 | **Dispute, lost:** another new account, the same card; submit evidence `losing_evidence` | `dispute_lost`; not owned | |
| 13 | **Kill switch:** set `PAYMENTS=off`, restart | `/v1/me` says `payments":"off"`; checkout 503; accounts that own it still own it | |
| 14 | **Delete:** delete a paying account (Account → Delete) | Its `purchases` row stays with `user_id` NULL; no entitlement; signing up again with that email owns nothing | |

Stripe's testing docs describe the test cards and the evidence strings; check them before the run, in case they've
changed. Write down anything that differs from "Expect", with the event id.

## 6. Not done yet

- No email provider account, no DNS records, no staging database, no Stripe test run: all of these are yours to create
  or run. Nothing in this file has been run against a real external service.
- Production keeps the development-only edition gate; account-based ownership in production is a separate, reviewed
  step.
- No tax calculation, no country restriction, no admin tools.


## 7. The support form, the bot check, the audit log (added 2026-10-20)

- **Help & refunds** (`src/ui/Support.tsx` → `POST /v1/support` → `support.ts`, table `support_requests` from migration
  0003). Set `SUPPORT_TO` to the address that should get the notifications (a Worker secret on staging/production; a
  line in `.dev.vars` locally). Without it, requests are still stored; read them with the query in SECURITY.md.
  Refunds are issued in the Stripe dashboard; the webhook revokes the edition on its own.
- **Turnstile** (`turnstile.ts`, `src/ui/Turnstile.tsx`): set `TURNSTILE_SECRET` (Worker secret / `.dev.vars`) and build
  with `VITE_TURNSTILE_SITE_KEY`. Both or neither: with only the secret, every sign-in and support request is refused
  (fails closed); with only the site key, the widget shows and the token is ignored. Staging uses Cloudflare's test
  pair (site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`), which passes everything.
- **Audit log** (`audit.ts`): `npx wrangler tail --env staging` and look for lines starting with `{"audit":`.
