/**
 * 立绘「页面内自量自裁」端到端自检（维护期脚本，不入 56 套）
 *
 * 验的是**模板里那段脚本**本身：把 codex.html 的自量脚本原样抽出来，喂人工造的几何图，
 * 用 bot 的原始启动参数（`--disable-gpu --no-sandbox --no-zygote`，**不带** `--allow-file-access-from-files`）
 * 打开，逐用例断言：
 *   ① 脚本能取到像素（data: URL 不被 canvas 污染）；
 *   ② 摆出来的盒与 `planPortraitBox()` 对同一张图的结果一致（误差 < 0.01%）；
 *   ③ 裁后区域盖满取景窗（left ≤ 0、left+w ≥ 100 等）。
 *
 * 2026-10-17 复审修复后新增**右 / 下 / 四边**用例：旧 `walk()` 用「idx < 半边」控制循环，
 * 右/下两条边是从末尾往里退（step=-1），首轮即 false → right/bottom 恒为 0、白条裁不掉。
 *
 * 用法：node scripts/portrait-autocrop-selftest.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const tplFile = path.join(root, 'resources', 'codex', 'codex.html')
const scannerFile = path.join(root, 'scripts', 'scan-portrait-padding.mjs')
const tmpDir = path.join(root, 'out', 'autocrop-selftest')
fs.mkdirSync(tmpDir, { recursive: true })

/* ---------- 1. 造几何图：四边留白可配（纯白，边缘整齐） ---------- */
function makePaddedPng (w, h, pads) {
  const left = Math.round(w * (pads.left || 0))
  const right = Math.round(w * (pads.right || 0))
  const top = Math.round(h * (pads.top || 0))
  const bottom = Math.round(h * (pads.bottom || 0))
  const raw = Buffer.alloc((w * 3 + 1) * h)
  let p = 0
  for (let y = 0; y < h; y++) {
    raw[p++] = 0 // filter: none
    for (let x = 0; x < w; x++) {
      const isPad = x < left || x >= w - right || y < top || y >= h - bottom
      if (isPad) {
        raw[p++] = 255; raw[p++] = 255; raw[p++] = 255
      } else {
        raw[p++] = (x * 7) & 0xff
        raw[p++] = (y * 5) & 0xff
        raw[p++] = ((x + y) * 3) & 0xff
      }
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  function crc32 (buf) {
    let c = ~0
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i]
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------- 2. 从模板里抽出「自量自裁」脚本，填上参数 ---------- */
const tpl = fs.readFileSync(tplFile, 'utf8')
const scriptMatch = tpl.match(/<script>\s*\/\*\s*\n\s*\*\s*立绘「自量自裁」[\s\S]*?<\/script>/)
if (!scriptMatch) {
  console.error('✗ 模板里找不到「自量自裁」脚本块')
  process.exit(1)
}
const profile = await import(pathToFileURL(path.join(root, 'lib', 'model', 'ProfileImgRes.js')).href)
const cardRatio = 1.5
const script = scriptMatch[0]
  .replace(/\{\{cropCfg\.tol\}\}/g, String(profile.cropCfg.tol))
  .replace(/\{\{cropCfg\.cover\}\}/g, String(profile.cropCfg.cover))
  .replace(/\{\{cropCfg\.min\}\}/g, String(profile.cropCfg.min))
  .replace(/\{\{cropCfg\.colorCap\}\}/g, String(profile.cropCfg.colorCap))
  .replace(/\{\{cropCfg\.whiteLevel\}\}/g, String(profile.cropCfg.whiteLevel))
  .replace(/\{\{cropCfg\.whiteLineCover\}\}/g, String(profile.cropCfg.whiteLineCover))
  .replace(/\{\{portraitRatio\}\}/g, String(cardRatio))
if (/\{\{/.test(script)) {
  console.error('✗ 脚本里还有没替换掉的模板占位符：', script.match(/\{\{[^}]*\}\}/g))
  process.exit(1)
}

/* ---------- 3. 用 bot 的原始启动参数跑四个用例 ---------- */
const BOT = process.env.META_BOT_ROOT || 'D:/Program Files/Yunzai/Yunzai'
let puppeteer = null
for (const base of [BOT, process.cwd()]) {
  try { puppeteer = createRequire(path.join(base, 'package.json'))('puppeteer'); if (puppeteer) break } catch { /* next */ }
}
if (!puppeteer) {
  console.error('找不到 puppeteer（本机 bot 里应该有）')
  process.exit(1)
}
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p))
const browser = await puppeteer.launch({
  headless: 'new',
  ...(EDGE ? { executablePath: EDGE } : {}),
  args: ['--disable-gpu', '--disable-setuid-sandbox', '--no-sandbox', '--no-zygote']
})

const W = 1920
const H = 1080
const CASES = [
  { name: 'left', pads: { left: 0.2 } },
  { name: 'right', pads: { right: 0.2 } },
  { name: 'bottom', pads: { bottom: 0.2 } },
  { name: 'all', pads: { left: 0.2, right: 0.2, top: 0.1, bottom: 0.1 } }
]

const parse = (style) => {
  const out = {}
  for (const part of String(style || '').split(';')) {
    const [k, v] = part.split(':')
    if (k && v) out[k.trim()] = v.trim()
  }
  return out
}
const num = v => (v ? parseFloat(String(v).replace('%', '')) : NaN)

let ok = true
for (const c of CASES) {
  const png = makePaddedPng(W, H, c.pads)
  fs.writeFileSync(path.join(tmpDir, `padded-${c.name}.png`), png)
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  const html = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;background:#222}.codex-portrait{position:relative;width:780px;aspect-ratio:${cardRatio};overflow:hidden;border-radius:20px}
.codex-portrait-img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}</style>
<div class="codex-portrait" style="aspect-ratio:${cardRatio}">
  <img class="codex-portrait-img" src="${dataUrl}" alt=""/>
</div>
${script}`
  const pageFile = path.join(tmpDir, `selftest-${c.name}.html`)
  fs.writeFileSync(pageFile, html, 'utf8')

  const page = await browser.newPage()
  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 })
  await page.goto(`file:///${pageFile.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' })
  const got = await page.evaluate(() => ({ style: document.querySelector('.codex-portrait-img')?.getAttribute('style') || '' }))
  await page.screenshot({ path: path.join(tmpDir, `selftest-${c.name}.png`), type: 'png' })
  await page.close()

  const crop = {
    left: c.pads.left || 0,
    right: c.pads.right || 0,
    top: c.pads.top || 0,
    bottom: c.pads.bottom || 0
  }
  const want = profile.planPortraitBox({ w: W, h: H, type: 'png' }, { w: Math.round(cardRatio * 1000), h: 1000, type: 'png' }, crop, 'cover')
  const style = parse(got.style)
  const pairs = [
    ['width', num(style.width), num(want.width)],
    ['height', num(style.height), num(want.height)],
    ['left', num(style.left), num(want.left)],
    ['top', num(style.top), num(want.top)]
  ]
  const lines = []
  for (const [name2, gotV, wantV] of pairs) {
    const pass = Number.isFinite(gotV) && Number.isFinite(wantV) && Math.abs(gotV - wantV) <= 0.01
    if (!pass) ok = false
    lines.push(`${pass ? '✓' : '✗'} ${name2}: 页面 ${Number.isFinite(gotV) ? gotV.toFixed(3) + '%' : '(空)'}　planPortraitBox ${Number.isFinite(wantV) ? wantV.toFixed(3) + '%' : '(空)'}`)
  }
  const cover = num(style.left) <= 0.001 && num(style.top) <= 0.001 &&
    num(style.left) + num(style.width) >= 99.999 && num(style.top) + num(style.height) >= 99.999
  if (!cover) ok = false
  lines.push(`${cover ? '✓' : '✗'} 裁后盖满取景窗（left≤0, top≤0, left+w≥100, top+h≥100）`)
  console.log(`【${c.name}】白边 ${JSON.stringify(c.pads)}`)
  for (const l of lines) console.log('  ' + l)
  console.log(`  页面 inline style：${got.style || '(空)'}`)
}
await browser.close()

/* ---------- 4. 扫描脚本同一处边界（防两侧漂移） ---------- */
const scannerSrc = fs.readFileSync(scannerFile, 'utf8')
const hasBound = scannerSrc.includes('count < maxSteps') && scannerSrc.includes('Math.floor(dim / 2)')
if (!hasBound) ok = false
console.log(`${hasBound ? '✓' : '✗'} 扫描脚本用同一套「按已扫行数」边界（count < maxSteps）`)

console.log(`\n立绘自量自裁自检：${ok ? '全部通过 ✅' : '有失败 ✗'}　产物目录：${path.relative(root, tmpDir)}`)
process.exit(ok ? 0 : 1)
