# Security: accounts, payments and sign-in email

What protects players and their purchases, what was hardened on 2026-10-20, and what is still to do before live
payments. Code references are in `server/accounts/` unless noted. Keep this current when anything here changes.

## Card data never touches this site

Buyers type card details into **Stripe Checkout**, Stripe's own hosted page (`checkout.stripe.com`). This Worker only
ever sees Stripe's object ids, amounts and statuses. No card number, expiry, CVC or billing address is received,
logged or stored. That keeps the site in the lightest card-compliance category (PCI DSS SAQ A: a redirect to a hosted
payment page). Keep it that way: never add Stripe Elements, a card form or any card field to this site without
re-reading Stripe's PCI guidance.

## Controls in place

| Threat | Control | Where |
|---|---|---|
| SQL injection | Every query is a prepared statement with bound values; no query text is built from input. The one interpolation (`recompute`) inserts a fixed list of status constants. | all `*.ts` with `prepare(` |
| Oversized or malformed requests | Bodies are capped **before** they're read: a `Content-Length` over the limit is refused unread, and a body without one is read in chunks and abandoned past the limit. JSON must be valid UTF-8 and an object. 2 KB for account calls, 256 KB for Stripe webhooks. | `http.ts` `readCapped`, `readJson`; `purchases.ts` |
| Input validation | Email: normalized and pattern-checked (≤254 chars). Code: exactly 6 digits. Link token and session cookie: exactly 43 base64url characters. Checkout session id: `cs_(test\|live)_…`. Anything else is refused without a database lookup. | `auth.ts`, `sessions.ts`, `purchases.ts` |
| Cross-site request forgery | Every state-changing call must be `POST`, carry our `Origin`, not be marked cross-site by `Sec-Fetch-Site`, and be `application/json` (an HTML form can't send that). Session cookie is `SameSite=Lax`. | `http.ts` `checkWrite` |
| Session theft | `__Host-` cookie: `Secure`, `HttpOnly` (scripts can't read it), host-only. Only the token's SHA-256 is stored. 30 days idle, 180 days max, new session at every sign-in, sign-out-everywhere. | `sessions.ts`, `http.ts` |
| Code guessing, link guessing | Link tokens are 256-bit random; codes are uniform 6 digits with 5 tries per email and 10 per address per hour; everything expires in 15 minutes and works once. Hashes are keyed with `AUTH_PEPPER`, compared in constant time. | `auth.ts`, `crypto.ts` |
| Account enumeration | Asking for a sign-in gives the same answer for every address; no account is looked up until a token is used. | `auth.ts` `startEmail` |
| Email bombing, abuse | Sign-in emails: 3 per address per 15 min, 10 per day; 10 requests per caller per 15 min. Checkouts: 10 per user per hour. Counters are keyed hashes, never raw IPs or emails. | `ratelimit.ts` |
| Forged or replayed Stripe events | Signature checked (HMAC-SHA256, 5-minute tolerance, constant-time). Live/test mode must match. Each event id is recorded with its effect in one transaction, so a replay changes nothing. The object is re-read from Stripe's API, and a checkout must be complete, paid, $4.99 USD, our price id, quantity 1, for an existing user, before anything is granted. | `purchases.ts`, `stripe.ts` |
| A forged "payment complete" return | The success page only asks our records; Stripe's redirect proves nothing. | `purchases.ts` `checkoutStatus` |
| Redirect to a fake payment page | The server only accepts a checkout URL on `https://checkout.stripe.com/`, and the browser checks again before leaving. | `purchases.ts`, `src/game/account.ts` |
| Cross-site scripting | React escapes all rendered text. Server-built HTML (leaderboard, emails) escapes every value. The kick cam's captions are text nodes, not markup (names can come from an imported career save). Pages ship a Content-Security-Policy that allows scripts only from this site and Google's tag. | `src/ui/kickcam.ts`, `server/site/worker.js`, `public/_headers` |
| Clickjacking, sniffing, leaks | `frame-ancestors 'none'` / `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS (one year, subdomains), `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store` on every API answer. | `http.ts`, `public/_headers` |
| CORS | No `Access-Control-Allow-*` headers anywhere: other sites can't read API answers. | — |
| Secrets in the open | Keys live only in Worker secrets (`wrangler secret put`) and in a git-ignored `.dev.vars`. Logs carry HTTP statuses and short reasons, never an address, link, code, key or card detail. Live Stripe keys are refused in code until `LIVE_PAYMENTS_ALLOWED` is flipped in a reviewed commit. | `config.ts`, `mailer.ts` |
| Dependencies | Runtime dependencies are React and React DOM only; no Stripe or email SDK (both are plain `fetch`). `npm audit --omit=dev`: 0 vulnerabilities on 2026-10-20. | `package.json` |

## Sign-in email: deliverability

- **Authentication:** `nfl-2min-drill.com` is verified in Resend with DKIM (`resend._domainkey`), SPF on the `send`
  subdomain (MX + TXT), a return-path CNAME (`rsend`, must be DNS only), and DMARC (`_dmarc`, `p=none` for now).
- **The message:** plain text and HTML versions; no images or external resources (nothing to block, nothing that looks
  like tracking); says why it arrived and that there's no mailing list; the code is never in the subject or preview;
  a unique `X-Entity-Ref-ID` per message so Gmail doesn't thread sign-in emails together.
- **Expected:** a brand-new domain lands in spam at first. It improves with volume and with recipients marking it
  "Not spam". On staging the button points at `workers.dev` while the sender is `nfl-2min-drill.com`; that mismatch
  is itself a spam signal and goes away in production, where both are `nfl-2min-drill.com`.

## Before live payments (owner's checklist)

1. **Turnstile on sign-in.** Cloudflare's free bot check in front of `/v1/auth/email/start` stops scripted email
   bombing beyond what the rate limits cover. Needs a site key from Cloudflare → Turnstile; then a small code change.
2. **Stripe Radar rules.** In the Stripe dashboard, keep Radar on and add "request 3D Secure when supported" so card
   testing and stolen cards get challenged by the bank.
3. **Stripe receipts.** Stripe → Settings → Customer emails → "Successful payments": Stripe emails the receipt from
   its own trusted domain. Better deliverability than anything we'd send, and nothing to build.
4. **Turn off what isn't wanted at checkout.** Stripe → Settings → Payment methods: Link's saved methods and
   "Pay later" appear even though the session asks for card only.
5. **DMARC to enforcement.** After two to four weeks of clean sending, change `_dmarc` to
   `v=DMARC1; p=quarantine; rua=mailto:<an address you read>` so nobody else can send as the domain.
6. **Separate production keys.** A new `AUTH_PEPPER`, a live restricted Stripe key with only the permissions in
   SETUP.md, its own webhook secret, a production Resend key. Never reuse staging's.
7. **Rotate anything that was ever pasted into a chat, an issue or a screenshot.**
8. **Logs.** `npx wrangler tail` during the first live sales; check nothing personal appears.
