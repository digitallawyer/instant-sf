// Dev helper for the landmark models: loads the game once in a headless Chrome (own profile, real GPU)
// and takes a series of screenshots from fixed camera positions.
//   CHROME_PROFILE=data/cache/chrome-landmarks node tools/landmark-shot.mjs <outDir> <shots.json | inline JSON>
// shots: [{ name, cam: [x, y, z], look: [x, y, z], hour?, fov?, js? }]  (world metres: x east, z south, y up)
//   cam/look may also be { lat, lon, y } or { lat, lon, agl } (height above the terrain).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] || 'shots';
const arg = process.argv[3] || '[]';
const shots = JSON.parse(fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg);
const url = process.env.URL || 'http://127.0.0.1:5273/play/?dev';
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  userDataDir: path.resolve(process.env.CHROME_PROFILE || 'data/cache/chrome-landmarks'),
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false', `--window-size=${process.env.W || 1440},${process.env.H || 900}`],
  defaultViewport: { width: +(process.env.W || 1440), height: +(process.env.H || 900), deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[lm]')) logs.push(`[${m.type()}] ${m.text().slice(0, 1500)}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#loader')?.classList.contains('done') || /wrong/.test(document.querySelector('#loader-step')?.textContent || ''), { timeout: 180000 });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
const ready = async () => {
  await page.waitForFunction(() => window.__sf && document.querySelector('#loader')?.classList.contains('done'), { timeout: 180000 });
  await page.evaluate(() => { __sf.setMode('fly'); __sf.setMode('still'); });
};
await ready();
let i = 0;
for (const s of shots) {
  let r;
  for (let attempt = 0; attempt < 4; attempt++) {
    try { r = await place(s); break; } catch (e) { console.log('retry (page reloaded?)', e.message.slice(0, 80)); await new Promise(res => setTimeout(res, 1500)); await ready(); }
  }
  await new Promise(res => setTimeout(res, s.wait || 1800));
  const file = path.join(out, `${String(i++).padStart(2, '0')}-${(s.name || 'shot').replace(/[^\w.-]+/g, '_').slice(0, 40)}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 85 });
  const stats = await page.evaluate(() => document.querySelector('#stats')?.innerText || '').catch(() => '');
  console.log(file, '|', stats.replace(/\n/g, ' | '), JSON.stringify(r));
}
if (logs.length) console.log(logs.slice(0, 40).join('\n'));
await browser.close();

async function place(s) {
  return page.evaluate(s => {
    const { camera, sky, hf } = __sf;
    const pt = v => {
      if (Array.isArray(v)) return v;
      const { project } = __sf.landmarks._util;
      const [x, z] = v.x != null ? [v.x, v.z] : project(v.lat, v.lon);
      return [x, v.y ?? (Math.max(0, hf.at(x, z)) + (v.agl ?? 2)), z];
    };
    if (s.hour != null) sky.setHour(s.hour);
    if (s.fov) { camera.fov = s.fov; camera.updateProjectionMatrix(); }
    const c = pt(s.cam), l = pt(s.look);
    camera.position.set(c[0], c[1], c[2]);
    camera.lookAt(l[0], l[1], l[2]);
    __sf.csm.updateFrustums();
    if (s.js) (0, eval)(s.js);
    return { c, l };
  }, s);
}
