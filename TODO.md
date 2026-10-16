# Search to-do

Goal: rank first for "nfl 2 min drill", "nfl 2 minute drill game", "2min nfl drill" and similar. The code side is done
(title, description, headings, structured data, `sitemap.xml`); what's left happens outside the repo.

## 1. Google Search Console (do this first)

- [x] Go to https://search.google.com/search-console and add a **Domain** property for `nfl-2min-drill.com`.
- [x] Verify it with the TXT record Google gives you (Cloudflare → DNS → Add record → TXT).
- [x] Sitemaps → submit the full address `https://nfl-2min-drill.com/sitemap.xml` (a Domain property rejects just
      `sitemap.xml`). Processed 2026-10-16: 1 page discovered.
- [ ] URL Inspection → paste `https://nfl-2min-drill.com/` → **Request indexing**.
- [ ] In URL Inspection, "View crawled page" → check the screenshot shows the game and the HTML has the new title.

## 2. Bing Webmaster Tools

- [ ] https://www.bing.com/webmasters → "Import from Google Search Console" (covers Bing, DuckDuckGo, Yahoo).
- [ ] After every deploy: `npm run indexnow` (pings Bing/DuckDuckGo/Yandex to recrawl right away).

## 3. Links to the site (the biggest ranking factor for a new site)

- [ ] GitHub repo → About (gear icon) → Website: `https://nfl-2min-drill.com`.
- [ ] Post it where football fans are: r/nfl (check its self-promotion rules), r/footballstrategy, r/WebGames,
      team subreddits, football Discords, X. Use the words "NFL 2-minute drill game" in the post title.
- [ ] Submit to web-game directories (e.g. itch.io page that links to the site, Product Hunt).
- [ ] Share daily results: every share card that links back helps.

## 4. Domain

- [x] Make `www.nfl-2min-drill.com` redirect to `https://nfl-2min-drill.com/` (Cloudflare → Rules → Redirect Rules),
      so both spellings land on one indexed page.

## 5. Check progress (2–4 weeks after step 1)

- [ ] Search Console → Performance → Queries: which searches show the site and at what position.
- [ ] Adjust the title/description in `index.html` toward the queries that get impressions but few clicks.

## 6. Career mode (beta, live since 2026-10-16)

Polish:
- [ ] A "Your drive · Q2 1:48 · down 3" banner pinned on top of the play caller during a moment.
- [ ] Scoring plays flash on the drive tracker's field strip.
- [ ] Animated XP bar and level-up on the postgame screen.
- [ ] Team logos (now: colored abbreviation chips).
- [ ] A `/career/` page for search ("football career mode game, free in your browser") and a sitemap entry.

Depth:
- [ ] Backups on every roster: split carries (rushing leaders run ~2,700 yards; NFL ~1,900), injuries, a depth chart.
- [ ] AI teams trading with each other (only your own trade request exists now).

Money (needs an account on your side first):
- [ ] A rewarded-ad network for "watch an ad to keep playing" (Google Ad Manager rewarded ads, or a game portal SDK
      such as CrazyGames or Poki). Gate only after a player is hooked, a few weeks into a season.
- [ ] A paid unlock (ad-free, more seasons).
- [ ] Legal review before charging (NFL marks in the site name and copy).
