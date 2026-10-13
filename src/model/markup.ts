/**
 * 维护者区显示层的**类型化窄接口**（不复制实现）
 *
 * 维护者区（`scripts/lib/`）是 ESM JS，不参与 tsc 编译，也没有 `.d.ts`。插件这里做两件事：
 *   1. 用 `@ts-expect-error` 抑制"JS 模块无类型声明"的报错；
 *   2. 把**用到的少数几个函数**断言成窄类型导出，其余一概不透出（避免插件到处引用维护者区内部）。
 *
 * **不复制实现**是这里的关键：`v2 → sections` 与文本归一都直接调用维护者区的单一真相
 * （`scripts/lib/guide-model.mjs` 与 `guide-display.mjs`），因此插件成图与网页版 / Word 文档
 * 的输出天然同源；`scripts/check-display-sync.mjs` 那类"跨仓库镜像"不再需要。
 *
 * 路径说明：`../../scripts/lib/…` 从 `src/model/`（源码）与 `lib/model/`（产物）解析结果**一致**
 * —— 两者都在插件根下一层，所以这里的相对路径编译后依旧成立。
 */
import type { Guide } from './CodexStore.js'

/** 归一前 / 归一后的条目（维护者区用普通对象，这里只声明插件会读的字段） */
export interface DisplayItem {
  text?: string
  note?: string
  ref?: string
  sepAfter?: string
  level?: number | string
  crown?: boolean
  /** 严格专武（`_signature.json` 的「专武」）→ 模板标红 */
  sig?: boolean
  /** 实际专属（同上的「实际」）→ 模板标绿 */
  sigAlt?: boolean
  [key: string]: unknown
}

/** 归一后的一行 */
export interface DisplayRow {
  label?: string
  labelClass?: string
  tier?: number
  items?: DisplayItem[]
  empty?: boolean
  [key: string]: unknown
}

/** 归一后的一个配队条目 */
export interface DisplayTeam {
  tag?: string
  tagClass?: string
  members?: DisplayItem[]
  text?: string
  [key: string]: unknown
}

/** 归一后的一个模块（标题已归一为 武器 / 圣遗物 / 天赋 / 面板 / 命座 / 配队） */
export interface DisplaySection {
  title: string
  displayTitle?: string
  kind?: string
  rows?: DisplayRow[]
  teams?: DisplayTeam[]
  /** 空模块标记（模板据此显示「暂无」） */
  empty?: boolean
  [key: string]: unknown
}

/** `normalizeGuideSections` 的可选参数 */
export interface NormalizeGuideOptions {
  /** 免费/无内容模块的提示（`free: ['talents','panels']`） */
  free?: string[]
  /** 本角色的专武表 `{ 专武, 实际 }` */
  signature?: Record<string, unknown> | null
  /** 全局武器标签表 `{ 活动: [...] }` */
  weaponTags?: Record<string, unknown> | null
}

// @ts-expect-error 维护者区是 ESM JS，没有类型声明（下面用窄类型断言后导出）
import { buildV2Sections as rawBuildV2Sections } from '../../scripts/lib/v2-sections.mjs'
// @ts-expect-error 同上（必须写成单行：`@ts-expect-error` 只压紧随的那一行，多行 import 的报错会落在 `} from …` 上）
import { tierLabelClass as rawTierLabelClass, EMPTY_TEXT as rawEmptyText, WEAPON_REFINE_HINT as rawRefineHint } from '../../scripts/lib/guide-display.mjs'

/**
 * v2 → 显示级 sections（**忠实的行构造器**，已含显示级归一）
 *
 * 实现见 `scripts/lib/v2-sections.mjs`（移植自 Atlas 的 `codexIndex/parse.js`）：
 * 档位词、`＞`、2+2 整体保留、皇冠并入天赋、命座「命之座X」、空模块「暂无」都在里面完成。
 * 实测与 Atlas 输出**全库 131/131 角色逐字段一致**（`test/codex-parity.test.mjs` 守着）。
 *
 * ⚠ 不要改用 `guide-model.mjs` 的 `v2ToSections`：那是两个维护者脚本用的简化测试模型，
 * 会丢 `kind`/`sets`/`talentLevel`/`crown`，导致天赋等级与 2+2 组合出错（见 1.2c 记录）。
 */
export const buildV2Sections = rawBuildV2Sections as (
  data: Guide,
  opts?: { signature?: Record<string, unknown> | null, weaponTags?: Record<string, unknown> | null }
) => DisplaySection[]

/** 档位标签的 CSS 类名（`推荐` → `label-推荐`，非档位词返回空串） */
export const tierLabelClass = rawTierLabelClass as (label: unknown) => string

/** 空模块文案（`暂无`） */
export const EMPTY_TEXT = rawEmptyText as string

/** 武器精炼提示（`（四星/三星武器默认为精5）`） */
export const WEAPON_REFINE_HINT = rawRefineHint as string
