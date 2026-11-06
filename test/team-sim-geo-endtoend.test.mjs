import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mod } from './_helper.mjs'

const { FRAME_TIERS } = await import(mod('modules/teamSimulation/timeline.js'))
const { requiredEffectSources, buildPermanentStats } = await import(mod('modules/teamSimulation/build.js'))
const { combineDataPacks } = await import(mod('modules/teamSimulation/dataPack.js'))
const { dpsWindowFrames, DPS_STANDARD } = await import(mod('modules/teamSimulation/dpsStandard.js'))
const { simulateTeam } = await import(mod('modules/teamSimulation/teamRun.js'))

/**
 * 纯岩四人的端到端：名录包（普攻）+ 人工核对动作（战技/爆发）→ 合并 → 面板 → 时间线 → 结算。
 *
 * 数值本身不是这一轮的验收目标（面板是合成的），要验的是「整条管线在真实数据上能跑通、
 * 能量与命中按轴成立、标准口径与诊断口径各自给出该给的东西」。
 */
const KEYS = ['zhongli', 'albedo', 'gorou', 'aratakiitto']
const packs = KEYS.map(key => JSON.parse(readFileSync(`data/team-sim/packs/${key}.json`, 'utf8')))
const merged = combineDataPacks(packs)
assert.equal(merged.status, 'ok', JSON.stringify(merged.issues))
const pack = merged.pack
assert.equal(pack.gameVersion, '7.1')

// 人工核对动作必须真的落进包里：三个人的战技与爆发都在；一斗的爆发本身不造成伤害，只落战技。
for (const key of ['zhongli', 'albedo', 'gorou']) {
  assert.ok(pack.actions[`${key}.skill`], `${key} 缺少战技动作`)
  assert.ok(pack.actions[`${key}.burst`], `${key} 缺少爆发动作`)
  assert.equal(pack.actions[`${key}.skill`].kind, 'skill')
  assert.equal(pack.actions[`${key}.burst`].kind, 'burst')
  assert.equal(pack.actions[`${key}.skill`].actorId, key)
  assert.equal(pack.actions[`${key}.burst`].actorId, key)
}
assert.ok(pack.actions['aratakiitto.skill'])
assert.equal(pack.actions['aratakiitto.burst'], undefined, '一斗爆发没有直接伤害，不该有命中数据')

const slots = ['flower', 'plume', 'sands', 'goblet', 'circlet']
const mains = [{ key: 'hp', value: 4780 }, { key: 'atk', value: 311 }, { key: 'defPct', value: 0.583 }, { key: 'geo', value: 0.466 }, { key: 'cdmg', value: 0.622 }]
const subs = [[{ key: 'cpct', value: 0.078 }], [{ key: 'cdmg', value: 0.14 }], [{ key: 'cpct', value: 0.07 }], [{ key: 'atkPct', value: 0.1 }], [{ key: 'recharge', value: 0.05 }]]

function makeBuild(key, index) {
  const build = {
    schemaVersion: 1, actorId: key, characterId: `char:${key}`, name: key, element: 'geo',
    level: 90, ascension: 6, constellation: 0,
    talents: { normal: 10, skill: 10, burst: 10 },
    weapon: { id: `weapon:${key}`, name: 'Synthetic Weapon', level: 90, ascension: 6, refinement: 1 },
    artifacts: slots.map((slot, i) => ({ slot, name: `Artifact ${slot}`, setId: 'fixture-set', rarity: 5, level: 20, main: mains[i], sub: subs[i] })),
    requiredEffects: [], provenance: { provider: 'synthetic-fixture', providerVersion: null, sourceTime: null }
  }
  build.requiredEffects = requiredEffectSources(build)
  return build
}

function makeData(build, index) {
  const charSource = `character:${build.characterId}:a${build.ascension}`
  return {
    gameVersion: '7.1', bundleId: 'fixture-bundle-geo', source: 'fixture-maintained-data',
    character: { id: build.characterId, level: 90, ascension: 6, base: { hp: 13000 + index * 500, atk: 260 + index * 10, def: 800 + index * 10 }, bonuses: [] },
    weapon: { id: build.weapon.id, level: 90, ascension: 6, baseAtk: 510 + index * 10, bonuses: [] },
    effects: Object.fromEntries(build.requiredEffects.map(e => [e.id,
      e.id === charSource ? { status: 'verified-static', modifiers: [{ key: 'atkPct', value: 0.1 }], runtimeRequired: false }
        : { status: 'known-no-static', modifiers: [], runtimeRequired: false }]))
  }
}

const expected = { gameVersion: '7.1', bundleId: 'fixture-bundle-geo', source: 'fixture-maintained-data' }
const members = KEYS.map((key, index) => ({ build: makeBuild(key, index), permanentData: makeData(makeBuild(key, index), index) }))
const panels = members.map(({ build, permanentData }) => {
  const panel = buildPermanentStats(build, permanentData, expected)
  assert.equal(panel.status, 'permanent-ready', JSON.stringify(panel))
  return panel
})
assert.equal(panels.length, 4)

const framesOf = action => (action.timing && action.timing.type === 'frames' ? action.timing.frames : 40)

// 标准口径：0 能量开局，只放战技与普攻（攒不够爆发能量，就不该出现爆发步骤）。
const standardSteps = []
let at = 0
KEYS.forEach((key, index) => {
  if (index > 0) standardSteps.push({ id: `sw-${key}`, kind: 'switch', actorId: key, atFrame: at })
  standardSteps.push({ id: `sk-${key}`, kind: 'action', actorId: key, actionId: `${key}.skill`, atFrame: at })
  at += framesOf(pack.actions[`${key}.skill`]) + 2
})
const normalIds = Object.keys(pack.actions).filter(id => id.startsWith('aratakiitto.normal-')).sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))
let n = 0
while (at < 7100) {
  const id = normalIds[n % normalIds.length]
  standardSteps.push({ id: `na-${n}`, kind: 'action', actorId: 'aratakiitto', actionId: id, atFrame: at })
  at += framesOf(pack.actions[id]) + 1
  n++
}
assert.ok(n > 20, `普攻循环次数太少：${n}`)

const standardRotation = {
  id: 'rotation:geo-standard', scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'],
  measurementEndFrame: dpsWindowFrames(FRAME_TIERS['fps-60']),
  steps: standardSteps,
  actors: KEYS.map(key => ({ actorId: key, energy: 0, energyMax: 80 })),
  activeActorId: 'zhongli'
}

const crit = 'expected'
const debuffs = { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
const standard = simulateTeam({ pack, rotation: standardRotation, members, expected, targetPresetId: DPS_STANDARD.targetId, crit, debuffs })
assert.equal(standard.status, 'calculated', JSON.stringify(standard.issues))
assert.equal(standard.mode, 'dps-standard')
assert.ok(standard.checks.every(c => c.status === 'ok'), JSON.stringify(standard.checks))
assert.ok(standard.dps && standard.dps.value > 0, JSON.stringify(standard.dps))
assert.ok(Math.abs(standard.dps.windowSeconds - 120) < 0.05, `窗口秒数应约等于 120，实际 ${standard.dps.windowSeconds}`)
assert.ok(standard.timeline.hits.length > 20)
// 四个人都真的在轴上出过手，能量披露覆盖全员。
assert.deepEqual([...new Set(standard.timeline.hits.map(h => h.actorId))].sort(), [...KEYS].sort())
assert.deepEqual(standard.energy.map(e => e.actorId).sort(), [...KEYS].sort())
for (const row of standard.energy) {
  assert.ok(row.end >= row.start, `${row.actorId} 能量不可能减少（没有消耗步骤）`)
  assert.ok(row.end <= row.max)
}
// 战技一定要产球：产球动作在结算记录里，且落地后有增益。
const particleRows = standard.timeline.events.filter(e => e.phase === 'energy')
// 每个产球声明记一条事件；一斗的 E 按图鉴概率拆成「3 颗 50% + 4 颗 50%」两条，
// 所以一共 4 条，期望微粒数 = 1×0.67 + 2 + 3×0.5 + 4×0.5 = 6.17。
assert.equal(particleRows.length, 4)
const expectedParticles = particleRows.reduce((sum, row) => sum + row.detail.count * (row.detail.chance ?? 1), 0)
assert.ok(Math.abs(expectedParticles - 6.17) < 1e-9, `期望微粒数 ${expectedParticles}`)

// 诊断口径：给钟离满能量放爆发，验证爆发命中与能量扣减；诊断模式不报 DPS。
const burstRotation = {
  id: 'rotation:geo-burst', scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'], measurementEndFrame: 900,
  steps: [{ id: 'q-zhongli', kind: 'action', actorId: 'zhongli', actionId: 'zhongli.burst', atFrame: 0 }],
  actors: [{ actorId: 'zhongli', energy: 40, energyMax: 40 }],
  activeActorId: 'zhongli'
}
const burstMembers = members.filter(m => m.build.actorId === 'zhongli')
const burst = simulateTeam({ pack, rotation: burstRotation, members: burstMembers, expected, targetPresetId: 'dummy-lv100', crit, debuffs, mode: 'diagnostic' })
assert.equal(burst.status, 'calculated', JSON.stringify(burst.issues))
assert.equal(burst.dps, null)
assert.ok(burst.timeline.hits.length > 0, '爆发应当有命中记录')
assert.equal(burst.energy[0].end, 0, `爆发应扣掉 40 点能量：${JSON.stringify(burst.energy[0])}`)
assert.ok(burst.damage.rows.every(r => r.actorId === 'zhongli'))

console.log(JSON.stringify({
  standardDps: standard.dps.value,
  standardHits: standard.timeline.hits.length,
  particles: particleRows.length,
  burstHits: burst.timeline.hits.length,
  burstDamage: burst.damage.total
}))
