/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const NAME = 'The 4th Call';
// the site's indexable pages for the sitemap: the game and the guide (static, public/how-to-play/). The Worker's
// /leaderboard/ and /stats/ pages are noindex while thin (INDEXABLE in server/site/worker.js) and so stay out of the
// sitemap; add them back here when that flag turns on.
const PAGES: [string, string][] = [['/', 'daily'], ['/how-to-play/', 'weekly']];
const ABOUT = 'A free American football strategy game. Run the two-minute drill at the end of a close game: call every play, manage the clock, and see each call graded against every option you had. New game every day.';

/**
 * Social previews, the canonical link, structured data and the sitemap need absolute URLs. Set VITE_SITE_URL
 * (e.g. https://your-domain.com) in .env.production or the host's build settings; without it the tags fall back to
 * relative paths, the canonical link and sitemap are left out, and robots.txt has no Sitemap line.
 */
function siteMeta(site: string): Plugin {
  const abs = (p: string) => (site ? `${site}/${p}` : p);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: NAME, alternateName: ['4th Call'], ...(site && { url: `${site}/` }) },
      {
        '@type': ['VideoGame', 'WebApplication'],
        name: NAME,
        alternateName: ['4th Call', '2-Minute Drill Football Play-Calling Game'],
        description: ABOUT,
        genre: ['Sports', 'Strategy'],
        gamePlatform: 'Web browser',
        applicationCategory: 'GameApplication',
        operatingSystem: 'Any',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        image: abs('og.jpg'),
        ...(site && { url: `${site}/` }),
      },
    ],
  };
  return {
    name: 'site-meta',
    transformIndexHtml(html) {
      return html
        .replace(/%OG_IMAGE%/g, abs('og.jpg'))
        .replace('<!--CANONICAL-->', site ? `<link rel="canonical" href="${site}/" />` : '')
        .replace('<!--OG_URL-->', site ? `<meta property="og:url" content="${site}/" />` : '')
        .replace('<!--JSONLD-->', `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);
    },
    generateBundle() {
      // one indexable page: the modes are hash routes (#survivor, #practice), which search engines don't index separately
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\n${site ? `\nSitemap: ${site}/sitemap.xml\n` : ''}` });
      if (site) {
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map(([p, f]) => `  <url><loc>${site}${p}</loc><lastmod>${today}</lastmod><changefreq>${f}</changefreq></url>`).join('\n')}\n</urlset>\n`,
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const site = (env.VITE_SITE_URL || '').trim().replace(/\/+$/, '');
  return {
    plugins: [react(), siteMeta(site)],
    base: './',
    worker: { format: 'es' },
    // the engine tests simulate thousands of plays each; give them room on slower machines
    test: { exclude: ['node_modules/**', 'dist/**', 'scripts/**'], testTimeout: 120_000 },
  };
});
