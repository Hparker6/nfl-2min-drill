# Google SEO measurement

One spreadsheet, one row per week, 20 minutes every Monday. The point is to tell which of five problems the site has,
because each has a different fix:

| Problem | How it shows up | Fix |
|---|---|---|
| 1. Not indexed | Search Console → Pages lists `/` or `/how-to-play/` as not indexed | Request indexing; links to the page |
| 2. Indexed but rarely shown | Indexed, but under ~50 impressions a week | Relevance: title, copy, links from other sites; mostly time |
| 3. Shown for the wrong queries | Impressions come from queries unrelated to the game (arcade machines, highlights) | Copy that says "game you play"; the title now does |
| 4. Impressions but few clicks | Impressions grow, CTR stays under ~2% at positions better than 10 | Title and description: what the snippet promises |
| 5. Clicks but no engagement | GA4 organic sessions with short engagement and few `game_start` | The first screen, speed, the brief |

The current state, as far as it could be checked without account access: the homepage is indexed by Bing's index
(which also serves DuckDuckGo and Yahoo) and by at least one other engine; Google's status is unknown until you look at
Search Console. Nothing in the code blocks indexing: canonical, robots, sitemap, status codes and the text fallback all
check out, and the leaderboard and stats pages are `noindex` on purpose.

## Search Console (the only true Google data)

Open the **Domain property** `nfl-2min-drill.com`. A URL-prefix property for `https://nfl-2min-drill.com/` misses
`www` and `http` hits; if that's what exists, add the Domain property (DNS verification) and keep both.

Every Monday, Performance → Search results, **Date: compare last 7 days with previous 7 days**, record:

| Report | Record | Reading it |
|---|---|---|
| Totals | Impressions, clicks, CTR, average position | Position means nothing under ~50 impressions. Compare direction, not decimals. |
| Queries (filter "Query contains") | Impressions and position for each phrase in the list below | Which phrases Google tests the site on; the leading indicator |
| Pages | Impressions and clicks per URL: `/` and `/how-to-play/` | The guide may earn impressions first; that is normal |
| Countries, Devices | Share of mobile | Confirms the phone experience is the one being judged |
| Indexing → Pages | `/` and `/how-to-play/` "Indexed"; `/leaderboard/` and `/stats/` "Excluded by noindex" | Any other state is a problem to fix that week |
| Core Web Vitals | Status | Says "not enough data" for a new site; use PageSpeed Insights lab scores weekly instead |

Record the status of `/` under URL Inspection once after the deploy: "URL is on Google" plus the crawl date tells you
when the new title was picked up.

## GA4

Filter every report to the hostname **`nfl-2min-drill.com`** (Explore → add a filter on Hostname, or the comparison
"Hostname exactly matches"). Before 2026-10-16 `www.nfl-2min-drill.com` didn't resolve, so there is no www traffic to
reconcile; localhost and preview hostnames from testing do show up and must be excluded.

Every Monday, compare last 7 days with the previous 7:

| Report | Record |
|---|---|
| Acquisition → Traffic acquisition, by Session default channel group | Sessions and engaged sessions for Organic Search, Social, Referral, Direct |
| Traffic acquisition, by Session source | `google` vs `bing` vs `duckduckgo` vs `yahoo` organic, side by side |
| Engagement → Events | Counts of `game_start`, `spot_complete`, `play_again`, `share`, `daily_complete` |
| Engagement → Pages and screens | Average engagement time for `/` and `/how-to-play/` |

The event names above are the ones the code sends (`src/game/analytics.ts`): `game_start` when a game begins,
`spot_complete` when one ends (that is the game-complete event; it kept its original name so history is continuous),
`play_again` when a player picks another game after finishing one, `share` for the share card, `daily_complete` after
a full Daily. Mark `game_start` and `spot_complete` as **key events** in GA4 (Admin → Events → toggle "Mark as key
event") so the acquisition report shows conversion rate by source. That is a dashboard setting, not a code change, and
nothing in the code needs to change for it.

## Bing Webmaster Tools

Set up by importing from Search Console (TODO.md). Its Search Performance report updates faster than Google's and is
the comparison: if Bing shows impressions for a phrase and Google shows none, the gap is Google's evaluation of the
site, not the page's relevance. Record Bing impressions and clicks on the same weekly row.

## Phrases to monitor

Use Search Console → Queries with "Query contains". No volumes are listed because none were measured; the report shows
the real ones.

**Brand:** `4th call`, `the 4th call game`, `nfl-2min-drill`, `nfl 2min drill`

**Category** (the targets): `2 minute drill game`, `two minute drill game`, `nfl 2 minute drill game`,
`2 min nfl drill`, `nfl 2 min drill`, `2 minute drill play calling`, `two minute drill simulator`,
`football play calling game`, `play calling game`, `football strategy game`, `daily football game`

**Competitor-related** (to see whether the site appears at all; never targeted in copy): `two minute drill daily`,
`nfl2mindrill`, `two-minute drill game nfl`

## Reading small numbers

- Under 50 impressions on a phrase, record it and move on; position is noise.
- Under 10 clicks a week from Google, don't compute CTR trends; count the clicks.
- Compare week to week, and the same week a month earlier. Don't react to one day.
- Change one thing at a time and write the date in the sheet. The title changed on the day of this deploy; leave it
  for 30 days.
- A phrase that gets impressions at a position worse than 20 is the next one to write for: a section in the guide that
  answers it, not a new page.
