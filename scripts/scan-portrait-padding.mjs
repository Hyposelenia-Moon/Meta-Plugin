/**
 * 图库立绘「白边扫描」—— 生成运行时用的白边清单（维护期脚本，不入 55 套）
 *
 * 为什么需要它：攻略页把图库图 `object-fit: cover` 铺满卡片区，而图库里有一部分图**画布被挪过、
 * 左右留了纯白边**（实测胡桃 21 张里 10 张有 6%–25% 的白边），抽中就会出现一条白带。
 * 文件名里标了「偏移 / 右移」的只有 4 张，纯 JS 又解不了 WebP 像素 —— 于是把"量像素"放到这里。
 *
 * 做法：拿本机 Edge（+ bot 里的 puppeteer）把每张图以 `data:` URL 画到 canvas，
 * 按列统计「几乎整列都是纯白」的宽度占比，超过阈值就记进清单。
 *
 * 产物：`out/portrait-padding.json`（`out/` 未跟踪，不进仓库）
 *   { "scannedAt": "...", "threshold": 0.05, "entries": { "<图片绝对路径>": { "left": 0.25, "right": 0, "top": 0, "bottom": 0 } } }
 *
 * 用法：
 *   node scripts/scan-portrait-padding.mjs                 # 扫描图库里所有角色的图
 *   node scripts/scan-portrait-padding.mjs 胡桃 钟离        # 只扫指定角色
 *   node scripts/scan-portrait-padding.mjs --threshold=8   # 阈值改成 8%（默认 5）
 *   node scripts/scan-portrait-padding.mjs --dry           # 只打印，不写文件
 *   node scripts/scan-portrait-padding.mjs --baseline      # 同时写**入库基线** data/_portrait-padding.json（键=文件名）
 *
 * 前置：本机装了 Edge（`--edge=<路径>` 可指定）或 puppeteer 自带 Chromium；
 *      图库源照旧读 miao 的 `profileImgSrc`（`META_MIAO_PLUGIN` / `META_MIAO_DIR` 可覆盖 miao 目录）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const pluginRoot = root
const outDir = path.join(root, 'out')
const LIST_FILE = path.join(outDir, 'portrait-padding.json')

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
]

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return dflt
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true
}
const THRESHOLD = Math.max(1, Number(flag('threshold', 5)) || 5) / 100
const DRY = argv.includes('--dry')
const EDGE = String(flag('edge', '')) || EDGE_CANDIDATES.find(p => fs.existsSync(p)) || ''
const only = argv.filter(a => !a.startsWith('--'))

/** 解析编译产物里的图库函数（与运行时同一份逻辑） */
const libModel = p => import(pathToFileURL(path.join(root, 'lib', 'model', p)).href)
const profile = await libModel('ProfileImgRes.js')

/** 找出所有有图库图的角色名：`<源>/normal-character/<角色>/` */
function characterNames () {
  const names = new Set()
  for (const src of profile.profileImgSources()) {
    const tier = path.join(src, 'normal-character')
    let dirs = []
    try { dirs = fs.readdirSync(tier, { withFileTypes: true }) } catch { continue }
    for (const d of dirs) if (d.isDirectory()) names.add(d.name)
  }
  return [...names]
}

const targets = only.length ? only : characterNames()
if (!targets.length) {
  console.error('图库里没有找到任何角色（检查 miao 的 profileImgSrc / META_MIAO_DIR）')
  process.exit(1)
}

/** 收集待扫图片 */
const files = []
for (const name of targets) {
  for (const f of profile.profileImgPool(name, false)) files.push(f)
}
if (!files.length) {
  console.error(`这些角色在图库里没有图片：${targets.join('、')}`)
  process.exit(1)
}
console.log(`待扫 ${files.length} 张（角色 ${targets.length} 个），白边阈值 ${Math.round(THRESHOLD * 100)}%`)

/* --------------------------------------------------------------- 浏览器 */
const require = createRequire(path.join(pluginRoot, 'package.json'))
let puppeteer = null
for (const base of [process.cwd(), 'D:/Program Files/Yunzai/Yunzai']) {
  try {
    puppeteer = createRequire(path.join(base, 'package.json'))('puppeteer')
    if (puppeteer) break
  } catch { /* 试下一个 */ }
}
if (!puppeteer) {
  try { puppeteer = require('puppeteer') } catch { puppeteer = null }
}
if (!puppeteer) {
  console.error('找不到 puppeteer（本机 bot 里应该有；或先 npm i -g puppeteer）')
  process.exit(1)
}

const browser = await puppeteer.launch({
  headless: 'new',
  ...(EDGE ? { executablePath: EDGE } : {}),
  args: ['--disable-gpu', '--no-sandbox', '--allow-file-access-from-files']
})

/** 在页面里量白边：返回左右两侧"几乎整列纯白"的宽度占比 */
const MEASURE = async (dataUrl) => {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, w, h).data
  const stepY = Math.max(1, Math.floor(h / 60))
  const isWhiteCol = (x) => {
    let white = 0
    let total = 0
    for (let y = 0; y < h; y += stepY) {
      const i = (y * w + x) * 4
      const a = data[i + 3]
      // 透明也算"空"（贴图透明区铺到底色的效果与白边一样刺眼）
      if (a < 8) { white++; total++; continue }
      if (data[i] > 248 && data[i + 1] > 248 && data[i + 2] > 248) white++
      total++
    }
    return total > 0 && white / total >= 0.95
  }
  let left = 0
  while (left < w / 2 && isWhiteCol(left)) left++
  let right = 0
  while (right < w / 2 && isWhiteCol(w - 1 - right)) right++
  const stepX = Math.max(1, Math.floor(w / 60))
  const isWhiteRow = (y) => {
    let white = 0
    let total = 0
    for (let x = 0; x < w; x += stepX) {
      const i = (y * w + x) * 4
      if (data[i + 3] < 8) { white++; total++; continue }
      if (data[i] > 248 && data[i + 1] > 248 && data[i + 2] > 248) white++
      total++
    }
    return total > 0 && white / total >= 0.95
  }
  let top = 0
  while (top < h / 2 && isWhiteRow(top)) top++
  let bottom = 0
  while (bottom < h / 2 && isWhiteRow(h - 1 - bottom)) bottom++
  return {
    w, h,
    left: left / w, right: right / w,
    top: top / h, bottom: bottom / h
  }
}

const entries = {}
let bad = 0
try {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>')
  let i = 0
  for (const file of files) {
    i++
    try {
      const buf = fs.readFileSync(file)
      const ext = path.extname(file).toLowerCase().replace('.', '')
      const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/webp'
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      const box = await page.evaluate(MEASURE, dataUrl)
      const frac = Math.max(box.left, box.right, box.top, box.bottom)
      const hit = frac >= THRESHOLD
      if (hit) bad++
      const rel = path.relative(pluginRoot, file)
      console.log(`${hit ? '●白边' : '○干净'} ${String(Math.round(frac * 100)).padStart(3)}%  ${box.w}×${box.h}  ${rel}`)
      if (hit) entries[path.resolve(file)] = { left: Number(box.left.toFixed(3)), right: Number(box.right.toFixed(3)), top: Number(box.top.toFixed(3)), bottom: Number(box.bottom.toFixed(3)) }
    } catch (err) {
      console.log(`？读取失败 ${path.basename(file)}：${(err && err.message) || err}`)
    }
  }
} finally {
  await browser.close()
}

const payload = {
  scannedAt: new Date().toISOString(),
  threshold: Number(THRESHOLD.toFixed(3)),
  note: '由 scripts/scan-portrait-padding.mjs 生成；运行期据此裁掉立绘白边（out/ 未跟踪；--baseline 写入库基线）',
  entries
}
const BASELINE = Boolean(flag('baseline', false))
/** 基线：键换成**文件名**（图库是公共仓库，同一张图各机器文件名相同）→ 入库 `data/_portrait-padding.json` */
const baselineEntries = {}
for (const [abs, crop] of Object.entries(entries)) baselineEntries[path.basename(abs)] = crop
const baselinePayload = {
  note: '图库立绘白边基线：键=图片文件名，值=四边白边占比（node scripts/scan-portrait-padding.mjs --baseline 生成；本机 out/portrait-padding.json 可覆盖）',
  threshold: Number(THRESHOLD.toFixed(3)),
  scannedAt: new Date().toISOString().slice(0, 10),
  entries: Object.fromEntries(Object.entries(baselineEntries).sort(([a], [b]) => a.localeCompare(b)))
}
if (DRY) {
  console.log(`\n[dry] 会写入 ${bad} 条：${JSON.stringify(Object.keys(entries), null, 2)}`)
} else {
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(LIST_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`\n写出 ${bad}/${files.length} 条 → ${path.relative(pluginRoot, LIST_FILE)}（本机缓存）`)
  if (BASELINE) {
    const baselineFile = path.join(pluginRoot, 'data', '_portrait-padding.json')
    fs.writeFileSync(baselineFile, `${JSON.stringify(baselinePayload, null, 1)}\n`, 'utf8')
    console.log(`写出基线 ${Object.keys(baselinePayload.entries).length} 条 → ${path.relative(pluginRoot, baselineFile)}（入库，键=文件名）`)
  }
}
