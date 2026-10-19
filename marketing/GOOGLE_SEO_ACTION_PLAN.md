# Google SEO action plan: seven days

Why this exists: Bing, DuckDuckGo and Yahoo send traffic and Google sends little. Those three are **one index**:
DuckDuckGo and Yahoo serve Bing's results. So the site has been accepted by one search engine, Bing, which indexes
new sites within days and is pinged by `npm run indexnow` after every deploy. Google is slower with a new domain that
has few links, and it is the only engine the IndexNow ping does not reach. That is the bottleneck, and it is mostly
time and links, not code. The code side is done in the working tree; this plan is the part only you can do.

Rules, as in [REDDIT_PLAYBOOK.md](REDDIT_PLAYBOOK.md): disclose that you made the game every time you link it; one
account; no vote requests, paid or traded reviews, alternate accounts, or claims about popularity or other games;
read each community's current rules before posting.

## Do now (today, in this order)

| # | Task | Impact | Effort | Why |
|---|---|---|---|---|
| 1 | Review the diff, push to main (it deploys). | High | 15 min | Nothing below counts until the new title, copy and guide are live. |
| 2 | Search Console → URL Inspection → `https://nfl-2min-drill.com/` → **Request indexing**. Repeat for `/how-to-play/`. | High | 5 min | Asks Google to recrawl today instead of whenever it gets to it. Request each URL once; repeated requests do nothing. |
| 3 | Search Console → Performance: export the last 28 days as the baseline. Settings → check the **property is the Domain property** (`nfl-2min-drill.com`), not a URL-prefix property, so www and http hits count. | High | 10 min | Without a baseline you can't tell what changed. See [GOOGLE_SEO_MEASUREMENT.md](GOOGLE_SEO_MEASUREMENT.md). |
| 4 | Search Console → Pages: note the status of `/` and `/how-to-play/`. If either says "Crawled, currently not indexed" or "Discovered, not indexed", that is the diagnosis and step 2 is the fix. | High | 5 min | Separates "not indexed" from "indexed but not shown". |
| 5 | `npm run indexnow` after the deploy. | Medium | 1 min | Keeps Bing current. Google ignores it. |
| 6 | Listdle: use "Suggest a Game" at listdle.com/submit (verified 2026-10-19 to exist; it lists NFL daily games in a Sports category). Pitch the Daily as a once-a-day game. | Medium | 15 min | A relevant directory link from a site Google already trusts for daily games. |
| 7 | Set `VITE_FEEDBACK_URL` in Cloudflare build settings to a short form or `mailto:` and redeploy. | Medium | 20 min | The footer Feedback link appears; players tell you what confused them. |

## Days 2–7

| Day | Task | Impact | Effort |
|---|---|---|---|
| 2 | Record one Daily and one Practice spot on a phone. Cut two 15–25 s clips per [VIDEO_IDEAS.md](VIDEO_IDEAS.md) (v01 first). Post one. | High over time | 1.5 h |
| 3 | Read the rules of r/WebGames and r/playmygame on the sites themselves, then post to **one** of them (link post, title starts with "The 4th Call", say you made it). | High | 45 min |
| 3 | itch.io: create a page for the game (verified: HTML5 games upload as a ZIP with `index.html`; itch hosts the files). Build with `VITE_LEADERBOARD_URL=https://nfl-2min-drill.com` so the leaderboard still works from itch's domain, and link back to the site in the description. | Medium | 1 h |
| 4 | Post the second clip. Reply to every comment from days 2–3. | Medium | 30 min |
| 5 | Show HN: one post, honest title ("Show HN: A football play-calling game that grades every call by simulation"), with a comment on how the grading works. Read the Show HN rules first. | Medium, swingy | 30 min |
| 6 | Record two more clips. Answer clock-management questions on r/footballstrategy as a fan, no link unless asked. | Medium | 1 h |
| 7 | Measurement check per [GOOGLE_SEO_MEASUREMENT.md](GOOGLE_SEO_MEASUREMENT.md). Decide what to repeat. | High | 30 min |

The repeatable loop after day 7: two clips a week, one community post a week at most, one directory a week until the
list is done, and the Monday measurement check.

## Directories and platforms, investigated

| Site | Status | Fit and notes |
|---|---|---|
| [Listdle](https://listdle.com/) | **Verified** 2026-10-19: "Suggest a Game" → `/submit`; Sports category lists DeepBall, Sundaydle, Daily Draft | Best fit. Daily-game directory with football games already on it. |
| [itch.io](https://itch.io/docs/creators/html5) | **Verified**: free; HTML5 games uploaded as ZIP; itch hosts the files; external HTTPS calls allowed | Second storefront with a link back. The CSP in `public/_headers` doesn't apply on itch's domain. |
| [CrazyGames developers](https://developer.crazygames.com/) | **Not verified**: the portal publishes HTML5 games but I could not read its requirements (SDK, exclusivity) | Portals usually require their SDK and ads. Read the terms first. |
| [Poki developers](https://developers.poki.com/) | **Not verified** | Same caveat. |
| [Newgrounds](https://www.newgrounds.com/) | **Not verified**: check upload rules and whether a game that calls an external API is allowed | |
| Product Hunt | **Not verified** for games; read the current guidelines | One planned launch with a maker comment. |
| Hacker News, Show HN | Rules public; one post per project | Audience likes the simulation-grading angle. |

Skip: paid "featured" listings, link exchanges, any site that wants a reciprocal footer link.

## Content that earns links without asking for them

Links come to pages people cite. The guide now has three sections nobody else has, because they come from the
engine: the [defense table](https://nfl-2min-drill.com/how-to-play/#defense) (what each of 19 defenses stops and gives
up), the [graded drive](https://nfl-2min-drill.com/how-to-play/#example) with the field goal that graded a big miss,
and the two-minute-drill rules. When you post a clip or answer a question, link the specific section, not the
homepage; sections get quoted.

Next candidates, each a real feature or a page built from the engine, in order of effort:
1. **"Should you kick or go?"** A short section or page built the same way as the worked example: 4th-down spots at
   several distances and clocks, each graded. People link to fourth-down tables.
2. **A weekly "the call that graded worst"** post, from your own Daily, with the numbers. Repeatable content for X and
   the subreddit post that is allowed.
3. **The Daily's share card** already carries the site address. Keep it.

## Communities

Follow [REDDIT_PLAYBOOK.md](REDDIT_PLAYBOOK.md) as written; its rule summaries are third-party and were last checked
on 2026-10-12, so confirm each sidebar before posting. The short version: r/WebGames or r/playmygame for the game
itself (one post, written for that community); r/footballstrategy and r/NFL for participating as a fan, with the game
mentioned only when asked and the rules allow it; Discord servers only after asking a moderator.

## Feedback, sharing and repeat play, without manipulation

- The Feedback footer link (set `VITE_FEEDBACK_URL`). Three questions: what confused you, what you'd change, would you
  play tomorrow.
- The share card after a Daily exists; don't add nag prompts. Average engagement is already long; the Daily resets at
  midnight UTC, which is the honest reason to come back.
- Reply to comments with the grade the game gave and why. Ship fixes visibly and credit the person, with permission.
- Never pay for reviews, trade anything for a share, or quote praise without asking.

## What depends on Google, not on you

- **Recrawl and re-evaluation.** After the deploy and the indexing request, Google usually recrawls the homepage within
  days, but re-ranking a new domain takes weeks. Don't change the title again inside 30 days or you can't tell what
  helped.
- **Rich results.** The FAQ markup on the guide is valid, but Google shows FAQ rich results only for government and
  health sites since 2023. It's kept because it's accurate, not for a visual.
- **Trademark.** The title now uses the league's name descriptively, as the competitor and its copies do, to say which
  teams the game depicts. That is a legal judgment, not an SEO one: the disclaimer in the footer and About reduce
  confusion but don't remove risk, and the exposure grows once ads or payments run. Get the legal review in TODO.md
  before monetizing. Reverting is one line in `index.html`.
