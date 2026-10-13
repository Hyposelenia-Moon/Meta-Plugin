/**
 * miao-plugin 资源访问（**必需依赖**，只读）
 *
 * miao 是资源数据源（立绘 / 命座图标 / 武器图标 / 圣遗物图标 / 别名），本模块负责：
 *   1. 解析 miao 资源根：默认 `<bot>/plugins/miao-plugin/resources`，可用 `META_MIAO_DIR` 覆盖（回归套件用）；
 *   2. **惰性索引**：首次查询时扫一遍目录，之后按名字 O(1) 取路径（285 把武器 / 69 套圣遗物 / 128 角色，扫一次很快）；
 *   3. 返回值统一是**相对 miao resources 的路径**（如 `meta-gs/character/胡桃/imgs/splash.webp`）——
 *      模板里配 `{{_miao_path}}` 使用，因此 HTML 不依赖本机绝对路径；
 *   4. **一切失败都降级**：目录不存在 / 名字不认识 → 返回 `null` 或空表，只 `logger.warn`，绝不抛错。
 *
 * 实测布局（2026-10-13，miao v2.3.3 fork）：
 *   立绘      `meta-gs/character/<角色>/imgs/{splash,splash2,card,face,face2,gacha,banner,side}.webp`
 *   命座图标  `meta-gs/character/<角色>/icons/cons-<1..6>.webp`（另有 `passive-<0..2>.webp`）
 *   武器图标  `meta-gs/weapon/<类型：bow|claymore|catalyst|polearm|sword>/<武器名>/icon.webp`
 *   圣遗物    `meta-gs/artifact/imgs/<套装名>/<1..5>.webp`
 *   别名      `meta-gs/character/alias.js`（`export const alias`）、
 *             `meta-gs/weapon/alias.js`（`export const abbr`）、
 *             `meta-gs/artifact/alias.js`（`export const setAbbr`）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { botRoot } from '../dir.js'

/** miao 资源的默认根：`<bot>/plugins/miao-plugin/resources` */
export function defaultMiaoRoot (): string {
  return process.env.META_MIAO_DIR
    ? path.resolve(process.env.META_MIAO_DIR, 'resources')
    : path.join(botRoot, 'plugins', 'miao-plugin', 'resources')
}

export type MiaoKind = 'character' | 'weapon' | 'artifact'

/** 角色可选图（相对 `imgs/`） */
export type CharacterImage = 'splash' | 'splash2' | 'card' | 'face' | 'face2' | 'gacha' | 'banner' | 'side'

export interface MiaoStatus {
  /** 资源根（绝对路径） */
  root: string
  /** 关键子目录是否齐备 */
  ok: boolean
  /** 缺失的子目录（相对根） */
  missing: string[]
}

export class MiaoRes {
  readonly root: string

  /** 惰性索引：名字 → 相对 miao resources 的路径 */
  private index: Record<MiaoKind, Map<string, string>> = {
    character: new Map(),
    weapon: new Map(),
    artifact: new Map()
  }

  /** 别名表缓存（键为 kind） */
  private aliasCache = new Map<MiaoKind, Record<string, string>>()

  constructor (root: string = defaultMiaoRoot()) {
    this.root = root
  }

  /** 相对路径是否存在（绝对路径拼接） */
  private has (rel: string): boolean {
    try {
      return fs.existsSync(path.join(this.root, rel))
    } catch {
      return false
    }
  }

  /** 列出目录（失败返回空数组） */
  private list (rel: string): fs.Dirent[] {
    try {
      return fs.readdirSync(path.join(this.root, rel), { withFileTypes: true })
    } catch {
      return []
    }
  }

  /** 建立某类的名字索引（只建一次） */
  private ensureIndex (kind: MiaoKind): Map<string, string> {
    const cached = this.index[kind]
    if (cached.size) return cached

    if (kind === 'character') {
      for (const dir of this.list('meta-gs/character')) {
        if (!dir.isDirectory()) continue
        if (this.has(`meta-gs/character/${dir.name}/imgs/splash.webp`)) {
          cached.set(dir.name, `meta-gs/character/${dir.name}/imgs/splash.webp`)
        }
      }
      return cached
    }

    if (kind === 'weapon') {
      for (const typeDir of this.list('meta-gs/weapon')) {
        if (!typeDir.isDirectory()) continue
        for (const weaponDir of this.list(`meta-gs/weapon/${typeDir.name}`)) {
          if (!weaponDir.isDirectory()) continue
          const rel = `meta-gs/weapon/${typeDir.name}/${weaponDir.name}/icon.webp`
          if (this.has(rel)) cached.set(weaponDir.name, rel)
        }
      }
      return cached
    }

    for (const setDir of this.list('meta-gs/artifact/imgs')) {
      if (!setDir.isDirectory()) continue
      const rel = `meta-gs/artifact/imgs/${setDir.name}/4.webp`
      if (this.has(rel)) cached.set(setDir.name, rel)
      else if (this.has(`meta-gs/artifact/imgs/${setDir.name}/1.webp`)) {
        cached.set(setDir.name, `meta-gs/artifact/imgs/${setDir.name}/1.webp`)
      }
    }
    return cached
  }

  /** 清空索引与别名缓存（状态页「重新探测」用） */
  invalidate (): void {
    this.index = { character: new Map(), weapon: new Map(), artifact: new Map() }
    this.aliasCache.clear()
  }

  // ---------------- 图标 ----------------

  /** 角色立绘（默认 `splash`）；找不到该图时回落到 `splash` */
  characterImage (name: string, image: CharacterImage = 'splash'): string | null {
    const key = String(name ?? '').trim()
    if (!key) return null
    const rel = `meta-gs/character/${key}/imgs/${image}.webp`
    if (this.has(rel)) return rel
    const fallback = `meta-gs/character/${key}/imgs/splash.webp`
    return this.has(fallback) ? fallback : null
  }

  /** 命座图标（1..6） */
  consIcon (name: string, index: number): string | null {
    const key = String(name ?? '').trim()
    const n = Number(index)
    if (!key || !Number.isInteger(n) || n < 1 || n > 6) return null
    const rel = `meta-gs/character/${key}/icons/cons-${n}.webp`
    return this.has(rel) ? rel : null
  }

  /** 角色天赋被动图标（0..2） */
  passiveIcon (name: string, index: number): string | null {
    const key = String(name ?? '').trim()
    const n = Number(index)
    if (!key || !Number.isInteger(n) || n < 0 || n > 6) return null
    const rel = `meta-gs/character/${key}/icons/passive-${n}.webp`
    return this.has(rel) ? rel : null
  }

  /** 武器图标（名字 → 类型目录由索引负责） */
  weaponIcon (name: string): string | null {
    const key = String(name ?? '').trim()
    if (!key) return null
    return this.ensureIndex('weapon').get(key) ?? null
  }

  /** 圣遗物套装图（`piece` 1..5，默认 4 = 常见的"套装代表图"） */
  artifactIcon (setName: string, piece = 4): string | null {
    const key = String(setName ?? '').trim()
    if (!key) return null
    const n = Math.min(5, Math.max(1, Number(piece) || 4))
    const rel = `meta-gs/artifact/imgs/${key}/${n}.webp`
    if (this.has(rel)) return rel
    return this.ensureIndex('artifact').get(key) ?? null
  }

  // ---------------- 别名 ----------------

  /** 别名表（名称 → 逗号分隔的别名串；取不到返回空表） */
  aliases (kind: MiaoKind): Record<string, string> {
    const cached = this.aliasCache.get(kind)
    if (cached) return cached

    const file = path.join(this.root, `meta-gs/${kind}/alias.js`)
    let table: Record<string, string> = {}
    try {
      // 同步读 + 解析 `export const xxx = { ... }`：miao 的 alias.js 是纯数据对象，
      // 但**不 import**（避免把插件代码拉进运行时）；这里只做宽松的键值提取。
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
      table = parseAliasModule(text)
    } catch (err) {
      logger?.warn?.(`[Meta] 读取 miao 别名表失败（${kind}）：${(err as Error)?.message || err}`)
    }
    this.aliasCache.set(kind, table)
    return table
  }

  /**
   * 关键词 → 标准名（别名 → 标准名；标准名本身也认）
   *
   * 别名串是逗号分隔（中英文逗号都支持）。命中多个标准名时返回 `null`（歧义），由调用方提示。
   */
  resolveName (kind: MiaoKind, keyword: string): string | null {
    const key = String(keyword ?? '').trim()
    if (!key) return null
    const table = this.aliases(kind)

    if (Object.prototype.hasOwnProperty.call(table, key)) return key

    const hits: string[] = []
    for (const [name, aliasText] of Object.entries(table)) {
      const aliases = String(aliasText ?? '').split(/[,，、]/).map(s => s.trim()).filter(Boolean)
      if (aliases.includes(key)) hits.push(name)
    }
    return hits.length === 1 ? hits[0] : null
  }

  // ---------------- 状态 ----------------

  /** 资源探测（状态页用：缺什么一目了然） */
  status (): MiaoStatus {
    const need = ['meta-gs/character', 'meta-gs/weapon', 'meta-gs/artifact/imgs', 'common/item']
    const missing = need.filter(rel => !this.has(rel))
    return { root: this.root, ok: missing.length === 0, missing }
  }

  /** 索引规模（状态页显示"可解析的立绘 / 武器 / 套装数量"） */
  counts (): Record<MiaoKind, number> {
    return {
      character: this.ensureIndex('character').size,
      weapon: this.ensureIndex('weapon').size,
      artifact: this.ensureIndex('artifact').size
    }
  }

  /** 供外部（如 miao 可用性提示）判断整块资源是否就位 */
  get available (): boolean {
    return this.has('meta-gs/character') && this.has('meta-gs/weapon')
  }
}

/**
 * 从 miao 的 `alias.js` 文本里提取键值表
 *
 * miao 的三个别名文件都是 `export const <名> = { 键: '值', ... }` 的纯数据对象；
 * 这里用宽松解析（不 eval、不 import）取「单引号/双引号/裸键 → 引号字符串值」的配对。
 * 解析不到就返回空表（别名只影响名称匹配的友好度，不影响出图）。
 */
export function parseAliasModule (text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const body = String(text ?? '')
  const re = /(?:^|[,{\n])\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5·]*))\s*:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)\s*(?=[,}\n])/g
  for (const m of body.matchAll(re)) {
    const name = m[1] ?? m[2] ?? m[3] ?? ''
    const value = m[4] ?? m[5] ?? m[6] ?? ''
    if (name) out[name] = value
  }
  return out
}

/** 插件运行期共用的实例 */
export const miaoRes = new MiaoRes()

/** 供模板/调用方把相对路径转成 `file://` 绝对地址（需要直接塞进 `<img src>` 时用） */
export function miaoFileUrl (rel: string): string | null {
  const text = String(rel ?? '').trim()
  if (!text) return null
  const abs = path.isAbsolute(text) ? text : path.join(miaoRes.root, text)
  return fs.existsSync(abs) ? pathToFileURL(abs).href : null
}
