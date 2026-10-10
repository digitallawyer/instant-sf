import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const page = p => resolve(import.meta.dirname, p);

// The source uses root-relative URLs ("/play/", "/data/sf/...", "/img/..."), which is what the dev
// server serves. For a sub-path deploy (GitHub Pages project site), BASE=/instant-sf/ and this plugin
// prefixes those URLs in the built HTML, CSS and JS.
const BASE = process.env.BASE || '/';
const ROUTES = '(?:img|play|game|sights|streets|eat|privacy|terms|data|favicon\\.svg)';
function basePaths() {
  if (BASE === '/') return null;
  const inHtml = new RegExp(`(["'\\s,(])/(?=${ROUTES}(?:[/?#"'\\s,)]|$))`, 'g');
  const inCode = new RegExp(`(["'\`])/(?=${ROUTES}[/?#"'\`])`, 'g');
  return {
    name: 'base-paths',
    enforce: 'post',
    transformIndexHtml: { order: 'post', handler: html => html.replace(inHtml, `$1${BASE}`).replace(/href="\/"/g, `href="${BASE}"`) },
    transform(code, id) {
      if (id.includes('node_modules') || !/\.(js|css)$/.test(id.split('?')[0])) return null;
      return code.replace(inCode, `$1${BASE}`).replace(/href="\/"/g, `href="${BASE}"`);
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [basePaths()].filter(Boolean),
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: page('index.html'),
        play: page('play/index.html'),
        game: page('game/index.html'),
        sights: page('sights/index.html'),
        streets: page('streets/index.html'),
        eat: page('eat/index.html'),
        privacy: page('privacy/index.html'),
        terms: page('terms/index.html'),
      },
    },
  },
  server: { host: '127.0.0.1' },
});
