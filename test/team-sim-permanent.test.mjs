import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mod } from './_helper.mjs'

const { requiredEffectSources, buildPermanentStats } = await import(mod('modules/teamSimulation/build.js'))
const { loadRoster, loadPermanentData } = await import(mod('model/TeamSimStore.js'))

/**
 * 永久数据的契约测试：data/team-sim/permanent/ 里落库的四份必须是
 * 「名录身份 + 武器身份」对得上、白值与 miao 7.1 一致、并且把没建模的部分写清楚。
 *
 * 这里刻意不 mock 任何东西：直接读仓库里已入库的文件，等价于用户把录制放进 rotations/ 后
 * `#队伍伤害` 实际会走到的那条路。
 */
const EXPECTED = {
  gameVersion: '7.1',
  bundleId: 'permanent-7.1',
  source: 'miao meta-gs 7.1（白值/突破/武器副属性）+ 本仓库人工审计（套装与被动）'
}
const HUA_GUAN = '400189' // 华馆梦醒形骸记：2 件套 防御力提高 30%

const cases = [
  { charId: '10000030', name: '钟离', key: 'zhongli', weaponId: '13303', weapon: '黑缨枪', base: { hp: 14695.09, atk: 251.14, def: 737.81 }, weaponAtk: 354.38 },
  { charId: '10000038', name: '阿贝多', key: 'albedo', weaponId: '11415', weapon: '辰砂之纺锤', base: { hp: 13225.58, atk: 251.14, def: 876.15 }, weaponAtk: 454.36 },
  { charId: '10000055', name: '五郎', key: 'gorou', weaponId: '15401', weapon: '西风猎弓', base: { hp: 9569.93, atk: 182.66, def: 648.4 }, weaponAtk: 454.36 },
  { charId: '10000057', name: '荒泷一斗', key: 'aratakiitto', weaponId: '12510', weapon: '赤角石溃杵', base: { hp: 12858.21, atk: 227.22, def: 959.16 }, weaponAtk: 541.83 }
]

const slots = ['flower', 'plume', 'sands', 'goblet', 'circlet']
/** 主词条一律 0：这轮验的是永久数据本身，不想让圣遗物把断言搅浑。 */
const zeroMains = [{ key: 'hp' }, { key: 'atk' }, { key: 'hpPct' }, { key: 'geo' }, { key: 'cpct' }]

function makeBuild (item) {
  const build = {
    schemaVersion: 1,
    actorId: item.key,
    characterId: item.charId,
    name: item.name,
    element: 'geo',
    level: 90,
    ascension: 6,
    constellation: 0,
    talents: { normal: 10, skill: 10, burst: 10 },
    weapon: { id: item.weaponId, name: item.weapon, level: 90, ascension: 6, refinement: 1 },
    artifacts: slots.map((slot, i) => ({
      slot, name: `${slot}-fixture`, setId: HUA_GUAN, rarity: 5, level: 20,
      main: { key: zeroMains[i].key, value: 0 }, sub: []
    })),
    requiredEffects: [],
    provenance: { provider: 'test/team-sim-permanent.test.mjs', providerVersion: null, sourceTime: null }
  }
  build.requiredEffects = requiredEffectSources(build)
  return build
}

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} ≠ ${expected}`)

const roster = loadRoster()
assert.ok(Array.isArray(roster.characters), '名录结构不对')
assert.equal(roster.gameVersion, '7.1')
const byCharId = new Map(roster.characters.map(entry => [entry.charId, entry]))

/** 防御的静态倍率：华馆 2 件套 30%，辰砂之纺锤 68.97%，赤角石溃杵 28%。 */
const defMultiplier = { 10000030: 1.3, 10000038: 1 + 0.3 + 0.6897, 10000055: 1.3, 10000057: 1 + 0.3 + 0.28 }

for (const item of cases) {
  const entry = byCharId.get(item.charId)
  assert.ok(entry, `名录里没有 ${item.charId}`)
  assert.equal(entry.cn, item.name)
  assert.equal(entry.status, 'mapped')

  const build = makeBuild(item)
  const loaded = loadPermanentData(build)
  assert.ok(loaded.data, JSON.stringify(loaded.issue))
  const panel = buildPermanentStats(build, loaded.data, EXPECTED)
  assert.equal(panel.status, 'permanent-ready', JSON.stringify(panel))

  // 白值必须与 miao 7.1 的 90 级数据逐位一致：这一层一旦漂移，后面所有伤害都错。
  assert.deepEqual(loaded.data.character.base, item.base)
  assert.equal(loaded.data.weapon.baseAtk, item.weaponAtk)
  assert.deepEqual(panel.base, { hp: item.base.hp, atk: item.base.atk + item.weaponAtk, def: item.base.def, weaponAtk: item.weaponAtk })

  near(panel.stats.def, item.base.def * defMultiplier[item.charId], `${item.name} 防御`)
  assert.ok(panel.unmodeled.some(row => row.id === `artifact-set:${HUA_GUAN}:4pc`), `${item.name} 应披露华馆 4 件套未建模`)
  assert.ok(panel.unmodeled.every(row => typeof row.reason === 'string' && row.reason.trim().length > 0))
}

// 元素、暴击、充能三类来自突破/武器副属性，单独挑四个人各验一条，避免断言只对上「没出错」。
const zhongli = buildPermanentStats(makeBuild(cases[0]), loadPermanentData(makeBuild(cases[0])).data, EXPECTED)
near(zhongli.stats.hp, 14695.09 * (1 + 0.4692), '钟离 生命（黑缨枪 生命 46.92%）')
near(zhongli.stats.geo, 0.288, '钟离 岩伤（突破 28.8%）')

const albedo = buildPermanentStats(makeBuild(cases[1]), loadPermanentData(makeBuild(cases[1])).data, EXPECTED)
near(albedo.stats.def, 876.15 * (1 + 0.3 + 0.6897), '阿贝多 防御（华馆 30% + 辰砂 68.97%）')
assert.ok(albedo.unmodeled.some(row => row.id === 'weapon:11415:r1'), '阿贝多应披露辰砂「按防御折算战技伤害」未建模')

const gorou = buildPermanentStats(makeBuild(cases[2]), loadPermanentData(makeBuild(cases[2])).data, EXPECTED)
near(gorou.stats.recharge, 1 + 0.6125, '五郎 充能（西风猎弓 61.25%）')
near(gorou.stats.geo, 0.24, '五郎 岩伤（突破 24%）')

const itto = buildPermanentStats(makeBuild(cases[3]), loadPermanentData(makeBuild(cases[3])).data, EXPECTED)
near(itto.stats.cpct, 0.05 + 0.192, '一斗 暴击（基础 5% + 突破 19.2%）')
near(itto.stats.cdmg, 0.5 + 0.882, '一斗 暴伤（基础 50% + 赤角 88.2%）')
near(itto.stats.def, 959.16 * (1 + 0.3 + 0.28), '一斗 防御（华馆 30% + 赤角 28%）')

// 武器/精炼对不上时必须点名，并列出同角色已有文件——这正是「先替代后删除」阶段最常见的卡点。
const wrongWeapon = makeBuild({ ...cases[0], weaponId: '99999' })
const wrong = loadPermanentData(wrongWeapon)
assert.equal(wrong.data, undefined)
assert.equal(wrong.issue.code, 'missing')
assert.match(wrong.issue.message, /10000030-99999-r1\.json/)
assert.match(wrong.issue.message, /10000030-13303-r1\.json/)
assert.match(wrong.issue.message, /武器或精炼对不上/)

// 2026-11-02：没有入库文件的「同武器不同精炼」不再报缺，按玩家精炼现算（r5）。
const wrongRefine = makeBuild({ ...cases[0] })
wrongRefine.weapon.refinement = 5
const refineR5 = loadPermanentData(wrongRefine)
assert.ok(refineR5.data, JSON.stringify(refineR5.issue))
assert.equal(refineR5.data.weapon.id, '13303')
assert.ok(refineR5.data.effects['weapon:13303:r5'])

// data 目录里不能出现带生成时间的报表：那会让入库数据不可复现。
const raw = readFileSync('data/team-sim/permanent/10000030-13303-r1.json', 'utf8')
assert.equal(raw.includes('generatedAt'), false, 'data/team-sim/permanent 里不应出现构建产物字段')
const parsed = JSON.parse(raw)
assert.equal(parsed.bundleId, 'permanent-7.1')
assert.equal(parsed.schemaVersion, 1)

const { evaluateReleaseGate } = await import(mod('modules/teamSimulation/gate.js'))
const { buildTeamRunReport, formatTeamRunReport } = await import(mod('modules/teamSimulation/report.js'))
const { dpsWindowFrames, DPS_STANDARD } = await import(mod('modules/teamSimulation/dpsStandard.js'))
const { combineDataPacks } = await import(mod('modules/teamSimulation/dataPack.js'))
const { simulateTeam } = await import(mod('modules/teamSimulation/teamRun.js'))
const { FRAME_TIERS } = await import(mod('modules/teamSimulation/timeline.js'))

// 用真实入库数据把管线走一遍：名录包 + 永久数据 → 时间线 → 结算 → 报告 → 闸门。
// 这一步的意义是证明「#队伍伤害 在录制就位后能出数」，而不是再次用合成面板自我安慰。
const packInputs = cases.map(item => JSON.parse(readFileSync(`data/team-sim/packs/${item.key}.json`, 'utf8')))
const mergedPack = combineDataPacks(packInputs)
assert.equal(mergedPack.status, 'ok', JSON.stringify(mergedPack.issues))
const pack = mergedPack.pack

const members = cases.map(item => {
  const build = makeBuild(item)
  const loaded = loadPermanentData(build)
  return { build, permanentData: loaded.data }
})
const totals = { hp: 0, atk: 0, def: 0 }
cases.forEach((item, index) => {
  const panel = buildPermanentStats(members[index].build, members[index].permanentData, EXPECTED)
  totals.hp += panel.stats.hp
  totals.atk += panel.stats.atk
  totals.def += panel.stats.def
})

const framesOf = action => (action.timing && action.timing.type === 'frames' ? action.timing.frames : 40)
const steps = []
let at = 0
cases.forEach((item, index) => {
  if (index > 0) steps.push({ id: `sw-${item.key}`, kind: 'switch', actorId: item.key, atFrame: at })
  steps.push({ id: `sk-${item.key}`, kind: 'action', actorId: item.key, actionId: `${item.key}.skill`, atFrame: at })
  at += framesOf(pack.actions[`${item.key}.skill`]) + 2
})
const normalIds = Object.keys(pack.actions).filter(id => id.startsWith('aratakiitto.normal-')).sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))
let n = 0
while (at < 7100) {
  const id = normalIds[n % normalIds.length]
  steps.push({ id: `na-${n}`, kind: 'action', actorId: 'aratakiitto', actionId: id, atFrame: at })
  at += framesOf(pack.actions[id]) + 1
  n += 1
}

const rotation = {
  id: 'rotation:geo-permanent', scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'],
  measurementEndFrame: dpsWindowFrames(FRAME_TIERS['fps-60']),
  steps,
  actors: cases.map(item => ({ actorId: item.key, energy: 0, energyMax: 80 })),
  activeActorId: 'zhongli'
}
const run = simulateTeam({
  pack, rotation, members, expected: EXPECTED, targetPresetId: DPS_STANDARD.targetId,
  crit: 'expected', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
})
assert.equal(run.status, 'calculated', JSON.stringify(run.issues))
assert.ok(run.dps.value > 0)
assert.ok(run.unmodeled.length >= cases.length, `四人每人至少一条未建模披露：${run.unmodeled.length}`)
assert.ok(run.unmodeled.every(row => cases.some(item => item.key === row.actorId)))

// 报告必须把「没算的东西」写在数字前面，而不是只给一个漂亮的 DPS。
const lines = formatTeamRunReport(buildTeamRunReport(run))
const reportText = lines.join('\n')
assert.match(reportText, /未纳入/)
assert.match(reportText, /偏低估/)

// 闸门：有未建模效果就不能 pass，accuracy 关必须点名。
const verdict = evaluateReleaseGate({ result: run })
const accuracy = verdict.checks.find(check => check.id === 'accuracy')
assert.equal(accuracy.status, 'blocked')
assert.match(accuracy.detail, /未纳入|未建模/)
assert.equal(verdict.status, 'blocked')

console.log(JSON.stringify({
  cases: cases.length,
  effects: Object.keys(parsed.effects).length,
  unmodeled: zhongli.unmodeled.length,
  dps: Math.round(run.dps.value),
  hits: run.timeline.hits.length,
  panelTotals: { hp: Math.round(totals.hp), atk: Math.round(totals.atk), def: Math.round(totals.def) },
  gate: verdict.status
}))
