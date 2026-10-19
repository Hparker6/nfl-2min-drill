# Google SEO measurement

One spreadsheet, one row per check, 20 minutes each time. The point is to tell which of five problems the site has,
because each has a different fix:

| Problem | How it shows up | Fix |
|---|---|---|
| 1. Not indexed | Search Console → Pages lists `/` or `/how-to-play/` as not indexed | Request indexing; links to the page |
| 2. Indexed but rarely shown | Indexed, but under ~50 impressions a week on game-intent queries | Relevance: title, copy, links from other sites; mostly time |
| 3. Shown for the wrong queries | Impressions come from queries unrelated to the game, or from another game's brand | Copy that says what this game is; don't chase the wrong queries |
| 4. Impressions but few clicks | Impressions grow, CTR stays under ~2% at positions better than 10 | Title and description: what the snippet promises |
| 5. Clicks but no engagement | GA4 organic sessions with short engagement and few `game_start` | The first screen, speed, the brief |

## Baseline (Search Console, 2026-10-15 to 2026-10-17; reported 2026-10-22)

| Measure | Value |
|---|---|
| Impressions | ~636 |
| Clicks | ~20 |
| CTR | 3.1% |
| Average position | 6.7 |
| Visible top queries | `nfl2mindrill`, `nfl2mindrill con`, `2mindrill`, `nfl mindrill`, `nfl2mindrill.com`, `nfl2min drill game` |

Reading it: the site **is indexed and is shown** (problems 1 and 2 are not the issue). The visible query sample is
heavily weighted toward competitor-related searches, misspellings included, which the domain name attracts because it
shares their tokens (problem 3). The data so far has **not demonstrated meaningful visibility for the intended
non-brand game-intent queries**; that is not the same as proof of zero. Search Console omits anonymized and very
low-volume queries from the query report, so some impressions in the total belong to queries you cannot see. Position
6.7 is an aggregate across every query the site appeared for, dominated by the competitor-related ones, and must not
be read as the position for any target keyword. So the number to watch is not total impressions, which the
competitor-related queries will keep inflating, but **impressions on game-intent queries**, split out as below.

Average position is an average over every query and every appearance, weighted by nothing you control. A page at
position 3 for one phrase and position 40 for another reports ~20. Compare position only within one query group, and
only once that group has ~50 impressions.

## The split that matters

Search Console → Performance → Queries. Build two saved views with the "Query" filter and record each separately:

**Game-intent** (the target): "Query contains" each of `minute drill game`, `min drill game`, `play calling`,
`strategy game`, `simulator`, `practice`, then `drill` minus the brand spellings below. Record impressions, clicks,
CTR, position, and the top five queries.

**Competitor-brand** (watch only): "Query contains" `mindrill`, and `2mindrill`. Record the same numbers. Expect its
CTR to be low; those people wanted the other game. Do not optimize for it.

**Own brand:** "Query contains" `4th call`. Expect near zero for weeks.

## 7-day review (2026-10-29)

Compare last 7 days with the previous 7 days (the Date filter does this).

1. Game-intent view: any impressions at all? Which queries? That is the first signal that the new title and copy
   registered. Under 50 impressions, record it and don't interpret position.
2. Pages: impressions and clicks for `/` and `/how-to-play/` separately. The guide earning game-intent impressions
   before the homepage is normal.
3. Indexing: both URLs "Indexed"; `/leaderboard/` and `/stats/` "Excluded by noindex". URL Inspection on `/` should
   show a crawl date after 2026-10-19; if the crawl date is older, the new title hasn't been seen yet and nothing else
   can be judged.
4. Competitor-brand view: record; nothing to do.
5. GA4 (below): organic sessions by source and `game_start` per session.

Decision at day 7: none. Seven days is enough to confirm the crawl, not the ranking.

## 28-day review (2026-11-19)

Compare last 28 days with the previous 28.

1. Game-intent impressions and clicks vs. the baseline, in which none were visible. Growth here is the objective; the total is not.
2. For any game-intent query over ~50 impressions: position and CTR. Position worse than 20 with impressions means
   Google is testing the page; that query goes to the top of the next content list in
   [KEYWORD_MAP.md](KEYWORD_MAP.md). Position better than 10 with CTR under 2% means the snippet, not the ranking.
3. Share of impressions that are competitor-brand. It should fall as game-intent grows; if it is still ~100%, the
   site is relevant to Google only through the domain name, and the fix is links and mentions, not copy.
4. Landing pages: whether `/how-to-play/` is earning the learning queries (clusters 7–8 in the keyword map).
5. Only now consider a title change, and only if game-intent impressions exist with poor CTR.

## Search Console setup

Open the **Domain property** `nfl-2min-drill.com`. A URL-prefix property for `https://nfl-2min-drill.com/` misses
`www` and `http` hits; if that's what exists, add the Domain property (DNS verification) and keep both. Export the
Performance report at each review; Search Console keeps 16 months, but your exports keep the split views.

## GA4

Filter every report to the hostname **`nfl-2min-drill.com`** (Explore → filter on Hostname, or the comparison
"Hostname exactly matches"). Localhost and preview hostnames from testing show up and must be excluded.

| Report | Record |
|---|---|
| Acquisition → Traffic acquisition, by Session default channel group | Sessions and engaged sessions for Organic Search, Social, Referral, Direct |
| Traffic acquisition, by Session source | `google` vs `bing` vs `duckduckgo` vs `yahoo` organic, side by side |
| Engagement → Events | Counts of `game_start`, `spot_complete`, `play_again`, `share`, `daily_complete` |
| Engagement → Pages and screens | Average engagement time for `/` and `/how-to-play/` |

The event names are the ones the code sends (`src/game/analytics.ts`): `game_start` when a game begins,
`spot_complete` when one ends (the game-complete event, under its original name so history is continuous),
`play_again` when a player picks another game after finishing one, `share` for the share card, `daily_complete` after
a full Daily. Mark `game_start` and `spot_complete` as **key events** (Admin → Events → "Mark as key event") so the
acquisition report shows conversion by source. That is a dashboard setting; no code change is needed.
### Google organic vs. Bing organic

Search Console measures how the site appears in Google search; GA4 measures what visitors do once they arrive. Neither
says what a visitor was originally looking for. The comparison below shows whether Google's visitors and Bing's
behave differently on the site, nothing more.

Explore → Free form, dimension Session source / medium, filtered to `google / organic` and `bing / organic` (add
`duckduckgo / organic` and `yahoo / organic` if present), hostname `nfl-2min-drill.com`, same date range as the
Search Console review:

| Metric | How to get it |
|---|---|
| Organic sessions | Sessions |
| `game_start` per organic session | Event count for `game_start` ÷ Sessions |
| `spot_complete` per organic session | Event count for `spot_complete` ÷ Sessions |

How the two events behave in the code (`src/ui/GameScreen.tsx`): `game_start` fires once when a player starts a game
from its brief, and once more, with `resumed: true`, if a saved game is reopened after a reload; filter on
`resumed = false` for new starts. `spot_complete` fires once per finished game, guarded against repeats. A Daily is
three games, so three of each per completed Daily is expected. Career "moment" segments send neither; Career has its
own `career_game` event. A page view with no `game_start` is a visit that never took the headset.

## Bing Webmaster Tools

Set up by importing from Search Console (TODO.md). Its Search Performance report updates faster than Google's and is
the comparison: if Bing shows impressions for a game-intent phrase and Google shows none, the gap is Google's
evaluation of the site, not the page's relevance. Record Bing impressions and clicks on the same row. Run
`npm run indexnow` after each deploy.

## Reading small numbers

- Under 50 impressions on a phrase, record it and move on; position is noise.
- Under 10 clicks a week from Google on a view, don't compute CTR trends; count the clicks.
- Compare like periods: 7 vs. previous 7, 28 vs. previous 28. Don't react to one day.
- Change one thing at a time and write the date in the sheet. The title changed on 2026-10-19; the three copy
  sentences changed on the next deploy. Leave both for the 28-day review.
