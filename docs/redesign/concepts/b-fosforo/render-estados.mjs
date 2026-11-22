import { chromium } from 'file:///D:/Dev/Afterplay/node_modules/playwright-core/index.mjs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))
execFileSync(process.execPath, [join(dir, 'build-estados.mjs')], { stdio: 'inherit' })
const only = process.argv.slice(2)
const names = ['nowplaying', 'sync', 'avisos', 'pendientes', 'asignar', 'vacio-biblioteca', 'vacios', 'ajustes-general', 'ajustes-library', 'ajustes-emulators', 'ajustes-saves', 'ajustes-integrations', 'ajustes-backups', 'ajustes-achievements', 'ajustes-about', 'migracion-pasos', 'migracion-decisiones', 'overlay', 'ambient']
const browser = await chromium.launch()
for (const n of names) {
  if (only.length && !only.includes(n)) continue
  const name = `estados-${n}`
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(join(dir, `${name}.html`)).href, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(dir, `${name}.png`) })
  await page.close()
  console.log('ok', name)
}
await browser.close()
