import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Social previews need absolute URLs. Set VITE_SITE_URL (e.g. https://your-domain.com) in .env.production or the
 * host's build settings; without it the tags fall back to relative paths and the canonical link is left out.
 */
function siteMeta(site: string): Plugin {
  const abs = (p: string) => (site ? `${site}/${p}` : p);
  return {
    name: 'site-meta',
    transformIndexHtml(html) {
      return html
        .replace(/%OG_IMAGE%/g, abs('og.png'))
        .replace('<!--CANONICAL-->', site ? `<link rel="canonical" href="${site}/" />` : '')
        .replace('<!--OG_URL-->', site ? `<meta property="og:url" content="${site}/" />` : '');
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
  };
});
