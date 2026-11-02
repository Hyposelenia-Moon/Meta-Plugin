/**
 * 生成 `data/team-sim/stat-tables.json`：五星圣遗物的主词条档位与副词条单条档位。
 *
 * 为什么单独落一份数据：面板编辑器要按「部位 + 等级 + 属性」下拉主词条、
 * 按「属性 + 档位」下拉副词条，内核只接受最终数值，不接受 UI 的档位概念。
 * 数值是游戏常量（五星、+0/+4/+8/+12/+16/+20），改动必须整体替换并同步测试。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'data', 'team-sim', 'stat-tables.json')

export const LEVELS = [0, 4, 8, 12, 16, 20]

/** 主词条：按等级索引（0/4/8/12/16/20）。百分比一律用小数。 */
export const MAIN_STATS = {
  hp: [239, 538, 807, 1076, 1345, 4780],
  atk: [14, 31, 46, 62, 77, 311],
  def: [19, 42, 63, 84, 105, 391],
  hpPct: [0.047, 0.094, 0.141, 0.188, 0.235, 0.466],
  atkPct: [0.047, 0.094, 0.141, 0.188, 0.235, 0.466],
  defPct: [0.047, 0.094, 0.141, 0.188, 0.235, 0.466],
  mastery: [19, 42, 63, 84, 105, 187],
  recharge: [0.052, 0.104, 0.156, 0.208, 0.26, 0.518],
  cpct: [0.031, 0.062, 0.093, 0.124, 0.155, 0.311],
  cdmg: [0.062, 0.124, 0.186, 0.248, 0.31, 0.622],
  heal: [0.036, 0.072, 0.108, 0.144, 0.18, 0.359],
  phy: [0.058, 0.117, 0.175, 0.233, 0.291, 0.583],
  pyro: [0.058, 0.117, 0.175, 0.233, 0.291, 0.583],
  hydro: [0.058, 0.117, 0.175, 0.233, 0.291, 0.583],
  electro: [0.058, 0.117, 0.175, 0.233, 0.291, 0.583],
  cryo: [0.058, 0.117, 0.175, 0.233, 0.291, 0.583],
  anemo: [0.058, 0.117, 0.175, 0.233, 0.291, 0.583],
  geo: [0.058, 0.117, 0.175, 0.233, 0.291, 0.583],
  dendro: [0.058, 0.117, 0.175, 0.233, 0.291, 0.583]
}

/** 每个部位能出的主词条（与 `src/modules/teamSimulation/build.ts` 的 SLOT_MAINS 一致）。 */
export const SLOT_MAINS = {
  flower: ['hp'],
  plume: ['atk'],
  sands: ['hpPct', 'atkPct', 'defPct', 'recharge', 'mastery'],
  goblet: ['hpPct', 'atkPct', 'defPct', 'mastery', 'phy', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'],
  circlet: ['hpPct', 'atkPct', 'defPct', 'mastery', 'cpct', 'cdmg', 'heal']
}

/** 副词条单条档位（五星，四条档位）。 */
export const SUB_ROLLS = {
  hp: [167, 179, 191, 203],
  atk: [16, 17, 18, 19],
  def: [19, 21, 22, 23],
  hpPct: [0.041, 0.047, 0.053, 0.058],
  atkPct: [0.041, 0.047, 0.053, 0.058],
  defPct: [0.041, 0.047, 0.053, 0.058],
  mastery: [16, 19, 21, 23],
  recharge: [0.045, 0.052, 0.058, 0.065],
  cpct: [0.027, 0.031, 0.035, 0.039],
  cdmg: [0.054, 0.062, 0.07, 0.078]
}

/** 一个副词条最多吃 6 条（1 条初始 + 5 次强化）。 */
const MAX_ROLLS = 6

/** 同属性多条强化的合法总和（去重、排序、保留 4 位小数）。 */
export function cumulativeSums (tiers, maxRolls = MAX_ROLLS) {
  const sums = new Set()
  const walk = (rolls, index, total) => {
    if (rolls > 0) sums.add(Number(total.toFixed(4)))
    if (rolls === maxRolls) return
    for (let tier = index; tier < tiers.length; tier += 1) walk(rolls + 1, tier, total + tiers[tier])
  }
  walk(0, 0, 0)
  return [...sums].sort((a, b) => a - b)
}

export function buildTables () {
  return {
    schemaVersion: 1,
    levels: LEVELS,
    slots: SLOT_MAINS,
    mainStats: MAIN_STATS,
    subRolls: SUB_ROLLS,
    subValues: Object.fromEntries(Object.entries(SUB_ROLLS).map(([key, tiers]) => [key, cumulativeSums(tiers)]))
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, `${JSON.stringify(buildTables(), null, 2)}\n`, 'utf8')
  console.log(`已生成 ${path.relative(ROOT, OUT)}`)
}

