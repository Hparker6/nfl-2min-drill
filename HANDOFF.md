# Handoff: read this before working on `coachs-edition`

For any Claude session working on this branch. Two sessions share it; this file is how they stay in step. Last
updated 2026-10-20.

## 1. First, pull

```bash
git checkout coachs-edition
git pull origin coachs-edition
```

Don't work from memory of earlier commits: the email code changed after `c9210c2` (section 2).

## 2. What changed on top of `c9210c2` (the Resend + staging commit)

Another session reworked the email code in `ef97827`:

- `resendConfig()` is gone; use `mailConfig(env, origin)` in `server/accounts/config.ts`.
- `cfg.mail` is now an object, not a string:
  - `{ kind: 'console' }`
  - `{ kind: 'resend', apiKey, from }`
  - `{ kind: 'off', why }`
- `resendMailer` is now `resendMailer(cfg.mail, fetch)` in `server/accounts/mailer.ts`, with a 10-second timeout.
- When an email can't be sent, its link and code are cancelled at once (`auth.ts`), and the log gets only the
  provider's HTTP status: never the address, link, code or key.
- The sign-in code is in the email body, not the subject (no lock-screen previews). There's an HTML version too.
- **Staging `SITE_ORIGIN` is `""` on purpose**, which keeps staging accounts off. The previous value,
  `https://nfl-2min-drill-staging.workers.dev`, doesn't exist: workers.dev addresses include the account's subdomain.
  A name like it could also be registered by someone else, who would then receive the sign-in links built from it.
  Set it to the exact address Cloudflare shows for the staging Worker
  (`https://nfl-2min-drill-staging.<account-subdomain>.workers.dev`). Copy it from Cloudflare; don't guess.
- Unchanged: the staging D1 binding (`the-fourth-call-database`) and `MAIL_FROM`
  (`The 4th Call <signin@nfl-2min-drill.com>`).
- Full setup, every setting and how it fails, the Resend DNS records, the staging steps and a Stripe test-mode checklist:
  `server/accounts/SETUP.md`.

## 3. Rules for the shared branch

- **Pull before starting; push as soon as a piece of work is done.** Small commits.
- **Never rewrite pushed history:** no rebase, squash, amend or force-push. Fix things in a new commit on top.
- **Don't edit the same files at the same time.** The overlap so far: `server/accounts/` and `wrangler.jsonc`. If both
  sessions need them, finish and push one change before starting the other.
- **Never merge into `main` or deploy production.** Pushing to `main` deploys the live site.
- **Never commit** `.dev.vars`, any key or secret, or anything under `docs/legal/`. All three are git-ignored; keep
  them that way. The repository is public.
- After any change, run the checks: `npx tsc -b`, `npx vitest run`, `npm run build`.

## 4. Where secrets go

- **Staging and production: Cloudflare Worker secrets.** Use `npx wrangler secret put NAME --env staging`, or the
  dashboard: the Worker → Settings → Variables and Secrets → type **Secret**. Each Worker (environment) has its own
  values.
- **Local: `.dev.vars`** (git-ignored; the template is `.dev.vars.example`).
- **Not** in GitHub secrets: Cloudflare's Git integration deploys this, not GitHub Actions. Not in Cloudflare's
  build variables, any `VITE_` variable (built into the public JavaScript), or `wrangler.jsonc` (public).
- The secrets: `AUTH_PEPPER` (32+ random characters; a different value per environment), `RESEND_API_KEY`,
  `STRIPE_SECRET_KEY` (test mode: `sk_test_`/`rk_test_`), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`.

## 5. Where things stand

- **Built and tested (343 tests):**
  - Passwordless email accounts, sessions, rate limits and account deletion.
  - Stripe Checkout in test mode: verified webhooks, duplicate events ignored, refunds and disputes.
  - Sign-in email through Resend.
  - The Coach's Edition features: Career Legacy, three career slots, the Gridiron Challenge.
- **Production is untouched:** no D1 binding at the top level of `wrangler.jsonc`, so every account and payment route
  answers 404. The Coach's Edition stays hidden in production builds (`src/game/edition.ts`).
- **Live payments are blocked in code:** `LIVE_PAYMENTS_ALLOWED = false` in `server/accounts/config.ts`, and live Stripe
  keys are refused. Turning that on is a deliberate, reviewed code change, made by the owner after the legal review.
  It's not a setting, and no session should change it on its own.

### Next, in order

1. Put the real staging address in `SITE_ORIGIN`.
2. Verify `nfl-2min-drill.com` in Resend (DNS records in `SETUP.md` §2). Then set the staging secrets.
3. Run the migrations, **then** deploy staging:
   - `npx wrangler d1 migrations apply DB --env staging --remote`
   - `npm run build && npx wrangler deploy --env staging`
4. Run the Stripe test-mode checklist (`SETUP.md` §5) and record the results.

### Still open (owner decisions)

- The attorney review: the domain, real NFL names, and whether the LLC is the seller.
- Tax and merchant of record: standard Stripe or Stripe Managed Payments.
- Refund and dispute policy, terms of sale, and the final privacy policy.
- Switching production from the preview gate to account-based ownership.
