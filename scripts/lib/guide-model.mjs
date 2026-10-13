/**
 * v2 → 归一前的 sections（六个模块）
 *
 * **单一真相**：`data/gi/<角色>.json` 的 `v2` 是结构化六模块，所有消费方都从这里取——
 * 维护者脚本（`display-selftest.mjs` / `display-audit.mjs`）与插件侧
 * （`src/model/markup.ts` 的类型化包装）。此前两个脚本各有一份近似重复的最小实现
 * （`display-selftest` 的 `localModel` 与 `display-audit` 的 `localRows`），已合并到本文件。
 *
 * 两点刻意的选择：
 *   1. 档位名走共享映射 `ARTIFACT_KIND_LABEL`（**来源写法**，与 `data/gi` 的
 *      `v2.artifacts[].label` 词汇一致），再交给 `displayLabel` 归一 —— 这里刻意不用显示词，
 *      因为本模块要模拟的是"数据 / 文档长什么样"；
 *   2. 本模块只做**结构搬运**，不做任何文本归一（归一在 `guide-display.mjs` 的
 *      `normalizeGuideSections` 里做）。
 */
import { ARTIFACT_KIND_LABEL } from './guide-display.mjs'

/** 档位序号 → 中文数字（`tier: 1` → `第一档`） */
export const CN_TIER = ['', '一', '二', '三', '四', '五', '六']

/**
 * `v2` → sections 数组
 *
 * @param {object} v2 `data/gi/<角色>.json` 的 `v2` 字段
 * @returns {Array<object>} 六个模块（顺序固定：武器 / 圣遗物 / 天赋 / 面板 / 命座 / 配队）
 */
export function v2ToSections (v2 = {}) {
  const out = []
  const rows = []
  for (const r of v2.weapons ?? []) {
    rows.push({
      label: String(r.label ?? '').trim() || (r.tier ? `第${CN_TIER[r.tier]}档` : ''),
      items: (r.items ?? []).map((it, i, a) => ({ text: it.name, note: it.note ?? '', ref: it.ref, sepAfter: i < a.length - 1 ? String(r.sep ?? ' > ').trim().split(/\s+/)[0] : '' }))
    })
  }
  out.push({ title: '1. 武器推荐', type: 'rows', rows })
  const arows = []
  for (const r of v2.artifacts ?? []) {
    if (r.kind === 'main') {
      const slots = ['时之沙', '空之杯', '理之冠'].filter(s => (r.stats?.[s] ?? []).length)
      arows.push({
        label: '主词条',
        items: slots.map((s, i) => ({ text: `${s}：${(r.stats[s] ?? []).join(' / ')}`, note: '', ref: '', sepAfter: i < slots.length - 1 ? '/' : '' }))
      })
      continue
    }
    if (r.kind === 'sub') {
      arows.push({
        label: '副词条',
        items: (r.stats ?? []).map((s, i, a) => ({ text: s, note: '', ref: '', sepAfter: i < a.length - 1 ? String(r.sep ?? ' / ').trim().split(/\s+/)[0] : '' }))
      })
      continue
    }
    const head = ARTIFACT_KIND_LABEL[r.kind] ?? ''
    arows.push({
      label: String(r.label ?? '').trim() || head,
      items: (r.sets ?? []).map((s, i, a) => ({ text: s.name + (s.pieces ? `（${s.pieces}）` : ''), note: s.note ?? '', ref: s.ref, sepAfter: i < a.length - 1 ? String(r.sep ?? ' / ').trim().split(/\s+/)[0] : '' }))
    })
  }
  out.push({ title: '2. 圣遗物推荐', type: 'rows', rows: arows })
  const trows = []
  for (const r of v2.talents ?? []) {
    if (r.kind === 'priority') trows.push({ label: '优先级', items: (r.order ?? []).map((o, i, a) => ({ text: o.name, note: '', ref: o.ref, sepAfter: i < a.length - 1 ? '＞' : '' })) })
    if (r.kind === 'crown') trows.push({ label: '皇冠', items: (r.items ?? []).map(o => ({ text: o.name, level: o.level, ref: o.ref, sepAfter: '' })) })
  }
  out.push({ title: '3. 天赋加点', type: 'rows', rows: trows })
  out.push({
    title: '4. 毕业面板参考',
    type: 'stats',
    rows: (v2.panels ?? []).map(r => ({
      label: String(r.label ?? ''),
      items: r.k != null
        ? [{ text: `${r.k}：${r.v ?? ''}`, note: '', ref: '', sepAfter: '' }]
        : (String(r.text ?? '').split(' / ').map((t, i, a) => ({ text: t, note: '', ref: '', sepAfter: i < a.length - 1 ? '/' : '' })))
    }))
  })
  out.push({
    title: '5. 命座推荐',
    type: 'rows',
    rows: (v2.constellations ?? []).map(r => ({ label: r.name, items: r.text ? [{ text: r.text, note: '', ref: `constellation:${r.index}`, sepAfter: '' }] : [] }))
  })
  out.push({
    title: '6. 配队推荐',
    type: 'teams',
    teams: (v2.teams ?? []).map(r => ({ tag: String(r.label ?? ''), members: (r.members ?? []).map(m => ({ name: m.name, note: m.note ?? '', ref: m.ref })), text: String(r.text ?? '') }))
  })
  return out
}
