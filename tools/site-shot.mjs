// Dev helper for the companion website: loads pages in headless Chrome and screenshots them at desktop and phone widths.
//   node tools/site-shot.mjs <outDir> <url...>
// Env: WIDTHS (default "1440,390"), FULL=1 for full-page shots, SEGS=1 for one shot per screenful while scrolling
// (so scroll-triggered reveals have run), CHROME_PROFILE (default data/cache/chrome-site).
// Also reports horizontal overflow (document wider than the viewport) and console errors.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] || 'site-shots';
const urls = process.argv.slice(3);
const widths = (process.env.WIDTHS || '1440,390').split(',').map(Number);
const full = process.env.FULL === '1';
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  userDataDir: path.resolve(process.env.CHROME_PROFILE || 'data/cache/chrome-site'),
  args: ['--hide-scrollbars'],
});
for (const url of urls) {
  for (const w of widths) {
    const page = await browser.newPage();
    const logs = [];
    page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); });
    page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
    await page.setViewport({ width: w, height: w < 600 ? 844 : 900, deviceScaleFactor: 1, isMobile: w < 600, hasTouch: w < 600 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
    await new Promise(r => setTimeout(r, +(process.env.WAIT || 1200)));
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      const wide = [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > de.clientWidth + 1).slice(0, 5).map(el => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
      return { scrollW: de.scrollWidth, clientW: de.clientWidth, wide };
    });
    const name = url.replace(/^https?:\/\/[^/]+\/?/, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'home';
    const file = path.join(out, `${name.slice(0, 50)}-${w}.jpg`);
    if (process.env.SEGS === '1') {
      const vh = page.viewport().height;
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0, k = 0; y < total && k < 30; y += vh, k++) {
        await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), y);
        await new Promise(r => setTimeout(r, 1100));
        await page.screenshot({ path: file.replace(/\.jpg$/, `-${String(k).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 70 });
      }
    } else {
      await page.screenshot({ path: file, type: 'jpeg', quality: 80, fullPage: full });
    }
    console.log(file, overflow.scrollW > overflow.clientW ? `OVERFLOW ${overflow.scrollW}>${overflow.clientW} ${overflow.wide.join(' ')}` : 'ok', logs.length ? '\n  ' + logs.join('\n  ') : '');
    await page.close();
  }
}
await browser.close();
