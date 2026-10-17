/**
 * ProfileImgRes — 角色面板图 / 立绘（**图库兼容，逻辑照抄 miao**）
 *
 * 对应 miao 的三处实现，本文件只做"读路径 + 选图"，**不 import 它的任何模块**（只读它的配置与目录）：
 *   - `models/character/CharImg.js:getProfileImgSrc()`  —— 图库源：`config/profile.js` →
 *     `config/system/profile_system.js` → `['profile']`，**第一个能解析出非空源列表的配置生效**；
 *   - `models/character/CharImg.js:getProfileImgPool / getProfileImgFiles / getProfileImgByIndex()` —— 候选池与按序号选图；
 *   - `models/avatar/ProfileAvatar.js:getCostumeSplash()` —— 取图顺序：**序号 → 彩蛋层 → 普通层（层内随机）→ miao 自带立绘**。
 *
 * 三条与 miao 一致的约定：
 *   1. 图库层目录 `{源}/{super-character|normal-character}/{角色}/`，第三方图库还可以平铺 `{源}/{角色}/`；
 *      角色名后既可以是目录，也可以是 `{角色}.webp|png|jpg|jpeg` 单文件；
 *   2. 文件名形如 `{角色}_{序号}_{原作者}_{来源}[_{备注}].{ext}`，`面板图N` 就是匹配这里的 `_{序号}_`；
 *   3. **只读、不复制**：图库可能在别的盘，模板按 miao 的做法直接引用（bot 内用 5 级相对前缀，bot 外走 `file://`）。
 *
 * 本插件**不写 miao 的配置**：要加图库由用户在 miao 侧配（`config/profile.js` 的 `profileImgSrc`），
 * 或经 ProfileImg-Plugin 登记（它会写入同一个 `profileImgSrc`）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { botRoot, outDir } from '../dir.js'

/** 页面引用 bot 内资源的相对前缀（与模板里 `{{_res_path}}` 同深：`<bot>/plugins/...`） */
const PAGE_PREFIX = '../../../../..'

/** miao 认的后缀（`CharImg.js:14-15`） */
const IMG_EXT = ['webp', 'png', 'jpg', 'jpeg']
const IMG_RE = /\.(png|webp|jpe?g)$/i

/**
 * miao 插件根（图库默认源与配置都在它下面）
 *
 * `META_MIAO_PLUGIN` / `META_MIAO_DIR` 优先 —— 这两个覆盖口是插件本来就有的
 * （`MiaoPanel` / `MiaoRes` 用它们兜开发工作区与回归套件），图库侧沿用同一口径：
 * 开发工作区不在 `<bot根>/plugins/Meta-Plugin` 下，`botRoot` 推不出真正的 bot 根。
 */
function miaoRoot (): string {
  const plugin = String(process.env.META_MIAO_PLUGIN || '').trim()
  if (plugin) return path.resolve(plugin)
  const dir = String(process.env.META_MIAO_DIR || '').trim()
  if (dir) return path.resolve(dir)
  return path.join(botRoot, 'plugins', 'miao-plugin')
}

/** miao 的 resources —— 相对图库源以它为基准（'profile' → `resources/profile`） */
function miaoResources (): string {
  return path.join(miaoRoot(), 'resources')
}

/** 从配置文件文本里提取 `profileImgSrc`（纯函数，便于离线单测） */
export function parseProfileImgSrc (text: unknown): string[] {
  const m = String(text || '').match(/profileImgSrc\s*=\s*\[([\s\S]*?)\]/)
  if (!m) return []
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]).filter(Boolean)
}

/** 读某个配置文件里的 `profileImgSrc`（文本提取；文件不在 / 格式变了 → 空数组） */
function readSrcFile (file: string): string[] {
  try {
    return fs.existsSync(file) ? parseProfileImgSrc(fs.readFileSync(file, 'utf8')) : []
  } catch {
    return []
  }
}

/**
 * 图库源列表（绝对路径）—— 照抄 miao `CharImg.getProfileImgSrc()`
 *
 * 顺序：`config/profile.js`（用户自己那份）→ `config/system/profile_system.js`（系统默认）→ `['profile']`；
 * **第一个解析出非空列表的生效**（不是把几份配置合并）。相对路径以 miao 的 `resources` 为基准，
 * 绝对路径原样使用（跨盘图库就靠这个）。
 */
export function profileImgSources (): string[] {
  const candidates: unknown[] = [
    readSrcFile(path.join(miaoRoot(), 'config', 'profile.js')),
    readSrcFile(path.join(miaoRoot(), 'config', 'system', 'profile_system.js')),
    ['profile']
  ]
  for (const raw of candidates) {
    const list = (Array.isArray(raw) ? raw : [raw])
      .map(s => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .map(s => (path.isAbsolute(s) ? s : path.join(miaoResources(), s)))
    if (list.length) return list
  }
  return [path.join(miaoResources(), 'profile')]
}

/**
 * 某个图库层目录下该角色的图 —— 照抄 miao `CharImg.getProfileImgFiles()`
 *
 * 先单文件（`{base}/{角色}.{webp,png,jpg,jpeg}`），再目录形式（`{base}/{角色}/` 下所有图片）。
 * 源不存在 / 无权限 / 读取失败一律跳过该源，不影响其它源（miao 同）。
 */
export function profileImgFiles (base: string, name: string): string[] {
  const out: string[] = []
  const charName = String(name || '').trim()
  if (!charName) return out
  for (const ext of IMG_EXT) {
    const file = path.join(base, `${charName}.${ext}`)
    try {
      if (fs.existsSync(file)) out.push(file)
    } catch { /* 跳过该扩展名 */ }
  }
  const dir = path.join(base, charName)
  try {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      for (const f of fs.readdirSync(dir)) if (IMG_RE.test(f)) out.push(path.join(dir, f))
    }
  } catch { /* 跳过该源 */ }
  return out
}

/**
 * 候选池 —— 照抄 miao `CharImg.getProfileImgPool()`
 *
 * 彩蛋层（`super-character`）**不含平铺层**；普通层 = `normal-character` + 平铺 `{源}/{角色}`。
 * 所有源的同一层**合并**（不是取第一个命中的源），与 miao 的"同层级合并后随机"一致。
 */
export function profileImgPool (name: string, isSuper = false, sources = profileImgSources()): string[] {
  const charName = String(name || '').trim()
  if (!charName) return []
  const tier = isSuper ? 'super-character' : 'normal-character'
  let files: string[] = []
  for (const src of sources) {
    files = files.concat(profileImgFiles(path.join(src, tier), charName))
    if (!isSuper) files = files.concat(profileImgFiles(src, charName))
  }
  return files
}

/**
 * 按序号选图 —— 照抄 miao `CharImg.getProfileImgByIndex()`
 *
 * 序号来自文件名 `{角色}_{序号}_...`（ProfileImg 的命名称谓）；彩蛋层优先于普通层；找不到返回空串。
 */
export function profileImgByIndex (name: string, isSuper: boolean, index: number, sources = profileImgSources()): string {
  const want = Number(index) || 0
  if (want <= 0) return ''
  const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const seqRe = new RegExp(`^${esc}_(\\d+)(?:_|\\.)`, 'i')
  for (const tier of (isSuper ? ['super', 'normal'] : ['normal'])) {
    for (const img of profileImgPool(name, tier === 'super', sources)) {
      const m = decodeURIComponent(path.basename(img)).match(seqRe)
      if (m && parseInt(m[1], 10) === want) return img
    }
  }
  return ''
}

/**
 * 选图 —— 照抄 miao `ProfileAvatar.getCostumeSplash()` 的取图段
 *
 * `面板图N` 给了序号就按序号选（选不到继续往下走，miao 也是这个行为）；
 * 否则按层取候选池并**层内随机**（`lodash.sample` 的等价物）；池空返回空串（交给 miao 自带立绘兜底）。
 */
export function pickProfileImg (name: string, opts: { isSuper?: boolean, index?: number, sources?: string[] } = {}): string {
  const isSuper = opts.isSuper === true
  const sources = opts.sources || profileImgSources()
  if ((Number(opts.index) || 0) > 0) {
    const hit = profileImgByIndex(name, isSuper, Number(opts.index), sources)
    if (hit) return hit
  }
  for (const tier of (isSuper ? ['super', 'normal'] : ['normal'])) {
    const pool = profileImgPool(name, tier === 'super', sources)
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)]
  }
  return ''
}

/**
 * miao 自带立绘兜底 —— 照抄 miao `getCostumeSplash()` 的 `defImgs`
 *
 * 彩蛋立绘先看 `splash0.webp`（miao 对 super 角色 `unshift` 的那张），再看 `splash.webp`。
 * 本插件不处理换装（`splash2.webp`），命中不到就返回空串（页面不画立绘）。
 */
export function miaoSplashFile (name: string, isSuper = false): string {
  const charName = String(name || '').trim()
  if (!charName) return ''
  const base = path.join(miaoResources(), 'meta-gs', 'character', charName, 'imgs')
  for (const f of (isSuper ? ['splash0.webp', 'splash.webp'] : ['splash.webp'])) {
    const abs = path.join(base, f)
    try {
      if (fs.existsSync(abs)) return abs
    } catch { /* 换下一张 */ }
  }
  return ''
}

/**
 * 绝对路径 → 页面可引用的地址 —— 照抄 miao `CharImg.getProfileImgRes()` 的做法
 *
 * bot 目录内返回 5 级相对前缀（`../../../../../plugins/...`，与页面里已有的 miao 资源引用同深）；
 * 跨盘 / 网络盘返回 `file://` 绝对地址（miao 同）。文件名按 miao 的做法做 URI 编码。
 */
export function pageImageUrl (file: string, root = botRoot): string {
  const abs = path.resolve(file)
  const dir = path.dirname(abs)
  const rel = path.relative(path.resolve(root), abs).replace(/\\/g, '/')
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return `${PAGE_PREFIX}/${path.dirname(rel).replace(/\\/g, '/')}/${encodeURIComponent(path.basename(abs))}`
  }
  return pathToFileURL(path.join(dir, path.basename(abs))).href
}

/**
 * 面板图（立绘）取图 —— miao 同款顺序
 *
 * `图库（面板图N / 层内随机）` → `miao 自带立绘（splash0 / splash）` → 空串（页面不画）。
 * 任何异常都只降级（返回空串 + 原因），绝不抛到消息层。
 */
export function heroImageOf (charName: string, opts: { isSuper?: boolean, index?: number } = {}): { rel: string, source: string, note: string } {
  const name = String(charName || '').trim()
  if (!name) return { rel: '', source: '', note: '未给出角色名' }
  try {
    const picked = pickProfileImg(name, opts)
    if (picked) return { rel: pageImageUrl(picked), source: '图库', note: '' }
    const splash = miaoSplashFile(name, opts.isSuper === true)
    if (splash) return { rel: pageImageUrl(splash), source: 'miao', note: '' }
  } catch (err) {
    return { rel: '', source: '', note: `立绘取图失败：${(err as Error)?.message || err}` }
  }
  return { rel: '', source: '', note: '图库与 miao 默认立绘都没有该角色的图' }
}

/* ------------------------------------------------------------------ 攻略页立绘 */

/** 图片像素尺寸（只读头部） */
export interface ImageSize {
  w: number
  h: number
  type: 'png' | 'jpeg' | 'webp'
}

/** 尺寸缓存：同一张图在一次进程里只读一次头（键含 mtime + 字节数，换图即失效） */
const sizeCache = new Map<string, { stamp: string, size: ImageSize | null }>()

/**
 * 读图片像素尺寸（PNG / WebP / JPEG 头部，零依赖）
 *
 * 只读前 32 字节即可覆盖 PNG 与三种 WebP 子格式；JPEG 需要扫段，才整读一次。
 * 读不出（文件坏了 / 未知格式）返回 `null` —— 调用方按"不合格"处理。
 */
export function imageSizeOf (file: string): ImageSize | null {
  const abs = path.resolve(String(file || ''))
  if (!abs) return null
  let fd = -1
  try {
    const st = fs.statSync(abs)
    if (!st.isFile()) return null
    const stamp = `${st.mtimeMs}:${st.size}`
    const hit = sizeCache.get(abs)
    if (hit && hit.stamp === stamp) return hit.size

    fd = fs.openSync(abs, 'r')
    const head = Buffer.alloc(32)
    const read = fs.readSync(fd, head, 0, 32, 0)
    let size: ImageSize | null = null
    if (read >= 24) {
      // PNG：签名 + IHDR（宽在 16、高在 20，大端）
      if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') {
        size = { w: head.readUInt32BE(16), h: head.readUInt32BE(20), type: 'png' }
      } else if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') {
        // WebP 三种子格式：VP8X（容器，画布尺寸 -1）/ VP8L（无损，14 位）/ 'VP8 '（有损，14 位）
        const kind = head.subarray(12, 16).toString('latin1')
        if (kind === 'VP8X' && read >= 30) {
          size = { w: 1 + head.readUIntLE(24, 3), h: 1 + head.readUIntLE(27, 3), type: 'webp' }
        } else if (kind === 'VP8L' && read >= 25) {
          const bits = head.readUInt32LE(21)
          size = { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1, type: 'webp' }
        } else if (kind === 'VP8 ' && read >= 30) {
          size = { w: head.readUInt16LE(26) & 0x3fff, h: head.readUInt16LE(28) & 0x3fff, type: 'webp' }
        }
      } else if (head[0] === 0xff && head[1] === 0xd8) {
        // JPEG：扫 SOF 段（0xC0–0xCF，排除 C4/C8/CC）
        const buf = fs.readFileSync(abs)
        let i = 2
        while (i + 9 < buf.length) {
          if (buf[i] !== 0xff) { i++; continue }
          const marker = buf[i + 1]
          if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
          const len = buf.readUInt16BE(i + 2)
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            size = { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), type: 'jpeg' }
            break
          }
          i += 2 + len
        }
      }
    }
    if (size && (!size.w || !size.h)) size = null
    sizeCache.set(abs, { stamp, size })
    return size
  } catch {
    return null
  } finally {
    if (fd >= 0) { try { fs.closeSync(fd) } catch { /* 已经关了 */ } }
  }
}

/**
 * 这张图能不能当攻略页立绘
 *
 * 唯一条件（用户 2026-10-17 定，**比例不卡**）：**不得比默认立绘小** —— 宽和高都要 ≥ 默认立绘。
 * 理由：页面用 `object-fit: cover` 把图裁进卡片区（宽度撑满、高度按默认立绘的比例定），
 * 所以任何比例的大图都能用；只有被放大发虚的小图不要。
 */
export function fitsPortrait (size: ImageSize | null, std: ImageSize | null): boolean {
  if (!size || !std || !size.w || !size.h || !std.w || !std.h) return false
  return size.w >= std.w && size.h >= std.h
}

/**
 * 文件名里这些词表示「画布被挪过 / 补过白边」
 *
 * 2026-10-17 实测：图库里 `…_偏移.webp`、`…_右移.webp`、`…_翻转偏移.webp` 这类图左右边缘是纯白，
 * 抽中就会出现一条白带（胡桃 21 张里 10 张命中）。纯 JS 零依赖解不了 WebP 像素，
 * 所以用**作者自己的标注**做启发式：命中即跳过。
 */
const PADDED_HINTS = ['偏移', '右移', '左移', '留白', '白边']

/** 离线白边清单文件名（落在 out/，未跟踪） */
const PADDING_LIST_NAME = 'portrait-padding.json'
/** 四边裁剪比例 */
export interface PortraitCrop {
  left: number
  right: number
  top: number
  bottom: number
}
/** 清单缓存：键含 mtime + 字节数，重扫后自动失效 */
let padListCache: { stamp: string, map: Map<string, PortraitCrop> } | null = null

/** 文件名看起来是"挪过画布 / 补过白边"的图（只用于提示"还没量过"，不再据此跳过） */
export function looksPadded (file: string): boolean {
  let base = ''
  try {
    base = decodeURIComponent(path.basename(String(file || '')))
  } catch {
    base = path.basename(String(file || ''))
  }
  if (!base) return false
  return PADDED_HINTS.some(hint => base.includes(hint))
}

/**
 * 离线白边清单（`scripts/scan-portrait-padding.mjs` 生成，落 `out/portrait-padding.json`）
 *
 * 为什么要有它：图库里有一部分图**画布被挪过、四周留了纯白**（实测胡桃 21 张里 10 张有 6%–25%），
 * 文件名里标注的只有 4 张；纯 JS 零依赖又解不了 WebP 像素，于是把"量像素"放到维护期，
 * 运行时只读这份清单里的**四边白边比例**，据此裁掉白边。`out/` 未跟踪，换图后重跑一次即可。
 */
export function paddingListPath (): string {
  return path.join(outDir, PADDING_LIST_NAME)
}

const ZERO_CROP: PortraitCrop = { left: 0, right: 0, top: 0, bottom: 0 }

/** 读清单里的四边比例（键为图片绝对路径；坏数据 / 缺字段都按 0 处理） */
export function readPaddingMap (file = paddingListPath()): Map<string, PortraitCrop> {
  try {
    const st = fs.statSync(file)
    const stamp = `${st.mtimeMs}:${st.size}`
    if (padListCache && padListCache.stamp === stamp) return padListCache.map
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: Record<string, unknown> } | Record<string, unknown>
    const entries = (raw && typeof raw === 'object' && 'entries' in raw && raw.entries && typeof raw.entries === 'object')
      ? raw.entries as Record<string, unknown>
      : raw as Record<string, unknown>
    const map = new Map<string, PortraitCrop>()
    const num = (v: unknown): number => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0 ? Math.min(0.45, n) : 0
    }
    for (const key of Object.keys(entries)) {
      if (key === 'scannedAt' || key === 'threshold' || key === 'note') continue
      const e = entries[key] as Partial<PortraitCrop> | undefined
      if (!e || typeof e !== 'object') continue
      map.set(path.resolve(key).toLowerCase(), { left: num(e.left), right: num(e.right), top: num(e.top), bottom: num(e.bottom) })
    }
    padListCache = { stamp, map }
    return map
  } catch {
    padListCache = null
    return new Map()
  }
}

/**
 * 某张图要裁掉多少白边（清单没有就是 0 —— 照常整张用，模糊层兜住边缘）
 *
 * @param file 图片绝对路径
 * @param listFile 清单路径（套件注入用；默认 `out/portrait-padding.json`）
 */
export function portraitCropOf (file: string, listFile?: string): PortraitCrop {
  const abs = path.resolve(String(file || ''))
  if (!abs) return { ...ZERO_CROP }
  const map = readPaddingMap(listFile)
  return map.get(abs.toLowerCase()) ?? { ...ZERO_CROP }
}

/**
 * 「主体层」在卡片里的定位（百分比字符串，直接写进 inline style）
 *
 * 目标：把**裁掉白边后的那块**按 contain 放进卡片（整块可见、不裁人），把卡片铺满的活交给模糊层。
 * 单位换算：以卡片宽 = 1、卡片高 = 1/`ratio` 为坐标系，最后换算回百分比。
 */
export function planPortraitBox (size: ImageSize | null, std: ImageSize | null, crop: PortraitCrop): {
  width: string
  height: string
  left: string
  top: string
} {
  const empty = { width: '', height: '', left: '', top: '' }
  if (!size || !std || !size.w || !size.h || !std.w || !std.h) return empty
  const cardRatio = std.w / std.h
  if (!cardRatio) return empty
  const iw = size.w / size.h // 图片宽高比（把高度归一成 1）
  const clamp = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(0.45, v)) : 0)
  const l = clamp(crop.left)
  const r = clamp(crop.right)
  const t = clamp(crop.top)
  const b = clamp(crop.bottom)
  const cw = iw * (1 - l - r) // 裁剪后的宽（高仍是 1）
  const ch = 1 - t - b        // 裁剪后的高
  if (cw <= 0.01 || ch <= 0.01) return empty

  const W = 1
  const H = 1 / cardRatio
  const s = Math.min(W / cw, H / ch) // contain：裁后的整块放进卡片
  const dw = iw * s
  const dh = s * 1
  // 裁掉的白边仍然占位，只是被推到卡片外面；再让"裁后区域"在卡片里居中
  const left = -(l * iw * s) - (cw * s - W) / 2
  const top = -(t * s) - (ch * s - H) / 2
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`
  return { width: pct(dw), height: pct(dh * cardRatio), left: pct(left), top: pct(top * cardRatio) }
}

/** 攻略页立绘取图结果 */
export interface PagePortrait {
  /** 页面可直接引用的地址（bot 内相对前缀 / bot 外 file://） */
  src: string
  source: '图库' | 'miao' | ''
  /** 降级原因（正常取到图时为空串） */
  note: string
  /** 选中的图尺寸（读不出为 null） */
  size: ImageSize | null
  /** 该角色默认立绘尺寸 —— "不得更小"的基准，也是卡片区高度的来源 */
  std: ImageSize | null
  /**
   * 卡片区宽高比（= 默认立绘 `w/h`，保留 4 位小数；读不出来为空串）
   *
   * 页面把它写进 `aspect-ratio` 给立绘区定高 —— 版面高度与用 miao 立绘时完全一致。
   */
  ratio: string
  /** 这张图要裁掉多少白边（清单没量过就是全 0） */
  crop: PortraitCrop
  /**
   * 主体层在卡片里的定位（百分比），配 `planPortraitBox()`；读不出尺寸时全空串
   *
   * 页面结构 = **模糊层铺满卡片**（同图 `cover` + blur）+ **主体层**按这个盒摆好（裁掉白边后 contain）。
   */
  box: { width: string, height: string, left: string, top: string }
}

/**
 * 攻略页立绘：**图库优先，但要比默认立绘大**，不合格就退回 miao 默认立绘
 *
 * 与 `heroImageOf()`（练度页用）的区别：练度页按 miao 的顺序取图、不筛；攻略页要保证
 * 铺满卡片区时不被放大发虚，所以只接受宽高都不小于默认立绘的图，**比例不限**（页面 cover 裁）。
 *
 * 池里多张合格图时**随机取一张**（与 miao 的 `lodash.sample` 同口径）；`opts.random` 可注入，
 * 便于套件固定结果。
 *
 * @param name 角色名
 * @param opts.isSuper 是否走彩蛋层（`super-character`）；攻略页与账号无关，默认 false
 * @param opts.sources 图库源（套件注入；默认读 miao 配置）
 * @param opts.stdFile 默认立绘文件（套件注入；默认 `miaoSplashFile()`）
 * @param opts.random 随机源（套件注入）
 */
export function pickPagePortrait (name: string, opts: {
  isSuper?: boolean
  sources?: string[]
  stdFile?: string
  /** 白边清单路径（套件注入；默认 out/portrait-padding.json） */
  paddingList?: string
  random?: () => number
} = {}): PagePortrait {
  const charName = String(name || '').trim()
  const none: PagePortrait = { src: '', source: '', note: '', size: null, std: null, ratio: '', crop: { ...ZERO_CROP }, box: { width: '', height: '', left: '', top: '' } }
  if (!charName) return { ...none, note: '未给出角色名' }
  try {
    const stdFile = opts.stdFile !== undefined
      ? String(opts.stdFile || '')
      : miaoSplashFile(charName, opts.isSuper === true)
    const std = stdFile ? imageSizeOf(stdFile) : null
    const pool = profileImgPool(charName, opts.isSuper === true, opts.sources)
    const ratio = std && std.w && std.h ? (std.w / std.h).toFixed(4) : ''

    const fit: Array<{ file: string, size: ImageSize }> = []
    for (const file of pool) {
      // 只保留"不比默认立绘小"的图：太小的放大后发虚，模糊层也救不回来
      const size = imageSizeOf(file)
      if (fitsPortrait(size, std)) fit.push({ file, size: size as ImageSize })
    }

    if (fit.length > 0) {
      const rand = typeof opts.random === 'function' ? Number(opts.random()) : Math.random()
      const idx = Math.min(fit.length - 1, Math.max(0, Math.floor((Number.isFinite(rand) ? rand : 0.5) * fit.length)))
      const picked = fit[idx]
      // 白边不再"跳过"，改成**裁掉 + 模糊铺满**：清单里有四边比例就照它裁
      const crop = portraitCropOf(picked.file, opts.paddingList)
      return {
        src: pageImageUrl(picked.file),
        source: '图库',
        note: '',
        size: picked.size,
        std,
        ratio,
        crop,
        box: planPortraitBox(picked.size, std, crop)
      }
    }

    if (stdFile) {
      const note = pool.length > 0
        ? (std
            ? `图库 ${pool.length} 张都比默认立绘小（${std.w}×${std.h} 起），已用默认立绘`
            : `图库 ${pool.length} 张无法比较（默认立绘尺寸读不出），已用默认立绘`)
        : ''
      const crop = { ...ZERO_CROP }
      return { src: pageImageUrl(stdFile), source: 'miao', note, size: std, std, ratio, crop, box: planPortraitBox(std, std, crop) }
    }

    return {
      ...none,
      std,
      ratio,
      note: pool.length > 0
        ? '图库有图，但既没有默认立绘可作基准、也读不到尺寸，无法筛选'
        : '图库与默认立绘都没有该角色的图'
    }
  } catch (err) {
    return { ...none, note: `立绘取图失败：${(err as Error)?.message || err}` }
  }
}
