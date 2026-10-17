/**
 * 图库立绘「留白扫描」—— 生成运行时用的留白清单（维护期脚本，不入 55 套）
 *
 * 为什么需要它：攻略页把图库图 `object-fit: cover` 铺满卡片区，而图库里有一部分图**画布被挪过、
 * 四周留了一条纯色带**（常见是纯白；AI 扩图会留带底色/近白的窄边），抽中就会出现一条带子。
 * 文件名里标了「偏移 / 右移」的只是少数，纯 JS 又解不了 WebP 像素 —— 于是把"量像素"放到这里。
 *
 * 判据（2026-10-17 定稿，比早期"只认纯白"更宽）：
 *   ① 一条线（整列/整行）里 ≥98% 的采样点与该线均值偏差 ≤6 → 视为**纯色线**；
 *   ② 从边向内连续同色（相邻线均值差 ≤6）形成 ≥3% 的带 → 视为留白；
 *   ③ 护栏：**纯白**（三通道 ≥240）宽度不限；**非白**留白只允许 ≤12%
 *      —— 否则黑底画作（如「黑底月亮」彩蛋图）的整块底色会被误当留白裁掉。
 *
 * 做法：拿本机 Edge（+ bot 里的 puppeteer）把每张图以 `data:` URL 画到 canvas，逐线量出来。
 *
 * 产物：`out/portrait-padding.json`（`out/` 未跟踪，不进仓库）
 *   { "scannedAt": "...", "threshold": 0.03, "entries": { "<图片绝对路径>": { "left": 0.25, "right": 0, "top": 0, "bottom": 0 } } }
 *
 * 用法：
 *   node scripts/scan-portrait-padding.mjs                 # 扫描图库里所有角色的图
 *   node scripts/scan-portrait-padding.mjs 胡桃 钟离        # 只扫指定角色
 *   node scripts/scan-portrait-padding.mjs --threshold=5   # 最小留白宽度改成 5%（默认 3）
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
const THRESHOLD = Math.max(1, Number(flag('threshold', 3)) || 3) / 100
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

/** 在页面里量留白：返回四边「纯色带」的宽度占比（判据见文件头） */
const MEASURE = async ({ url, cfg }) => {
  const img = new Image()
  img.src = url
  await img.decode()
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, w, h).data
  const TOL = cfg.tol
  const COVER = cfg.cover
  const WHITE = cfg.whiteLevel
  const CAP = cfg.colorCap

  /** 取一条线（col:x 或 row:y）：均值、是否纯色、是否「近乎全白」 */
  const lineOf = (kind, idx) => {
    const n = kind === 'col' ? h : w
    const step = Math.max(1, Math.floor(n / 60))
    let r = 0; let g = 0; let b = 0; let total = 0
    const pts = []
    for (let t = 0; t < n; t += step) {
      const i = (kind === 'col' ? t * w + idx : idx * w + t) * 4
      // 透明按纯白算（贴图透明区铺到底色的观感与白边一样）
      const px = data[i + 3] < 8 ? [255, 255, 255] : [data[i], data[i + 1], data[i + 2]]
      pts.push(px)
      r += px[0]; g += px[1]; b += px[2]; total++
    }
    if (!total) return { mean: [0, 0, 0], flat: false, white: false }
    const mean = [r / total, g / total, b / total]
    let near = 0
    let white = 0
    for (const px of pts) {
      if (Math.abs(px[0] - mean[0]) <= TOL && Math.abs(px[1] - mean[1]) <= TOL && Math.abs(px[2] - mean[2]) <= TOL) near++
      if (px[0] > 248 && px[1] > 248 && px[2] > 248) white++
    }
    // 两种都算「留白线」：纯色线（新口径，能抓 AI 扩图的带色边）或近乎全白（旧口径，能抓渐变的白色边）
    const whiteLine = white / total >= 0.95
    return { mean, flat: near / total >= COVER || whiteLine, white: whiteLine }
  }

  const isWhite = mean => Math.min(mean[0], mean[1], mean[2]) >= WHITE
  const near = (a, b) => Math.abs(a[0] - b[0]) <= TOL && Math.abs(a[1] - b[1]) <= TOL && Math.abs(a[2] - b[2]) <= TOL

  /** 从边向内走，返回留白占该边的比例（不合格返回 0） */
  const walk = (kind, idx, step, limit, dim) => {
    let prev = null
    let count = 0
    let whiteEdge = false
    // 2026-10-17 复审修复：用「已扫几行」控制循环；右/下边 step=-1，旧条件 `idx < 半边` 首轮即 false
    const maxSteps = Math.floor(dim / 2)
    while (idx >= 0 && idx < dim && count < maxSteps) {
      const { mean, flat, white } = lineOf(kind, idx)
      if (!flat) break
      // 白边的宽度可以渐变（旧口径的图就是这样），只有纯色带才要求前后同色
      if (!white && prev && !near(mean, prev)) break
      prev = mean
      whiteEdge = white
      count++
      idx += step
    }
    if (!count) return 0
    const frac = count / dim
    if (frac < cfg.minWidth) return 0
    return whiteEdge || isWhite(prev) || frac <= CAP ? frac : 0
  }

  return {
    w,
    h,
    left: walk('col', 0, 1, Math.floor(w / 2), w),
    right: walk('col', w - 1, -1, Math.floor(w / 2), w),
    top: walk('row', 0, 1, Math.floor(h / 2), h),
    bottom: walk('row', h - 1, -1, Math.floor(h / 2), h)
  }
}

/** 判据参数（与文件头一致；--threshold 只调最小宽度） */
const CFG = { tol: 6, cover: 0.98, minWidth: THRESHOLD, whiteLevel: 240, colorCap: 0.12 }
console.log(`判据：纯色 TOL ${CFG.tol}｜覆盖 ${CFG.cover * 100}%｜最小宽度 ${(CFG.minWidth * 100).toFixed(0)}%｜纯白不限宽、非白 ≤${CFG.colorCap * 100}%`)

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
      const box = await page.evaluate(MEASURE, { url: dataUrl, cfg: CFG })
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
  note: '由 scripts/scan-portrait-padding.mjs 生成；运行期据此裁掉立绘留白（out/ 未跟踪；--baseline 写入库基线）',
  entries
}
const BASELINE = Boolean(flag('baseline', false))
/**
 * 基线：键换成**文件名**（图库是公共仓库，同一张图各机器文件名相同）→ 入库 `data/_portrait-padding.json`
 *
 * 与已有基线**合并取大**（每边 max）：重扫不会让已有条目消失或变小。
 * 原因：判定口径会演进（早期只认纯白 90% 覆盖，现在纯色 98% + 纯白 95%），
 * 反复重扫若直接覆盖，会把上一版量到、这一版没量到的白边丢掉 → 白条复发。
 */
const baselineFile = path.join(pluginRoot, 'data', '_portrait-padding.json')
const baselineEntries = {}
try {
  const prev = JSON.parse(fs.readFileSync(baselineFile, 'utf8'))
  for (const [name, crop] of Object.entries(prev.entries || {})) {
    baselineEntries[name] = { left: Number(crop.left) || 0, right: Number(crop.right) || 0, top: Number(crop.top) || 0, bottom: Number(crop.bottom) || 0 }
  }
} catch { /* 首次生成 */ }
let merged = 0
for (const [abs, crop] of Object.entries(entries)) {
  const name = path.basename(abs)
  const old = baselineEntries[name]
  const next = {
    left: Math.max(Number(old?.left) || 0, crop.left),
    right: Math.max(Number(old?.right) || 0, crop.right),
    top: Math.max(Number(old?.top) || 0, crop.top),
    bottom: Math.max(Number(old?.bottom) || 0, crop.bottom)
  }
  if (!old) merged++
  baselineEntries[name] = next
}
const baselinePayload = {
  note: '图库立绘留白基线：键=图片文件名，值=四边留白占比（node scripts/scan-portrait-padding.mjs --baseline 生成，与旧基线按边取大合并；本机 out/portrait-padding.json 可覆盖）',
  merged: merged,
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
    fs.writeFileSync(baselineFile, `${JSON.stringify(baselinePayload, null, 1)}\n`, 'utf8')
    console.log(`写出基线 ${Object.keys(baselinePayload.entries).length} 条 → ${path.relative(pluginRoot, baselineFile)}（入库，键=文件名）`)
  }
}
