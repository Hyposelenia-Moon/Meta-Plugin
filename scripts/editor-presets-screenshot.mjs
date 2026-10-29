/** 编辑器截图与浏览器交互验证；仅写 test/.test-tmp。 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from './editor.mjs'
const dir = path.resolve('test/.test-tmp/editor-presets')
fs.mkdirSync(dir, { recursive: true })
const bot = process.env.META_BOT_ROOT
if (!bot) throw new Error('设置 META_BOT_ROOT 指向含 puppeteer 的 bot 根目录（只读）')
const modules = path.join(bot, 'node_modules')
const direct = path.join(modules, 'puppeteer/lib/puppeteer/puppeteer.js')
const fallback = fs.readdirSync(path.join(modules, '.pnpm')).find(name => /^puppeteer@/.test(name))
const entry = fs.existsSync(direct) ? direct : path.join(modules, '.pnpm', fallback || '', 'node_modules/puppeteer/lib/puppeteer/puppeteer.js')
const { default: puppeteer } = await import(pathToFileURL(entry).href)
const server = createServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await puppeteer.launch({ headless: true, executablePath: process.env.META_BROWSER_PATH || undefined, userDataDir: path.join(dir, 'browser-profile'), args: ['--no-sandbox', '--disable-crash-reporter'] })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', err => errors.push(err.message))
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 })
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' })
  await page.evaluate(async () => { await openCharacter('芙宁娜') })
  await page.waitForSelector('[data-preset-switch]')
  await page.screenshot({ path: path.join(dir, 'editor-presets-dps.png'), fullPage: false })
  await page.select('[data-preset-switch]', '1')
  await page.waitForFunction(() => state.model.presetConfig.role === 'support')
  await page.screenshot({ path: path.join(dir, 'editor-presets-support.png'), fullPage: false })
  const audit = await page.evaluate(() => ({ preset: state.model.presetConfig, names: buildBody().presets.map(p => p.name), width: document.documentElement.scrollWidth, viewport: innerWidth, weapon: state.model.v2.weapons[0].items[0].name }))
  if (errors.length) throw new Error(errors.join('\n'))
  if (audit.width > audit.viewport) throw new Error('页面横向溢出')
  if (audit.weapon !== '西风剑') throw new Error('辅助预设内容不正确')
  fs.writeFileSync(path.join(dir, 'browser-audit.json'), JSON.stringify({ errors, ...audit }, null, 2))
  console.log('浏览器预设切换、辅助内容与无异常检查通过；截图：' + dir)
} finally {
  if (browser) await browser.close()
  await new Promise(resolve => server.close(resolve))
}
