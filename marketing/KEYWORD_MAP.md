# Keyword map

Written 2026-10-22, three days after the SEO deploy. **Measured** means it comes from the Search Console figures you
reported (636 impressions, 20 clicks, 3.1% CTR, average position 6.7, top queries `nfl2mindrill`, `nfl2mindrill con`,
`2mindrill`, `nfl mindrill`, `nfl2mindrill.com`, `nfl2min drill game`). I have no Search Console access and no
keyword-volume or difficulty tool; everything else is a hypothesis ranked by relevance and by what the result pages
looked like when I searched them (an arcade machine, NFL highlight clips and coaching articles, almost no games).

## What the early data says

The visible query sample (Search Console, 2026-10-15 to 2026-10-17) is heavily weighted toward competitor-related
searches, misspellings included. Google shows nfl-2min-drill.com for them because the domain contains the same
tokens. Search Console omits anonymized and very low-volume queries, so the visible list is a sample, not the whole;
and position ~6.7 is an aggregate across every query the site appeared for, not a position for any target phrase. That is real exposure, but most of those people are looking for the other game. Two consequences:

- These queries are **not a target**. No pages, copy or metadata should chase `nfl2mindrill` spellings; that would
  be a doorway page for someone else's brand and it would not earn players who stay.
- The site's job on those visits is to be **clearly itself** in the first five seconds: a different name, a different
  pitch (you call the defense too; every call graded), so a person who wanted this kind of game stays and one who
  wanted that specific game leaves without confusion. The title, H1 and intro already do this; nothing more is added.

The queries that matter are the game-intent ones below, for which the data so far has **not demonstrated meaningful
visibility**: none appeared in the visible sample. The 28-day
review in [GOOGLE_SEO_MEASUREMENT.md](GOOGLE_SEO_MEASUREMENT.md) is where that changes or doesn't.

## Clusters

Priority: P0 = the page's reason to exist; P1 = covered by an existing page and worth a sentence; P2 = watch only.

| # | Cluster and variants | Intent | Target page | Coverage now | Evidence | Confidence | Change | Priority |
|---|---|---|---|---|---|---|---|---|
| 1 | `nfl 2 minute drill game`, `nfl 2 min drill game`, `2min nfl drill`, `nfl 2-minute drill game online` | Play a game, browser | `/` | Title leads with it; H1, description, copy | Not in the visible sample (3 days). Result pages are an arcade cabinet and clips, so a game page is what's missing | Medium | None; deployed 2026-10-19 | P0 |
| 2 | `two minute drill game`, `2 minute drill game`, `2 minute drill football game`, `two-minute drill game free` | Play a game | `/` | Same elements as 1 | Not in the visible sample | Medium | None | P0 |
| 3 | `football play calling game`, `play calling game`, `call the plays game`, `nfl play calling game` | Play a game; wants the play-calling part | `/` | "Call the Plays" in the title, H1 "play-calling game", copy | Not in the visible sample | Medium | None | P0 |
| 4 | `football strategy game`, `football strategy game browser`, `free football strategy game` | Play a game; broader | `/` | Was in the old title; after the title change it appeared once in copy | Not in the visible sample | Low: broad, likely crowded by manager games | Intro now says "a free football strategy game in your browser: you call the plays" (homepage, fallback, guide lede) | P1 |
| 5 | `two minute drill simulator`, `nfl two minute drill simulator`, `nfl play calling simulator`, `football play calling simulator` | Play or try a tool | `/` | "simulation" appeared once | Not in the visible sample; the result pages are Madden tips and toys | Medium: nothing playable ranks for it | One sentence in "How calls are graded": the game is a play-calling simulator underneath; every snap and grade comes from the simulation | P1 |
| 6 | `2 minute drill practice`, `two minute drill practice`, `football decision making practice`, `practice play calling` | Improve at it; could be a coach or a player | `/` (Practice mode) and `/how-to-play/#modes` | Practice mode existed but was described only as "build any spot" | Not in the visible sample | Medium | Practice is now described as two-minute drill practice (repeat a fourth-down call or a goal-line stand with Coach mode) on both pages | P1 |
| 7 | `how to run a two minute drill`, `two minute drill strategy`, `two minute drill clock management`, `when to use timeouts two minute drill` | Learn (coaching and fan intent) | `/how-to-play/#strategy` and `#example` | Strategy section, graded drive | Not in the visible sample | Medium: coaching articles rank; the graded drive is the distinct angle | None now; see "Next content" | P1 |
| 8 | `what does cover 2 stop`, `cover 3 vs cover 2`, `best defense against two minute drill` | Learn | `/how-to-play/#defense` (the 19-defense table) | Table from the engine | Not in the visible sample | Low–medium | None now | P2 |
| 9 | `the 4th call game`, `4th call football game` | Brand | `/` | Everywhere | Not in the visible sample; brand is new | High once people know it | None | P2 |
| 10 | `nfl2mindrill` and its misspellings, `two minute drill game nfl` (competitor brand) | Navigational, someone else's game | none | The domain earns these on its own | **Measured: dominates the visible query sample** | High | **Do not target.** Monitor only, and report CTR separately so it doesn't inflate the game-intent numbers | Watch |

## Why the pages, not new pages

Clusters 1–6 are the same intent with different words: a person who wants to play. One homepage answers all of them;
six pages would compete with each other and each would be thin. Clusters 7–8 are learning intents and belong in the
guide, which already has the sections. The only new pages worth making are ones that add something a reader would
link to, listed under "Next content".

## What changed on this pass

Three sentences, all describing mechanics that exist:

- Homepage intro, the fallback and the guide lede: "a free football strategy game ... you call the plays" (cluster 4).
- Homepage "How calls are graded": the play-calling simulator sentence (cluster 5).
- Homepage and guide, Practice: described as two-minute drill practice with Coach mode (cluster 6).

No title, H1, URL, sitemap or structured-data change. The title deployed on 2026-10-19 stays for 30 days.

## Next content (not built; needs your call)

Each is a real resource built from the engine, like the graded drive, so it can be cited:

1. **Fourth-down decisions, graded** (clusters 6–7): a table of 4th-down spots at several distances and clocks, each
   with the win chance of kick, punt and go, generated by `scripts/example.gen.test.ts`'s method. A section of the
   guide, not a new page, unless it grows past ~600 words.
2. **The two-minute drill, play by play, from the defense's side** (cluster 8): the same graded-drive format with you
   on defense. Nobody else can publish this.
3. **"Is The 4th Call the same as Two-Minute Drill?"** (cluster 10): only if the confusion shows up in feedback or in
   comments. An honest one-paragraph FAQ answer, not a page, and never a misspelling-targeted URL.

## Measurement hooks

Search Console → Queries, "Query contains": `drill` (then split brand vs game-intent by eye), `play calling`,
`strategy game`, `simulator`, `practice`, `4th call`. The full procedure, baseline and the two review dates are in
[GOOGLE_SEO_MEASUREMENT.md](GOOGLE_SEO_MEASUREMENT.md).
