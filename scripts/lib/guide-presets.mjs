/** schema:3 数据侧规范化；返回值全部深拷贝，预设间不共享可变数据。 */
import { deriveSections, deriveTags, MODULE_KEYS, normalizeFreeModules } from './schema.mjs'

const copy = value => JSON.parse(JSON.stringify(value))
export const PRESET_WEIGHTS = {
  dps: { artifact: 30, panel: 30, weapon: 20, talent: 20 },
  support: { artifact: 0, panel: 50, weapon: 25, talent: 25 }
}
export function normalizePreset (raw = {}, i = 0) {
  const p = copy(raw)
  const role = p.role === 'support' ? 'support' : 'dps'
  const out = { id: String(p.id || (i ? `preset-${i + 1}` : 'default')), name: String(p.name || (i ? `预设${i + 1}` : '默认')), role, match: {} }
  for (const key of ['names', 'patterns']) if (Array.isArray(p.match?.[key])) out.match[key] = [...new Set(p.match[key].map(String).map(x => x.trim()).filter(Boolean))]
  for (const pattern of out.match.patterns || []) {
    if (pattern.length > 256) throw new Error(`预设「${out.name}」匹配正则不得超过 256 字符`)
    try { new RegExp(pattern, 'iu') } catch { throw new Error(`预设「${out.name}」匹配正则无效：${pattern}`) }
  }
  if (p.weights && typeof p.weights === 'object') {
    out.weights = {}
    for (const key of ['artifact', 'panel', 'weapon', 'talent']) if (key in p.weights) {
      if (!Number.isFinite(p.weights[key]) || p.weights[key] < 0) throw new Error(`预设「${out.name}」权重 ${key} 必须是非负有限数字`)
      out.weights[key] = p.weights[key]
    }
    if (!Object.values({ ...PRESET_WEIGHTS[role], ...out.weights }).some(x => x > 0)) throw new Error(`预设「${out.name}」至少有一项权重必须大于 0`)
  }
  out.meta = p.meta && typeof p.meta === 'object' ? p.meta : {}
  out.v2 = Object.fromEntries(MODULE_KEYS.map(key => [key, Array.isArray(p.v2?.[key]) ? p.v2[key] : []]))
  for (const key of ['highlight', 'topConstellations', 'unparsed']) if (p[key] !== undefined) out[key] = p[key]
  const free = normalizeFreeModules(p.freeModules)
  if (free.length) out.freeModules = free
  return out
}
export function listGuidePresets (guide = {}) {
  if (guide.schema === 3 || Array.isArray(guide.presets)) return (guide.presets || []).map(normalizePreset)
  // 旧内容整份保留；只根据明确定位选默认角色，不拆分或猜测六模块归属。
  return [normalizePreset({ ...guide, id: 'default', name: '默认', role: /辅助|纯辅|治疗|护盾/.test(String(guide.meta?.定位 || '')) ? 'support' : 'dps' })]
}
export function normalizeGuide (guide = {}) {
  const presets = listGuidePresets(guide)
  if (!presets.length) throw new Error('至少保留一份攻略预设')
  const ids = presets.map(p => p.id)
  if (new Set(ids).size !== ids.length) throw new Error('攻略预设 id 不得重复')
  if (new Set(presets.map(p => p.name)).size !== presets.length) throw new Error('攻略预设名称不得重复')
  return { schema: 3, name: String(guide.name || ''), game: guide.game || 'gi', source: copy(guide.source || {}), presets }
}
export function selectGuidePreset (guide, requested) {
  const presets = listGuidePresets(guide)
  const p = typeof requested === 'object' && requested ? presets.find(p => p.id === requested.id) : requested == null ? presets[0] : presets.find(p => p.id === requested || p.name === requested)
  if (!p) throw new Error(`攻略预设不存在：${requested?.id || requested || '(空)'}`)
  const out = { schema: 2, name: guide.name, game: guide.game || 'gi', source: copy(guide.source || {}),
    meta: copy(p.meta), v2: copy(p.v2), freeModules: copy(p.freeModules || []),
    topConstellations: copy(p.topConstellations || []), unparsed: copy(p.unparsed || {}),
    presetId: p.id, presetName: p.name }
  if (p.highlight !== undefined) out.highlight = copy(p.highlight)
  out.tags = deriveTags(out)
  out.sections = deriveSections(out)
  return out
}
/** 文档中的独立配置行，正文仍使用既有可读的六模块写法。 */
export const PRESET_MARKER = '攻略预设：'
export function presetMarker (preset) {
  const { v2, meta, ...config } = preset
  // 空主词条在可读正文中不占行，显式记下原位置，不能凭角色/其它行猜测是否补齐。
  const emptyArtifactMains = (v2?.artifacts || []).flatMap((row, at) => row.kind === 'main' && !Object.values(row.stats || {}).some(values => Array.isArray(values) && values.some(Boolean)) ? [{ at, row }] : [])
  // 条目名内的紧凑 +（如 2精通+2精通）与行级组合符同形，保留其结构边界。
  const literalArtifactRows = (v2?.artifacts || []).flatMap((row, at) => row.sets?.some(item => /\S[+＋＆&]\S/.test(item.name || '')) ? [{ at, row }] : [])
  return PRESET_MARKER + JSON.stringify({ ...config, meta, ...(emptyArtifactMains.length ? { emptyArtifactMains } : {}), ...(literalArtifactRows.length ? { literalArtifactRows } : {}) })
}
export function splitPresetBlocks (lines) {
  const groups = []
  let group = null
  for (const line of lines.slice(1)) {
    if (line.startsWith(PRESET_MARKER)) {
      group = { config: JSON.parse(line.slice(PRESET_MARKER.length)), lines: [lines[0]] }
      groups.push(group)
    } else if (group) group.lines.push(line)
  }
  return groups
}

export function guideReviewItems (guide) {
  const out = []
  for (const preset of listGuidePresets(guide)) for (const key of MODULE_KEYS) for (const [i, row] of preset.v2[key].entries()) {
    if (/输出|辅助|主[Cc]|副[Cc]/.test(String(row.label || ''))) out.push({ preset: preset.id, module: key, row: i + 1, label: row.label, reason: '旧数据方向标签：仅标签不能证明未标注行归属，保留原内容待人工核对' })
  }
  return out
}
