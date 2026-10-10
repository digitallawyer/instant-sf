// Dev helper: headless check of the procedural audio engine.
//   node tools/audio-check.mjs            (Vite dev server must be running on :5273)
// Opens audio-test.html, unlocks audio, fires every one-shot, sweeps every update() input, checks that
// voices are released, then runs the OfflineAudioContext level report and prints peak/RMS per sound.
// Exit code 1 on console errors, NaN samples or leaked voices.
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const url = process.env.URL || 'http://127.0.0.1:5273/audio-test.html';
const skipReport = process.argv.includes('--no-report');
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  userDataDir: path.resolve('data/cache/chrome-audio'),
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage();
// Other people edit the repo while this runs; stub Vite's HMR client so a full-reload can't kill the test.
await page.setRequestInterception(true);
page.on('request', req => {
  if (req.url().endsWith('/@vite/client')) req.respond({ status: 200, contentType: 'application/javascript', body: 'export {}' });
  else req.continue();
});
const errors = [], warnings = [];
page.on('console', m => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 500));
  else if (m.type() === 'warning') warnings.push(m.text().slice(0, 300));
});
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
page.on('response', r => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });
let navigations = 0;
page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const debug = () => page.evaluate(() => window.audio.debug());

await page.goto(url, { waitUntil: 'networkidle0' });
await page.click('#unlock');
await sleep(500);
console.log('after unlock:', await debug());

// 1) every one-shot button
const shots = await page.$$('[data-shot], [data-amb]');
for (const b of shots) { await b.click(); await sleep(120); }
console.log(`fired ${shots.length} one-shot buttons; peak debug:`, await debug());

// 2) sweep every slider / select / checkbox while the rAF loop calls update()
const t0 = Date.now();
await page.evaluate(() => {
  const ids = ['speed', 'grade', 'height', 'fog', 'night', 'wet', 'nearWater', 'traffic'];
  const mounts = ['bike', 'walk', 'skate', 'sealion'], surfs = ['ground', 'deck', 'pier', 'water'];
  const start = performance.now();
  window.__sweep = setInterval(() => {
    const t = (performance.now() - start) / 1000;
    ids.forEach((id, i) => {
      const el = document.getElementById(id), lo = +el.min, hi = +el.max;
      el.value = lo + (hi - lo) * (0.5 + 0.5 * Math.sin(t * (0.7 + i * 0.37)));
      el.dispatchEvent(new Event('input'));
    });
    document.getElementById('mount').value = mounts[Math.floor(t / 0.8) % 4];
    document.getElementById('surface').value = surfs[Math.floor(t / 1.3) % 4];
    document.getElementById('air').checked = Math.sin(t * 3) > 0.85;
    document.getElementById('braking').checked = Math.sin(t * 2.1) > 0.5;
  }, 50);
});
await page.click('#music');
for (let i = 0; i < 6; i++) { await sleep(1000); await page.click('[data-shot="land"][data-arg="1"]'); }
await page.evaluate(() => { clearInterval(window.__sweep); document.querySelector('[data-preset="reset"]').click(); });
await page.click('#music');
console.log(`swept inputs for ${((Date.now() - t0) / 1000).toFixed(1)} s:`, await debug());

// 3) mute / unmute round-trip, then voices must drain
await page.click('#mute'); await sleep(600);
const mutedState = await debug();
await page.click('#mute'); await sleep(400);
console.log('mute ->', mutedState.state, '| unmute ->', (await debug()).state);
await sleep(9000);
const drained = await debug();
console.log('after 9 s idle:', drained);

// 4) offline level report
let report = null;
if (!skipReport) {
  await page.click('#report');
  await page.waitForFunction(() => window.__report, { timeout: 300000 });
  report = await page.evaluate(() => window.__report);
  if (report.error) { errors.push('[report] ' + report.error); report = null; }
  else console.log('\n' + (await page.$eval('#reportOut', el => el.textContent)));
}

let fail = false;
if (navigations > 1) console.log(`NOTE: page navigated/reloaded ${navigations - 1}x during the run (Vite full-reload from concurrent edits?)`);
if (errors.length) { fail = true; console.log('\nCONSOLE ERRORS:\n' + errors.join('\n')); } else console.log('\nconsole errors: none');
if (warnings.length) console.log('console warnings:\n' + warnings.slice(0, 20).join('\n'));
if (drained.voices > 0) { fail = true; console.log('LEAK: voices still active after idle:', drained.voices); }
if (report) {
  const nan = report.filter(r => r.nan > 0), leak = report.filter(r => r.voicesLeft > 0);
  const silent = report.filter(r => r.kind === 'shot' && !(r.peakDb > -60));
  const hot = report.filter(r => r.kind !== 'stress' && r.peakDb > -1);
  if (nan.length) { fail = true; console.log('NaN in:', nan.map(r => r.name).join(', ')); }
  if (leak.length) { fail = true; console.log('voices leaked in offline render:', leak.map(r => `${r.name}(${r.voicesLeft})`).join(', ')); }
  if (silent.length) { fail = true; console.log('SILENT one-shots:', silent.map(r => r.name).join(', ')); }
  if (hot.length) console.log('near full scale (>-1 dBFS):', hot.map(r => r.name).join(', '));
}
await browser.close();
console.log(fail ? '\nRESULT: FAIL' : '\nRESULT: OK');
process.exit(fail ? 1 : 0);
