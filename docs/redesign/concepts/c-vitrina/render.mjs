import { chromium } from 'file:///D:/Dev/Afterplay/node_modules/playwright-core/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const shots = { home: [1600, 1000], library: [1600, 1000], detail: [1600, 1000], sessions: [1600, 1000], plan: [1600, 1000], settings: [1600, 1000], tv: [1920, 1080], pwa: [1920, 1100] };
const only = process.argv.slice(2);
const browser = await chromium.launch();
for (const [name, [w, h]] of Object.entries(shots)) {
  if (only.length && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(dir, name + '.html')).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(dir, name + '.png') });
  await page.close();
  console.log('ok', name);
}
await browser.close();
