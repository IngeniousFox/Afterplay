import { chromium } from 'file:///D:/Dev/Afterplay/node_modules/playwright-core/index.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))
const shots = [['home',1600,1000],['library',1600,1000],['detail',1600,1000],['sessions',1600,1000],['plan',1600,1000],['settings',1600,1000],['tv',1920,1080],['pwa',1920,1100]]
const only = process.argv.slice(2)
const browser = await chromium.launch()
for (const [n,w,h] of shots) {
  if (only.length && !only.includes(n)) continue
  const page = await browser.newPage({ viewport:{width:w,height:h}, deviceScaleFactor:1 })
  await page.goto(pathToFileURL(join(dir,n+'.html')).href, { waitUntil:'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(dir,n+'.png') })
  await page.close()
  console.log('ok', n)
}
await browser.close()
