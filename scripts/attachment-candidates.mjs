/**
 * 附着候选配对表（只读）：把动作包里的元素命中，与 `data/team-sim/attachment.json`
 * 的命中盒条目按「技能族 + 元素 + 次数」对齐，给出置信度，供人工核对。
 *
 * 不写任何数据：`icdSource` 里的 `Tag:` 只说明这条命中属于哪个技能族，
 * 与动作包的 `actionId` 没有稳定对应关系，所以高置信度也只是「候选」。
 *
 * 用法：node scripts/attachment-candidates.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'team-sim')

const ELEMENT_ALIAS = {
  Fire: 'pyro', Ice: 'cryo', Water: 'hydro', Electric: 'electro', Wind: 'anemo', Rock: 'geo', Grass: 'dendro', Physical: 'physical'
}

/** 命中盒条目的技能族：从 `icdSource` 的 Tag 前缀判定，判不出来返回 null。 */
function familyOf (entry) {
  const source = String(entry.icdSource ?? '')
  if (/Elemental_Burst/i.test(source)) return 'burst'
  if (/Elemental_Art/i.test(source)) return 'skill'
  if (/Charged/i.test(source)) return 'charged'
  if (/Plunge/i.test(source)) return 'plunge'
  if (/Normal_Attack/i.test(source)) return 'normal'
  return null
}

const packDir = path.join(DATA, 'packs')
const attachment = JSON.parse(fs.readFileSync(path.join(DATA, 'attachment.json'), 'utf8'))
const roster = JSON.parse(fs.readFileSync(path.join(DATA, 'roster.json'), 'utf8'))

const byCharId = new Map(roster.characters.map(entry => [entry.charId, entry]))
const rows = []

for (const file of fs.readdirSync(packDir).filter(name => name.endsWith('.json'))) {
  const key = path.basename(file, '.json')
  const pack = JSON.parse(fs.readFileSync(path.join(packDir, file), 'utf8'))
  const rosterEntry = roster.characters.find(entry => (entry.keys ?? []).includes(key))
  const charAtt = rosterEntry ? attachment.characters[rosterEntry.charId] : undefined
  if (!charAtt) continue
  const entries = charAtt.attacks.map(entry => ({ ...entry, family: familyOf(entry), elementKey: ELEMENT_ALIAS[entry.element] ?? null }))

  for (const action of Object.values(pack.actions)) {
    const elementalHits = action.hits.filter(hit => hit.element && hit.element !== 'physical')
    if (!elementalHits.length) continue
    const element = elementalHits[0].element
    const sameFamily = entries.filter(entry => entry.family === action.kind)
    const sameElement = entries.filter(entry => entry.elementKey === element)
    const both = sameFamily.filter(entry => entry.elementKey === element)
    const count = both.reduce((sum, entry) => sum + (entry.count ?? 1), 0)

    const unique = both.length === 1
    let confidence = 'none'
    if (unique && count === action.hits.length) confidence = 'high'
    else if (both.length && count === action.hits.length) confidence = 'medium'
    else if (sameElement.length && action.kind === 'normal') confidence = 'low'
    else if (sameElement.length) confidence = 'low'

    rows.push({
      key,
      cn: rosterEntry.cn,
      actionId: action.id,
      kind: action.kind,
      element,
      hits: action.hits.length,
      confidence,
      candidates: both.map(entry => ({
        damageParam: entry.damageParam,
        name: entry.name,
        gauge: entry.gauge,
        icdRule: entry.icdRule,
        icdSource: entry.icdSource
      }))
    })
  }
}

const GAUGE_NUMBER = { '1U': 1, '2U': 2, '4U': 4 }

/**
 * 高置信度行转成「绑定提案」：只做单位换算，不写进动作包。
 * `icdRule` 为 `Independent` 才算独立附着，其余（含 `24 hits / 0.5s` 这类组内计数）
 * 一律按 `standard` 记——组参数对不上，这里只给候选，等人工确认。
 */
const proposals = rows
  .filter(row => row.confidence === 'high')
  .map(row => {
    const candidate = row.candidates[0]
    const gauge = GAUGE_NUMBER[candidate.gauge]
    const icd = /^Independent$/i.test(candidate.icdRule) ? 'independent' : 'standard'
    return {
      key: row.key,
      cn: row.cn,
      actionId: row.actionId,
      kind: row.kind,
      element: row.element,
      hits: row.hits,
      evidence: 'family+element+count 唯一匹配（自动，未经人工确认）',
      damageParam: candidate.damageParam,
      icdSource: candidate.icdSource,
      proposed: {
        ...(gauge !== undefined ? { gauge } : {}),
        icd
      },
      ...(gauge === undefined ? { issue: `附着量 ${candidate.gauge} 无法换算成单位数` } : {})
    }
  })

const histogram = rows.reduce((acc, row) => {
  acc[row.confidence] = (acc[row.confidence] ?? 0) + 1
  return acc
}, {})

const summary = {
  actions: rows.length,
  characters: new Set(rows.map(row => row.key)).size,
  histogram,
  proposals: proposals.length,
  proposalsWithIssue: proposals.filter(item => item.issue).length
}

fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'out', 'attachment-candidates.json'), JSON.stringify({ summary, rows }, null, 2), 'utf8')
fs.writeFileSync(path.join(ROOT, 'out', 'attachment-bindings-proposal.json'), JSON.stringify(proposals, null, 2), 'utf8')
console.log(JSON.stringify(summary, null, 2))
for (const item of proposals) console.log(`${item.key}.${item.actionId.split('.').slice(1).join('.')}  ${item.element} x${item.hits}  ->  gauge ${JSON.stringify(item.proposed)}  (${item.damageParam})`)
