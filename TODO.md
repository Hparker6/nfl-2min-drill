# Search to-do

Goal: rank first for "nfl 2 min drill", "nfl 2 minute drill game", "2min nfl drill" and similar. The code side is done
(title, description, headings, structured data, `sitemap.xml`); what's left happens outside the repo.

## 1. Google Search Console (do this first)

- [ ] Go to https://search.google.com/search-console and add a **Domain** property for `nfl-2min-drill.com`.
- [ ] Verify it with the TXT record Google gives you (Cloudflare → DNS → Add record → TXT).
- [ ] Sitemaps → submit `https://nfl-2min-drill.com/sitemap.xml`.
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

- [ ] Make `www.nfl-2min-drill.com` redirect to `https://nfl-2min-drill.com/` (Cloudflare → Rules → Redirect Rules),
      so both spellings land on one indexed page.

## 5. Check progress (2–4 weeks after step 1)

- [ ] Search Console → Performance → Queries: which searches show the site and at what position.
- [ ] Adjust the title/description in `index.html` toward the queries that get impressions but few clicks.
