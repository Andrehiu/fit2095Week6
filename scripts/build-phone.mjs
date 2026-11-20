// Bundles the game into ONE self-contained HTML page (no server needed), for phones / static hosting.
// Usage: npm run build:phone [-- out/path.html]   (default: dist/overdue-phone.html)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const out = resolve(process.argv[2] || `${root}/dist/overdue-phone.html`);
const require = createRequire(import.meta.url);

// Embed the server's built-in meme catalogue so the page works without the API.
const catalogue = require(`${root}/routes/game.js`).fallbackContent();
catalogue.source = 'phone';

const js = (await build({
  entryPoints: [`${root}/public/game/main.js`], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020',
})).outputFiles[0].text;
const css = readFileSync(`${root}/public/game/game.css`, 'utf8');
let html = readFileSync(`${root}/views/game.html`, 'utf8');

// Keep only what lives inside <body>; the host page supplies doctype/head.
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script type="module"[^>]*><\/script>/, '')
  .replace(/<a class="back-link"[^>]*>.*?<\/a>/, '');
const safeJSON = JSON.stringify(catalogue).replace(/</g, '\\u003c');

const page = `<title>Overdue! Night Shift</title>
<meta name="theme-color" content="#05030c">
<style>
${css}
/* standalone build: fill the host frame */
html, body { height: 100%; }
</style>
${body.trim()}
<script>window.__OVERDUE_CATALOGUE__ = ${safeJSON};</script>
<script>
${js.replace(/<\/script/gi, '<\\/script')}
</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`Wrote ${out} (${(page.length / 1024).toFixed(1)} KB)`);
