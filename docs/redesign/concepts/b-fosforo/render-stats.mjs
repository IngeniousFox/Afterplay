import { chromium } from 'file:///D:/Dev/Afterplay/node_modules/playwright-core/index.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))
execFileSync(process.execPath, [join(dir, 'build-stats.mjs')], { stdio: 'inherit' })
const only = process.argv.slice(2)
const shots = {
  'stats-overview': [1600, 1000], 'stats-rhythm': [1600, 1000], 'stats-library': [1600, 1000], 'stats-pace': [1600, 1000], 'stats-cabinet': [1600, 1000],
  'stats-game': [1600, 1000], 'stats-game-signature': [1600, 1000], 'stats-game-rhythm': [1600, 1000], 'stats-journey': [1600, 1000]
}
const browser = await chromium.launch()
for (const [name, [w, h]] of Object.entries(shots)) {
  if (only.length && !only.includes(name)) continue
  if (!existsSync(join(dir, `${name}.html`))) continue
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(join(dir, `${name}.html`)).href, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(dir, `${name}.png`) })
  await page.close()
  console.log('ok', name)
}
await browser.close()
