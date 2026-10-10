// Dev helper: renders the game in a separate headless Chrome (own profile, real GPU) and saves screenshots.
//   node tools/shot.mjs [outDir] [view keys...]      e.g. node tools/shot.mjs /tmp/shots Digit1 Digit3
// Each key is pressed, then a screenshot is taken. Prefix with "eval:" to run JS in the page instead.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] || 'shots';
const steps = process.argv.slice(3);
const url = process.env.URL || 'http://127.0.0.1:5273/play/?dev';
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  userDataDir: path.resolve(process.env.CHROME_PROFILE || 'data/cache/chrome-profile'),
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#loader')?.classList.contains('done') || /wrong/.test(document.querySelector('#loader-step')?.textContent || ''), { timeout: 120000 });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl?.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
console.log('gpu', gpu);
await new Promise(r => setTimeout(r, 2500));
let i = 0;
const shoot = async name => {
  const file = path.join(out, `${String(i++).padStart(2, '0')}-${name.replace(/[^\w.-]+/g, '_').slice(0, 40)}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 85 });
  const stats = await page.evaluate(() => document.querySelector('#stats')?.innerText || '');
  console.log(file, '|', stats.replace(/\n/g, ' | '));
};
if (!steps.length) await shoot('start');
for (const s of steps) {
  if (s.startsWith('eval:')) { await page.evaluate(s.slice(5)); await new Promise(r => setTimeout(r, 1200)); continue; }
  if (s.startsWith('wait:')) { await new Promise(r => setTimeout(r, +s.slice(5))); continue; }
  if (s.startsWith('hold:')) { const [, k, ms] = s.split(':'); await page.keyboard.down(k); await new Promise(r => setTimeout(r, +ms)); await page.keyboard.up(k); continue; }
  if (s.startsWith('down:')) { await page.keyboard.down(s.slice(5)); continue; }
  if (s.startsWith('up:')) { await page.keyboard.up(s.slice(3)); continue; }
  if (s === 'shot') { await shoot('shot'); continue; }
  if (s.startsWith('log:')) { console.log('log:', JSON.stringify(await page.evaluate(s.slice(4)))); continue; }
  await page.keyboard.press(s);
  await new Promise(r => setTimeout(r, 1800));
  await shoot(s);
}
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
await browser.close();
