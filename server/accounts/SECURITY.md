# Security: accounts, payments, email and the support form

What protects players and their money, mapped to the OWASP Top 10 (web, 2021) and the OWASP API Security Top 10
(2023), with where each control lives. Hardened 2026-10-20. Keep this current when anything here changes.

The OWASP Top 10 for LLM/AI applications (prompt injection, model poisoning, and so on) does not apply: the game has
no AI model, no chatbot and no generated content; "AI rivals" and "the AI coach" are the game's own simulation.

## The one thing that matters most

**Card data never touches this site.** Buyers enter card details on Stripe Checkout, Stripe's hosted page. The
Worker only sees Stripe's ids, amounts and statuses; no card number, expiry, CVC or billing address is received,
logged or stored. That keeps the site in the lightest PCI DSS category (SAQ A). Never add a card form, Stripe
Elements or any card field here without re-reading Stripe's PCI guidance.

## OWASP Top 10 (web), item by item

| # | Risk | Status | Controls, and where |
|---|---|---|---|
| A01 | Broken access control | Covered | Every account action needs a valid session (`withSession`, `routes.ts`); a checkout status is looked up by session id **and** user id, so nobody can read another player's purchase (`purchases.ts` `checkoutStatus`); deletion needs the account's own email typed again; the Stripe redirect proves nothing, only the webhook grants (`purchases.ts`). No admin endpoints exist. |
| A02 | Cryptographic failures | Covered | HTTPS only, HSTS one year with subdomains (`http.ts`, `public/_headers`). Session tokens and sign-in links are 256-bit random; only SHA-256/HMAC hashes are stored, keyed with `AUTH_PEPPER`; comparisons are constant-time (`crypto.ts`). Secrets live only in Worker secrets and the git-ignored `.dev.vars`. |
| A03 | Injection | Covered | SQL: every query is a prepared statement with bound values; the one interpolation inserts fixed constants (`purchases.ts` `recompute`). HTML: React escapes all rendered text; server-built HTML (leaderboard, emails, support notice) escapes every value; kick-cam captions are text nodes (`kickcam.ts`). Headers: the reply-to address is validated as an address; the support message is body text only, control characters stripped (`support.ts`). Paths: Stripe ids must match an id shape and are URL-encoded; the Stripe client refuses any path but three (`stripe.ts`). |
| A04 | Insecure design | Covered | Ownership is derived from Stripe's own answer about a checkout that must be complete, paid, $4.99 USD, our price id, quantity 1, for an existing user (`checkoutProblem`). Refunds and disputes revoke automatically. The support form stores before it notifies. Live keys are refused in code until a reviewed change (`LIVE_PAYMENTS_ALLOWED`). |
| A05 | Security misconfiguration | Covered | Content-Security-Policy on pages (scripts only from this site, Google's tag, Turnstile) and `default-src 'none'` on API answers; `X-Frame-Options: DENY` / `frame-ancestors 'none'`; `nosniff`; `Referrer-Policy`; `Permissions-Policy`; `Cross-Origin-Resource-Policy: same-origin`; `Cache-Control: no-store` on the API; no CORS headers anywhere. Production has no database binding at all until the launch commit. |
| A06 | Vulnerable and outdated components | Covered | Runtime dependencies are React and React DOM only; Stripe, Resend and Turnstile are plain `fetch`, no SDKs. `npm audit --omit=dev`: 0 vulnerabilities (2026-10-20). Lockfile committed. Re-run `npm audit` before each release. |
| A07 | Identification and authentication failures | Covered | Passwordless: nothing to phish or reuse. Links and codes expire in 15 minutes, work once; 5 code tries per email, 10 per address per hour; a new session at every sign-in (no fixation); 30-day idle / 180-day maximum; sign out everywhere; the cookie is `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, and must be exactly the shape the server issues before any lookup (`sessions.ts`). Asking for a sign-in reveals nothing about whether the address exists. Turnstile on the sign-in form when configured (`turnstile.ts`). |
| A08 | Software and data integrity failures | Covered | Stripe webhooks: HMAC signature, 5-minute tolerance, live/test mode check, event ids recorded in the same transaction as their effect, object re-read from Stripe's API (`purchases.ts`, `stripe.ts`). The browser only follows a checkout URL on `checkout.stripe.com` (`src/game/account.ts`). Deploys come from the Git-connected build of this repository. |
| A09 | Logging and monitoring failures | Covered, with a manual step | An audit line per sign-in request and result, checkout, webhook outcome, deletion and support request (`audit.ts`), with address/token/code/message fields dropped by construction. Failures log the provider's HTTP status only. **Manual:** read them in Cloudflare → Workers → Logs, or `npx wrangler tail --env <env>`; Cloudflare's Logpush or a notification on error rate is the next step for production. |
| A10 | Server-side request forgery | Covered | The Worker calls exactly three hosts, each hard-coded: `api.stripe.com` (three paths, allowlisted), `api.resend.com`, `challenges.cloudflare.com`. No URL from a request is ever fetched. |

## OWASP API Security Top 10, where it adds something

| # | Risk | Status | Controls |
|---|---|---|---|
| API1 | Broken object-level authorization | Covered | see A01 |
| API2 | Broken authentication | Covered | see A07 |
| API3 | Broken object property level authorization | Covered | Responses are built field by field (`/v1/me` returns a masked email, the owned products, the payments mode); no object is serialized wholesale. The price and product are fixed on the server; a request cannot name them. |
| API4 | Unrestricted resource consumption | Covered | Bodies capped before they're read (2 KB account calls, 8 KB support, 256 KB webhook), UTF-8 required (`http.ts` `readCapped`); rate limits per caller, per address, per user (`ratelimit.ts`); Turnstile on the open forms; email and support sends are the scarce resource and are limited hardest. |
| API5 | Broken function-level authorization | Covered | There are no privileged functions over the API; refunds are issued in the Stripe dashboard, never through the site. |
| API6 | Unrestricted access to sensitive business flows | Covered | Checkout: 10 per user per hour, 409 when already owned; sign-in email: 3 per address per 15 minutes; support: 5 per caller per hour; honeypot and Turnstile on the open forms. |
| API7 | Server-side request forgery | Covered | see A10 |
| API8 | Security misconfiguration | Covered | see A05 |
| API9 | Improper inventory management | Covered | Every route is listed at the top of `routes.ts`; anything else is 404; production answers 404 to all of them until launch. |
| API10 | Unsafe consumption of APIs | Covered | Stripe's answers are type-checked field by field before use (`checkoutProblem`); Resend's and Turnstile's answers are reduced to a boolean; timeouts on every outbound call (8–10 s). |

## Sign-in and support email

- `nfl-2min-drill.com` is verified in Resend: DKIM, SPF on the `send` subdomain, return-path CNAME (`rsend`, DNS only),
  DMARC `p=none` (tighten to `p=quarantine` after a few clean weeks).
- Messages: plain text and HTML, no images or external resources, the code never in the subject or preview, a
  unique `X-Entity-Ref-ID` per message, why-you-got-this and never-share lines.
- Support notices to the owner are plain text with reply-to set to the player; the HTML version is the same text,
  escaped, in a `<pre>`.

## The support queue

Requests are rows in `support_requests` (`status` open/done, `notified_at`). To see what's open on staging:
`npx wrangler d1 execute DB --env staging --remote --command "SELECT substr(id,1,8) ref, kind, email, created_at FROM support_requests WHERE status='open' ORDER BY created_at"`
and to close one: `… --command "UPDATE support_requests SET status='done' WHERE id LIKE 'ABCD1234%'"`. Rows with
`notified_at` NULL were never emailed (the provider was down): check them by hand.

## Before live payments (owner's checklist)

1. **Real Turnstile keys.** Staging uses Cloudflare's test pair, which passes everything. For production: Cloudflare →
   Turnstile → add the site (`nfl-2min-drill.com`, Managed mode) → set `VITE_TURNSTILE_SITE_KEY` in the Cloudflare
   build variables and `npx wrangler secret put TURNSTILE_SECRET` (no `--env`).
2. **Stripe Radar:** keep it on; add a rule to request 3D Secure when supported (bank challenges for stolen cards).
3. **Stripe receipts:** Settings → Customer emails → Successful payments, so Stripe sends the receipt from its own
   trusted domain.
4. **Payment methods:** Settings → Payment methods, turn off Link's saved methods and pay-later if unwanted.
5. **DMARC to `p=quarantine`** with a `rua=` address after a few weeks of clean sending.
6. **Separate production secrets:** a new `AUTH_PEPPER`, a live restricted Stripe key (Checkout Sessions write,
   Charges and Disputes read, nothing else), its own webhook secret, a production Resend key, `SUPPORT_TO`.
7. **Monitoring:** Cloudflare → Workers → nfl-2min-drill → Logs; watch `audit` lines and error rate during the first
   live sales. Consider a Cloudflare notification on 5xx rate.
8. **Legal:** terms of sale, refund policy (what the support form promises: refunds to the original card, the edition
   removed on refund), privacy policy covering accounts, Stripe and the support inbox.
9. **Rotate anything ever pasted into a chat, an issue or a screenshot.**
