/** 本地真实编辑器回归；仅临时目录落盘，保存请求由隔离替身处理，不写 data/。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer, buildCharacter } from './editor.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'test/.test-tmp/schema3-closeout')
fs.mkdirSync(out, { recursive: true })
const bot = process.env.META_BOT_ROOT
if (!bot) throw new Error('请设置 META_BOT_ROOT（只读取其中 puppeteer 依赖）')
const require = createRequire(path.join(bot, 'package.json'))
const puppeteer = require('puppeteer')
const edge = process.env.META_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
assert.ok(fs.existsSync(edge), `Edge 不存在：${edge}`)
const original = JSON.parse(fs.readFileSync(path.join(root, 'data/gi/芙宁娜.json'), 'utf8'))
let disk = structuredClone(original)
let saveCount = 0
const errors = []
const server = createServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
const browser = await puppeteer.launch({ executablePath: edge, headless: true, pipe: true, userDataDir: path.join(out, 'edge-profile'), args: ['--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-crash-reporter'] })
try {
  const page = await browser.newPage()
  page.on('pageerror', e => errors.push(String(e)))
  await page.setViewport({ width: 1600, height: 1000 })
  await page.setRequestInterception(true)
  page.on('request', async request => {
    try {
      if (!request.url().startsWith(url) && !/^(data:|about:)/.test(request.url())) return await request.abort()
      const pathname = new URL(request.url()).pathname
      if (pathname === '/api/save') {
        const body = JSON.parse(request.postData())
        disk = buildCharacter(body.characters[0].character, original.name, disk)
        fs.writeFileSync(path.join(out, 'browser-saved.json'), JSON.stringify(disk, null, 2))
        saveCount++
        return await request.respond({ contentType: 'application/json', body: JSON.stringify({ ok: true, characters: [{ name: original.name, json: disk, fields: [] }] }) })
      }
      // 禁止其余真实写入请求；preview/心跳只读。
      if (request.method() !== 'GET' && !['/api/preview', '/api/heartbeat'].includes(pathname)) return await request.respond({ status: 403, contentType: 'application/json', body: '{"error":"浏览器回归禁止项目数据写入"}' })
      await request.continue()
    } catch (e) { errors.push(String(e)) }
  })
  await page.goto(url, { waitUntil: 'networkidle0' })
  const listing = await page.evaluate(async () => (await (await fetch('/api/characters')).json()))
  const items = Array.isArray(listing) ? listing : listing.characters || listing.items
  assert.ok(Array.isArray(items), '角色列表应为数组')
  for (const item of items.filter(item => item.presets?.length > 1)) {
    for (const key of Object.keys(item.filled)) assert.equal(item.filled[key], item.presets.every(p => p.filled[key]), `${item.name}/${key} 缺项必须覆盖全部预设`)
  }
  await page.evaluate(() => selectCharacter('芙宁娜'))
  await page.waitForSelector('[data-preset-switch]')
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth, main: document.querySelector('.main').getBoundingClientRect().width, selector: document.querySelector('[data-preset-switch]').getBoundingClientRect().width }))
  assert.ok(dimensions.scroll <= dimensions.viewport, JSON.stringify(dimensions))
  assert.ok(dimensions.main > 500 && dimensions.selector > 100)
  const firstId = await page.evaluate(() => state.model.presetConfig.id)
  await page.evaluate(() => { state.model.meta.定位 = '浏览器输出草稿'; markDirty(true); renderForm() })
  await page.select('[data-preset-switch]', '1')
  await page.evaluate(() => { state.model.meta.定位 = '浏览器辅助草稿'; markDirty(true); renderForm() })
  await page.select('[data-preset-switch]', '0')
  assert.equal(await page.evaluate(() => state.model.meta.定位), '浏览器输出草稿')
  await page.screenshot({ path: path.join(out, 'editor-presets.png'), fullPage: true })
  await page.evaluate(() => save())
  assert.equal(saveCount, 1)
  assert.equal(disk.presets.find(p => p.id === firstId).meta.定位, '浏览器输出草稿')
  assert.equal(disk.presets[1].meta.定位, '浏览器辅助草稿')
  await page.click('[data-act="preset-copy"]')
  await page.evaluate(() => { state.model.meta.定位 = '副本独立'; markDirty(true) })
  await page.select('[data-preset-switch]', '0')
  assert.equal(await page.evaluate(() => state.model.meta.定位), '浏览器输出草稿')
  await page.click('[data-act="preset-delete"]')
  await page.click('[data-act="preset-delete"]')
  assert.equal(await page.$eval('[data-act="preset-delete"]', el => el.disabled), true)
  assert.equal(await page.evaluate(() => handleAction('preset-delete', '', -1, null)), false)
  assert.equal(await page.evaluate(() => state.model._presets.length), 1)
  await page.screenshot({ path: path.join(out, 'editor-last-preset.png'), fullPage: true })
  assert.deepEqual(errors, [])
  const result = { url, dimensions, saveCount, checks: ['全部预设缺项统计', '页面宽度不溢出', '预设切换保留两份草稿', '保存多预设到隔离文件', '复制内容不串值', '最后一份禁删按钮与逻辑双保护'], errors, limitation: '保存使用真实buildCharacter、隔离/api/save替身落盘test/.test-tmp；未调用真实data写入及发布链路；截图未做视觉读图' }
  fs.writeFileSync(path.join(out, 'browser-result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
