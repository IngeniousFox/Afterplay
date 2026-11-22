import { chromium } from 'file:///D:/Dev/Afterplay/node_modules/playwright-core/index.mjs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))
execFileSync(process.execPath, [join(dir, 'build-tvpwa.mjs')], { stdio: 'inherit' })
const only = process.argv.slice(2)
const shots = { 'tvpwa-tv-library': [1920, 2248], 'tvpwa-tv-detail': [1920, 2248], 'tvpwa-tv-sections-1': [1920, 2248], 'tvpwa-tv-sections-2': [1920, 2248], 'tvpwa-tv-notes-journey': [1920, 2248], 'tvpwa-tv-menus': [1920, 2248], 'tvpwa-pwa-sessions-settings': [1920, 1100], 'tvpwa-pwa-sheets': [1920, 1100], 'tvpwa-pwa-detail': [1920, 1100], 'tvpwa-pwa-states': [1920, 1100] }
const browser = await chromium.launch()
for (const [name, [w, h]] of Object.entries(shots)) {
  if (only.length && !only.includes(name)) continue
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(join(dir, `${name}.html`)).href, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(dir, `${name}.png`) })
  await page.close()
  console.log('ok', name)
}
await browser.close()
