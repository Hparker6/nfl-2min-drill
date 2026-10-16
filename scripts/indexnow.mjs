// Tells Bing, DuckDuckGo, Yandex and the other IndexNow engines that the site changed, so they recrawl it now instead
// of whenever they next get to it. Google does not use IndexNow; submit the sitemap in Search Console for Google.
//
//   npm run indexnow                              # after a deploy, pings the home page
//   npm run indexnow -- https://nfl-2min-drill.com/some-page
//
// The key is public/<key>.txt, served at the site root; IndexNow fetches it to check the ping came from the site.
import { readdirSync } from 'node:fs';

const SITE = (process.env.VITE_SITE_URL || 'https://nfl-2min-drill.com').replace(/\/+$/, '');
const key = readdirSync(new URL('../public/', import.meta.url)).find((f) => /^[0-9a-f]{32}\.txt$/.test(f))?.slice(0, -4);
if (!key) throw new Error('No IndexNow key file (public/<32 hex chars>.txt)');

const urls = process.argv.slice(2).length ? process.argv.slice(2) : [`${SITE}/`];
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation: `${SITE}/${key}.txt`, urlList: urls }),
});
// 200 and 202 both mean accepted; 403 means the key file isn't live yet (deploy first)
console.log(`IndexNow: ${res.status} ${res.statusText} for ${urls.join(', ')}`);
if (!res.ok) process.exit(1);
