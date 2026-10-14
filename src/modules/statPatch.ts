/**
 * statPatch — 「可调节词条」（v3 P4 / 队伍伤害 v2）
 *
 * 语法**对齐阿修版 miao 的面板「换/补」**（`apps/profile/ProfileChange.js`）：
 *   符号在前、可选百分号、属性名在后：`+30暴击` / `-10%大攻击` / `+40爆伤`
 *   多个属性用空格分隔（也兼容我们早期的 `暴击率+20` 写法）
 *
 * 单位口径：按 miao `attr`（最终面板值）直接加减 ——
 *   暴击/爆伤/充能/治疗/元素伤/物伤 等百分比类 → 加的是**百分点**；
 *   攻击/生命/防御/精通 等数值类 → 加的是**数值**。
 * ⚠ `%`/「大攻击」这类"按基数百分比"的写法需要基础数值，本插件暂不换算，会进 invalid 并提示。
 *
 * 本模块**纯函数**，可用合成属性表完整单测。
 */

/** 面板属性名 → 玩家侧属性键（与 `modules/grade.ts` 同一张表；元素伤害统一取 `dmg`） */
export const PANEL_ATTR_KEY: Record<string, string> = {
  生命值: 'hp',
  攻击力: 'atk',
  防御力: 'def',
  元素精通: 'mastery',
  元素充能效率: 'recharge',
  暴击率: 'cpct',
  暴击伤害: 'cdmg',
  治疗加成: 'heal',
  物理伤害加成: 'phy',
  元素伤害加成: 'dmg'
}

const ELEM_DMG_RE = /^(火|水|雷|草|风|岩|冰)元素伤害加成$/

/**
 * 中文属性名 → 属性键（**抄自 miao 的 ATTR_CN_TO_KEY**，最长前缀匹配）
 *
 * 与 miao 的差别：我们的键是"最终面板值"（`hp` 是数值、`cpct` 是百分点），
 * 所以 `大攻击/攻击力%` 这类**按基数百分比**的写法进 invalid（见文件头说明）。
 */
const ATTR_CN_TO_KEY: Record<string, string> = {
  暴击: 'cpct', 暴击率: 'cpct',
  爆伤: 'cdmg', 暴伤: 'cdmg', 暴击伤害: 'cdmg',
  攻击: 'atk', 攻击力: 'atk',
  生命: 'hp', 生命值: 'hp',
  防御: 'def', 防御力: 'def',
  精通: 'mastery', 元素精通: 'mastery',
  充能: 'recharge', 充能效率: 'recharge', 元素充能: 'recharge', 元素充能效率: 'recharge',
  治疗: 'heal', 治疗加成: 'heal',
  物伤: 'phy', 物理: 'phy', 物理伤害: 'phy', 物理伤害加成: 'phy',
  冰伤: 'dmg', 火伤: 'dmg', 雷伤: 'dmg', 水伤: 'dmg', 风伤: 'dmg', 岩伤: 'dmg', 草伤: 'dmg',
  元素伤害: 'dmg', 元素伤害加成: 'dmg'
}

/** 需要基础数值才能换算的写法（暂不支持，进 invalid 并提示） */
const PCT_BASE_RE = /[大百]|%|百分比/

/** 中文属性名 → 键（最长匹配；找不到返回空串） */
export function attrNameToKey (chinese: string): string {
  const text = String(chinese || '').trim()
  if (!text) return ''
  if (ELEM_DMG_RE.test(text)) return 'dmg'
  for (const cn of Object.keys(ATTR_CN_TO_KEY).sort((a, b) => b.length - a.length)) {
    if (text.includes(cn)) return ATTR_CN_TO_KEY[cn]
  }
  for (const cn of Object.keys(PANEL_ATTR_KEY).sort((a, b) => b.length - a.length)) {
    if (text.includes(cn)) return PANEL_ATTR_KEY[cn]
  }
  return ''
}

export interface StatPatchItem {
  /** 原始写法 */
  raw: string
  /** 中文名 */
  name: string
  /** 属性键 */
  attrKey: string
  /** 增量（正负） */
  delta: number
}

export interface StatPatch {
  items: StatPatchItem[]
  /** 无法识别的片段（展示用） */
  invalid: string[]
}

/**
 * 解析词条写法
 *
 * 支持：
 *   - miao 换补式：`+30暴击` / `-10爆伤` / `+20精通`（符号在前，可空格分隔多个）
 *   - 早期写法：`暴击率+20` / `攻击力=100`
 * 分隔符：`,` `，` `、` `;` `；` 空格
 */
export function parseStatPatch (text: unknown): StatPatch {
  const items: StatPatchItem[] = []
  const invalid: string[] = []
  for (const part of String(text || '').split(/[,，、;；\s]+/)) {
    const seg = part.trim()
    if (!seg) continue

    // ① miao 换补式：+30暴击 / -10%大攻击
    const miao = /^([+-])\s*(\d+(?:\.\d+)?)\s*(%?)\s*(.+)$/.exec(seg)
    if (miao) {
      const name = miao[4].trim()
      if (miao[3] === '%' || PCT_BASE_RE.test(name)) {
        invalid.push(`${seg}（按基数百分比暂不支持）`)
        continue
      }
      const attrKey = attrNameToKey(name)
      if (!attrKey) {
        invalid.push(seg)
        continue
      }
      const value = Number(miao[2])
      items.push({ raw: seg, name, attrKey, delta: miao[1] === '-' ? -value : value })
      continue
    }

    // ② 早期写法：暴击率+20 / 攻击力=100
    const legacy = /^(.+?)\s*([+\-=])\s*(\d+(?:\.\d+)?)$/.exec(seg)
    if (legacy) {
      const name = legacy[1].trim()
      if (PCT_BASE_RE.test(name.replace(/[%]/g, ''))) {
        // 「攻击力%」这类同样需要基数
        if (/%|大|百分比/.test(name)) {
          invalid.push(`${seg}（按基数百分比暂不支持）`)
          continue
        }
      }
      const attrKey = attrNameToKey(name)
      if (!attrKey) {
        invalid.push(seg)
        continue
      }
      const value = Number(legacy[3])
      items.push({ raw: seg, name, attrKey, delta: legacy[2] === '-' ? -value : value })
      continue
    }

    invalid.push(seg)
  }
  return { items, invalid }
}

/** 把词条应用到属性表（不改原对象；结果为负时截到 0） */
export function applyStatPatch (attrs: Record<string, number>, patch: StatPatch): Record<string, number> {
  const out: Record<string, number> = { ...(attrs || {}) }
  for (const item of patch.items) {
    const base = Number(out[item.attrKey]) || 0
    const next = base + item.delta
    out[item.attrKey] = next < 0 ? 0 : next
  }
  return out
}

/** 展示用说明 */
export function patchLabel (patch: StatPatch): string {
  if (!patch.items.length) return ''
  return patch.items.map(i => `${i.name}${i.delta >= 0 ? '+' : ''}${i.delta}`).join('，')
}