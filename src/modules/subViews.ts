/**
 * 六模块视图模型
 *
 * 数据 → 视图的唯一入口：`CodexStore` 读出的原始 guide 交给维护者区的单一真相做归一
 * （`v2ToSections` + `normalizeGuideSections`），这里只负责组装页面需要的东西，
 * 并提供「分支取用」（`#攻略 <角色> 武器` 这类，命令侧在阶段 3 接）。
 *
 * 归一的语义（档位词 推荐/可选/过渡、`＞`、等价候选 `=`、2+2 简写、专武标红/绿、活动标签、
 * 空模块「暂无」）**全部由维护者区负责**，本模块不重复实现、也不改写结果。
 */
import type { Guide } from '../model/CodexStore.js'
import {
  EMPTY_TEXT,
  WEAPON_REFINE_HINT,
  normalizeGuideSections,
  v2ToSections,
  type DisplaySection
} from '../model/markup.js'

/** 六个模块的规范标题（= `guide-display.mjs` 的 `DISPLAY_SECTIONS` 标题，也就是分支命令用的词） */
export const SUB_VIEW_TITLES = ['武器', '圣遗物', '天赋', '面板', '命座', '配队'] as const

export type SubViewTitle = (typeof SUB_VIEW_TITLES)[number]

export interface CodexView {
  /** 角色标准名 */
  name: string
  /** 建议等级 / 定位 / 100级提升 …（原样透传，模板决定怎么展示） */
  meta: Record<string, unknown>
  /** 面向模板的 meta 行：**只保留有值的项**（空串不进模板，避免出现"定位："这种空行） */
  metaRows: Array<{ label: string, value: string }>
  /** 归一后的六个模块（顺序固定：武器 → 圣遗物 → 天赋 → 面板 → 命座 → 配队） */
  sections: DisplaySection[]
  /**
   * 是否有攻略内容 —— 判据与维护者流水线、`CodexStore.isFilled` 一致：**`meta` 任一字段非空**。
   * 空档角色（米提亚 / 瓦列里）为 false：不进列表，点名查询回「攻略待补充」（§13.1 B12）。
   */
  hasContent: boolean
  /** 模板用的小文案 */
  hints: {
    /** 空模块占位（`暂无`） */
    empty: string
    /** 武器精炼提示 */
    refine: string
  }
}

export interface BuildViewOptions {
  /** 本角色的专武表（`CodexStore.getSignature(name)`） */
  signature?: Record<string, unknown> | null
  /** 全局武器标签表（`CodexStore.getWeaponTags()`） */
  weaponTags?: Record<string, unknown> | null
}

/**
 * 组装角色攻略视图
 *
 * @param guide `CodexStore.getGuide(name)` 的原始数据
 * @param opts 专武表与武器标签表（不传也能出图，只是没有专武标色与活动标签）
 * @returns 无该角色数据时返回 null
 */
export function buildCodexView (guide: Guide | null, opts: BuildViewOptions = {}): CodexView | null {
  if (!guide) return null

  const meta = (guide.meta && typeof guide.meta === 'object')
    ? guide.meta as Record<string, unknown>
    : {}

  const metaRows = Object.entries(meta)
    .map(([label, value]) => ({ label, value: String(value ?? '').trim() }))
    .filter(row => row.value.length > 0)

  const sections = normalizeGuideSections(v2ToSections(guide.v2 ?? {}), {
    signature: opts.signature ?? null,
    weaponTags: opts.weaponTags ?? {}
  })

  return {
    name: String(guide.name ?? ''),
    meta,
    metaRows,
    sections,
    hasContent: metaRows.length > 0,
    hints: { empty: EMPTY_TEXT, refine: WEAPON_REFINE_HINT }
  }
}

/** 模板数据的可选页头/页脚字段 */
export interface PageOptions {
  /** 页脚版权行（`components/constants.ts` 的 COPYRIGHT） */
  copyright?: string
  /** 渲染缩放（`components/render.ts` 会塞进模板数据） */
  renderScale?: number
  /** 角色立绘（阶段 2 接 miao 资源后传入；缺省则模板不画立绘） */
  portrait?: string
  /** 页头副标题（默认「角色攻略」） */
  subTitle?: string
}

/** 模板数据（`resources/codex/codex.html` 的数据契约；字段名改动必须同步模板与套件） */
export interface CodexPageData extends CodexView {
  copyright: string
  renderScale: number
  portrait: string
  subTitle: string
}

/** 视图 → 模板数据（模板只读这里给出的字段） */
export function toPageData (view: CodexView, opts: PageOptions = {}): CodexPageData {
  return {
    ...view,
    copyright: opts.copyright ?? '',
    renderScale: opts.renderScale ?? 1,
    portrait: opts.portrait ?? '',
    subTitle: opts.subTitle ?? '角色攻略'
  }
}

/** 是否为合法的分支词（武器 / 圣遗物 / 天赋 / 面板 / 命座 / 配队） */
export function isSubViewTitle (key: string): key is SubViewTitle {
  return (SUB_VIEW_TITLES as readonly string[]).includes(String(key ?? '').trim())
}

/** 取某个模块；词非法或不存在返回 null */
export function pickSection (view: CodexView, key: string): DisplaySection | null {
  const title = String(key ?? '').trim()
  if (!isSubViewTitle(title)) return null
  return view.sections.find(section => section.title === title) ?? null
}

/** 收窄成单模块视图（`#攻略 <角色> 武器` 用）；词非法返回 null */
export function narrowToSubView (view: CodexView, key: string): CodexView | null {
  const section = pickSection(view, key)
  if (!section) return null
  return { ...view, sections: [section] }
}
