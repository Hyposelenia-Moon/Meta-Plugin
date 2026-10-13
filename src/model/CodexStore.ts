/**
 * 攻略数据仓库（**只读**）
 *
 * 数据来源（全部在 `data/` 下，随插件分发）：
 *   `gi/_order.json`         角色展示顺序（131 条，含空档）
 *   `gi/<角色>.json`         单个角色攻略（`v2` 为结构化六模块；`sections` 是旧文本层，暂不使用）
 *   `gi/_signature.json`     专武表：`{ 角色: { 专武: '名' | ['名', …], 实际: … } }`
 *   `gi/_weapon-tags.json`   武器标签：`{ 活动: ['名', …] }`
 *   `_index.json`            权威清单与覆盖统计（`characters/weapons/artifacts` 均为名字数组）
 *
 * 约定：
 *   1. **只读**：本模块绝不写 `data/`（`data/` 是 tracked，写入会被 `#强制更新` 抹掉，见设计文档 §13.2 C7）；
 *   2. 数据根可注入（测试用临时目录），默认取 `dir.ts` 的 `dataDir`；
 *   3. 读取带缓存：以 `(mtimeMs, size)` 作签名，文件一变即失效；
 *   4. 空档角色（`meta` 全空，如 米提亚 / 瓦列里）：**不进列表**，但 `isFilled()` 为 false 供调用方回「攻略待补充」（§13.1 B12）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../dir.js'

/** `v2` 里某一档的行（武器 / 圣遗物 / 天赋 / 面板 / 命座 / 配队复用同一形状，按 `kind` 区分） */
export interface GuideRow {
  label?: string | null
  tier?: number
  sep?: string
  kind?: string
  items?: unknown[]
  sets?: unknown[]
  stats?: Record<string, unknown>
  order?: unknown[]
  teams?: unknown[]
  crowned?: unknown[]
  [key: string]: unknown
}

/** `v2` 结构化六模块 */
export interface GuideV2 {
  weapons?: GuideRow[]
  artifacts?: GuideRow[]
  talents?: GuideRow[]
  panels?: GuideRow[]
  constellations?: GuideRow[]
  teams?: GuideRow[]
  [key: string]: unknown
}

/** 单角色攻略文件 */
export interface Guide {
  schema?: number
  name?: string
  game?: string
  meta?: Record<string, unknown>
  v2?: GuideV2
  tags?: unknown
  sections?: unknown[]
  source?: unknown
  [key: string]: unknown
}

/** `data/_index.json` 的形态（只声明用到的字段） */
export interface CodexIndex {
  generatedAt?: string
  characters?: string[]
  weapons?: string[]
  artifacts?: string[]
  authoritative?: Record<string, unknown>
  localOnly?: Record<string, unknown>
}

/** 数据现状统计（状态页与套件用） */
export interface CodexStats {
  /** `_order.json` 里的全部角色数（含空档） */
  total: number
  /** 有攻略内容的角色数 */
  filled: number
  /** 空档角色名单 */
  empty: string[]
  /** `_index.json` 的生成时间（数据版本） */
  generatedAt: string | null
}

interface CacheEntry {
  sig: string
  guide: Guide | null
}

export class CodexStore {
  /** 数据根（`data/gi`） */
  private readonly root: string
  /** 角色顺序（惰性载入，文件变更后由 `invalidate()` 清掉） */
  private order: string[] | null = null
  private signatures: Record<string, unknown> | null = null
  private weaponTags: Record<string, unknown> | null = null
  private index: CodexIndex | null = null
  private readonly cache = new Map<string, CacheEntry>()

  constructor (root: string = path.join(dataDir, 'gi')) {
    this.root = root
  }

  /** 数据根（套件与状态页展示用） */
  get dataRoot (): string {
    return this.root
  }

  private fileOf (name: string): string {
    return path.join(this.root, `${name}.json`)
  }

  /** 文件签名：`mtime:size`；不存在返回 `missing` */
  private sigOf (file: string): string {
    try {
      const st = fs.statSync(file)
      return `${st.mtimeMs}:${st.size}`
    } catch {
      return 'missing'
    }
  }

  private readJson<T> (file: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as T
    } catch (err) {
      logger?.warn?.(`[Meta] 读取 ${path.basename(file)} 失败：${(err as Error)?.message || err}`)
      return fallback
    }
  }

  /** 清空所有缓存（更新数据后调用；`getGuide` 也会按签名自行失效） */
  invalidate (): void {
    this.order = null
    this.signatures = null
    this.weaponTags = null
    this.index = null
    this.cache.clear()
  }

  /** `_order.json` 的全部角色名（含空档），保持文件顺序 */
  listAll (): string[] {
    if (!this.order) {
      const raw = this.readJson<unknown>(path.join(this.root, '_order.json'), [])
      this.order = Array.isArray(raw) ? raw.map(n => String(n ?? '').trim()).filter(Boolean) : []
    }
    return this.order
  }

  /**
   * 有攻略内容的角色（不含空档），保持 `_order.json` 顺序
   * 列表类命令用这个（§13.1 B12）
   */
  listCharacters (): string[] {
    return this.listAll().filter(name => this.isFilled(name))
  }

  /** 单个角色攻略（带签名缓存）；不存在或解析失败返回 null */
  getGuide (name: string): Guide | null {
    const key = String(name ?? '').trim()
    if (!key) return null
    const file = this.fileOf(key)
    const sig = this.sigOf(file)
    const hit = this.cache.get(key)
    if (hit && hit.sig === sig) return hit.guide

    const guide = sig === 'missing' ? null : this.readJson<Guide | null>(file, null)
    this.cache.set(key, { sig, guide })
    return guide
  }

  /** 角色是否有攻略内容：`meta` 任一字段非空即视为有（与维护者流水线同一口径） */
  isFilled (nameOrGuide: string | Guide | null): boolean {
    const guide = typeof nameOrGuide === 'string' ? this.getGuide(nameOrGuide) : nameOrGuide
    if (!guide) return false
    const meta = guide.meta
    if (!meta || typeof meta !== 'object') return false
    return Object.values(meta).some(v => String(v ?? '').trim().length > 0)
  }

  /** 某角色的专武表（`{ 专武, 实际 }`）；无记录返回 null */
  getSignature (name: string): Record<string, unknown> | null {
    const key = String(name ?? '').trim()
    if (!key) return null
    const all = this.allSignatures()
    const hit = all[key]
    return (hit && typeof hit === 'object') ? hit as Record<string, unknown> : null
  }

  /** 全量专武表（`gi/_signature.json`） */
  allSignatures (): Record<string, unknown> {
    if (!this.signatures) {
      this.signatures = this.readJson<Record<string, unknown>>(path.join(this.root, '_signature.json'), {})
    }
    return this.signatures
  }

  /** 武器标签表（`gi/_weapon-tags.json`，如 `{ 活动: [...] }`） */
  getWeaponTags (): Record<string, unknown> {
    if (!this.weaponTags) {
      this.weaponTags = this.readJson<Record<string, unknown>>(path.join(this.root, '_weapon-tags.json'), {})
    }
    return this.weaponTags
  }

  /** 索引（`data/_index.json`，在数据根的上一级） */
  getIndex (): CodexIndex {
    if (!this.index) {
      this.index = this.readJson<CodexIndex>(path.join(this.root, '..', '_index.json'), {})
    }
    return this.index
  }

  /** 数据现状（状态页 / 套件） */
  stats (): CodexStats {
    const all = this.listAll()
    const empty = all.filter(name => !this.isFilled(name))
    return {
      total: all.length,
      filled: all.length - empty.length,
      empty,
      generatedAt: this.getIndex().generatedAt ?? null
    }
  }

  /**
   * 关键词 → 标准角色名（阶段 2 会接 miao 别名；这里只做精确 / 去空白 / 包含）
   *
   * 匹配顺序：精确 → 去掉空格后的精确 → 唯一包含命中 → null
   * 多个包含命中（歧义）同样返回 null，由调用方回「匹配到多个角色」
   */
  findCharacter (keyword: string): string | null {
    const raw = String(keyword ?? '').trim()
    if (!raw) return null
    const all = this.listAll()

    if (all.includes(raw)) return raw

    const squeeze = (s: string): string => s.replace(/\s+/g, '')
    const key = squeeze(raw)
    const exact = all.find(name => squeeze(name) === key)
    if (exact) return exact

    const hit = all.filter(name => squeeze(name).includes(key))
    return hit.length === 1 ? hit[0] : null
  }
}

/** 插件运行期共用的实例（数据根取 `data/gi`） */
export const codexStore = new CodexStore()
