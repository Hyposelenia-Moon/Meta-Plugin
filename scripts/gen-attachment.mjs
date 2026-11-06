// 生成 data/team-sim/attachment.json：把图鉴（db.gensri.wiki）里的附着/ICD/削韧与产球条目落库。
//
// 用途与边界：
//   - 只做「记录 + 披露」，不参与结算。内核目前不模拟元素附着，反应由数据包逐条声明，
//     所以附着量/ICD 改不了伤害；这里先把原始数据存下来，等附着状态机立项时直接取用。
//   - 产球条目里的概率会人工核对后写进 data/team-sim/curated/*.json 的 `chance`，
//     内核按期望值折算能量；本文件保留原始 `chance`/`cd` 便于复核。
//
// 数据来源：db.gensri.wiki 的角色详情 JSON（原始数据为 Nanoka / Lunaris），经站点作者授权。
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const DB_DIR = process.env.GENSRI_DB_DIR ?? join(root, 'out/gensri/db/characters')
const ROSTER = join(root, 'data/team-sim/roster.json')
const OUT = join(root, 'data/team-sim/attachment.json')
const SOURCE = 'db.gensri.wiki（原始数据来自 Nanoka / Lunaris；经站点作者授权用于本仓库的非商业插件）'

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** 同一条攻击会按命中实例重复出现，这里按「命中盒 + 伤害参数 + 附着参数」去重并计数。 */
function summarizeAttacks(attacks) {
  const map = new Map()
  for (const attack of attacks ?? []) {
    const gauge = String(attack.gauge ?? '').trim()
    const rule = String(attack.icd_rule ?? '').trim()
    const element = String(attack.element ?? '').trim()
    const key = [attack.name, attack.damageParam ?? '', gauge, rule, String(attack.icd_source ?? ''), String(attack.poise ?? ''), element, String(attack.attackType ?? ''), String(attack.strikeType ?? '')].join('|')
    const item = map.get(key)
    if (item) item.count += 1
    else {
      map.set(key, {
        name: attack.name,
        damageParam: attack.damageParam ?? null,
        gauge: gauge || null,
        icdRule: rule || null,
        icdSource: attack.icd_source ?? null,
        poise: attack.poise ?? null,
        element: element || null,
        attackType: attack.attackType ?? null,
        strikeType: attack.strikeType ?? null,
        count: 1
      })
    }
  }
  return [...map.values()]
}

const roster = readJson(ROSTER)
if (!roster || !Array.isArray(roster.characters)) {
  console.error(`找不到名录：${ROSTER}`)
  process.exit(1)
}

const characters = {}
const missing = []
for (const entry of roster.characters) {
  if (entry.status === 'alias') continue
  const file = join(DB_DIR, `${entry.charId}.json`)
  const detail = readJson(file)
  if (!detail) {
    missing.push(`${entry.cn}（${entry.charId}）`)
    continue
  }
  const attacks = summarizeAttacks(detail.attacks)
  const energy = (detail.energy ?? []).map((item) => ({
    source: item.source,
    particles: item.particles,
    chance: item.chance,
    cd: item.cd
  }))
  if (!attacks.length && !energy.length) continue
  characters[entry.charId] = { cn: entry.cn, keys: entry.keys, attacks, energy }
}

// 角色目录名不是 charId 的（旅行者拆分等）单独记一笔，避免以后误以为丢了数据。
const files = readdirSync(DB_DIR).filter((name) => name.endsWith('.json'))
const used = new Set(Object.keys(characters))
const unused = files.map((name) => name.replace(/\.json$/, '')).filter((id) => !used.has(id)).sort()

const data = {
  schemaVersion: 1,
  source: SOURCE,
  note: '附着量/ICD/削韧与产球原始条目：只做记录与披露，不参与结算；内核当前不模拟元素附着，反应由数据包逐条声明。',
  counts: {
    characters: Object.keys(characters).length,
    attacks: Object.values(characters).reduce((sum, item) => sum + item.attacks.length, 0),
    energy: Object.values(characters).reduce((sum, item) => sum + item.energy.length, 0)
  },
  characters
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
console.log(`写出 ${OUT}`)
console.log(JSON.stringify({ ...data.counts, missing, unused }, null, 2))
