import { chromium } from 'file:///D:/Dev/Afterplay/node_modules/playwright-core/index.mjs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))
execFileSync(process.execPath, [join(dir, 'build-sistema.mjs')], { stdio: 'inherit' })
const only = process.argv.slice(2)
const names = ['sistema-tokens-color', 'sistema-tokens-tipo', 'sistema-tokens-capas', 'sistema-controles-botones', 'sistema-controles-seleccion', 'sistema-superficies', 'sistema-medios', 'sistema-movimiento', 'sistema-movimiento-fotogramas']
const browser = await chromium.launch()
for (const name of names) {
  if (only.length && !only.some((o) => name.includes(o))) continue
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(join(dir, `${name}.html`)).href, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: '*{animation-play-state:paused!important;animation-delay:-.6s!important}' })
  await page.waitForTimeout(250)
  const over = await page.evaluate(() => { const s = document.querySelector('.sx'); return [s.scrollHeight, s.scrollWidth] })
  if (over[0] > 1000 || over[1] > 1600) console.log('OVERFLOW', name, over)
  await page.screenshot({ path: join(dir, `${name}.png`) })
  await page.close()
  console.log('ok', name)
}
await browser.close()
