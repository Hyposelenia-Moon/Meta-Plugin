/**
 * 转换式 4 件套（2026-11-02 切片 4）：绝缘之旗印 400184。
 *
 * 4 件套：元素爆发伤害 + 元素充能效率的 25%，最多 +75%。
 * 依赖组装后的充能效率，所以在 buildPermanentStats 组装完面板后折算。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS } = await import(mod('modules/teamSimulation/timeline.js'))
const { requiredEffectSources, buildPermanentStats } = await import(mod('modules/teamSimulation/build.js'))
const { simulateTeam } = await import(mod('modules/teamSimulation/teamRun.js'))

const slots = ['flower', 'plume', 'sands', 'goblet', 'circlet']
const expected = { gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data' }

function makeBuild (rechargeSubs, setCount) {
  const subs = rechargeSubs.map(v => [{ key: 'recharge', value: v }])
  const build = {
    schemaVersion: 1, actorId: 'actor:0', characterId: 'char:fixture-0', name: 'Synthetic 0', element: 'geo',
    level: 90, ascension: 6, constellation: 0,
    talents: { normal: 9, skill: 9, burst: 9 },
    weapon: { id: 'weapon:fixture-0', name: 'Synthetic Weapon', level: 90, ascension: 6, refinement: 1 },
    artifacts: slots.map((slot, i) => ({
      slot, name: `Artifact ${slot}`, setId: i < setCount ? '400184' : '400089', rarity: 5, level: 20,
      main: [{ key: 'hp', value: 4780 }, { key: 'atk', value: 311 }, { key: 'defPct', value: 0.2 }, { key: 'geo', value: 0.466 }, { key: 'cdmg', value: 0.62 }][i],
      sub: subs[i]
    })),
    requiredEffects: [], provenance: { provider: 'synthetic-fixture', providerVersion: null, sourceTime: null }
  }
  build.requiredEffects = requiredEffectSources(build)
  return build
}

function makeData (build) {
  const charSource = `character:${build.characterId}:a${build.ascension}`
  const data = {
    gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data',
    character: { id: build.characterId, level: 90, ascension: 6, base: { hp: 10000, atk: 300, def: 700 }, bonuses: [] },
    weapon: { id: build.weapon.id, level: 90, ascension: 6, baseAtk: 500, bonuses: [] },
    effects: Object.fromEntries(build.requiredEffects.map(e => [e.id,
      e.id === charSource ? { status: 'verified-static', modifiers: [], runtimeRequired: false } : { status: 'known-no-static', modifiers: [], runtimeRequired: false }]))
  }
  return data
}

// ---------- 1. 折算 ----------
const build = makeBuild([0.1, 0.1, 0.1, 0.1, 0.1], 5)
const data = makeData(build)
const permanent = buildPermanentStats(build, data, expected)
assert.equal(permanent.status, 'permanent-ready', JSON.stringify(permanent.issues))
const expectedBonus = Math.min(0.25 * permanent.stats.recharge, 0.75)
assert.ok(Math.abs((permanent.stats.burstDmg ?? 0) - expectedBonus) < 1e-9,
  `burstDmg ${permanent.stats.burstDmg} 应为 ${expectedBonus}（充能 ${permanent.stats.recharge}）`)
assert.ok(permanent.trace.some(t => t.source === 'artifact-set:400184:4pc' && t.key === 'burstDmg'))
assert.equal((permanent.unmodeled ?? []).some(u => String(u.id).includes('400184')), false, '绝缘 4 件套不应再报未建模')

// ---------- 2. 不足 4 件不折算 ----------
const partial = buildPermanentStats(makeBuild([0.1, 0.1, 0.1, 0.1, 0.1], 3), makeData(makeBuild([0.1, 0.1, 0.1, 0.1, 0.1], 3)), expected)
assert.equal(partial.status, 'permanent-ready', JSON.stringify(partial.issues))
assert.equal(partial.stats.burstDmg ?? 0, 0, '不足 4 件不应有绝缘换算')

// ---------- 3. 封顶 75% ----------
const capped = buildPermanentStats(makeBuild([0.5, 0.5, 0.5, 0.5, 0.5], 5), makeData(makeBuild([0.5, 0.5, 0.5, 0.5, 0.5], 5)), expected)
assert.equal(capped.status, 'permanent-ready', JSON.stringify(capped.issues))
assert.equal(capped.stats.burstDmg, 0.75, `封顶应为 0.75，实际 ${capped.stats.burstDmg}（充能 ${capped.stats.recharge}）`)

// ---------- 4. 爆发伤害真的变高 ----------
const pack = {
  schemaVersion: 1, gameVersion: '6.0-synthetic', source: 'synthetic-pack',
  actions: {
    'actor0.burst': { id: 'actor0.burst', actorId: 'actor:0', kind: 'burst', timing: { type: 'frames', frames: 40 }, energyCost: 0, hits: [{ atFrame: 20, motionValue: 3, scaling: 'atk', element: 'geo', canCrit: true }] },
    'actor0.normal-1': { id: 'actor0.normal-1', actorId: 'actor:0', kind: 'normal', timing: { type: 'frames', frames: 36 }, hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true }] }
  }
}
const rotation = {
  id: 'rotation:convert', scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'], measurementEndFrame: 200,
  steps: [
    { id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'actor0.burst', atFrame: 0 },
    { id: 's2', kind: 'action', actorId: 'actor:0', actionId: 'actor0.normal-1', atFrame: 60 }
  ],
  actors: [{ actorId: 'actor:0', energy: 0, energyMax: 60 }],
  activeActorId: 'actor:0'
}
function damageWith (permanentData, b) {
  const run = simulateTeam({
    pack, rotation, members: [{ build: b, permanentData }],
    expected, targetPresetId: 'dummy-lv100', crit: 'expected',
    debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
    mode: 'diagnostic'
  })
  assert.equal(run.status, 'calculated', JSON.stringify(run.issues))
  return {
    burst: run.damage.rows.find(r => r.actionId === 'actor0.burst').damage,
    normal: run.damage.rows.find(r => r.actionId === 'actor0.normal-1').damage
  }
}
const withEmblem = damageWith(data, build)
const plainBuild = makeBuild([0.1, 0.1, 0.1, 0.1, 0.1], 0)
const plainData = makeData(plainBuild)
const plainStats = buildPermanentStats(plainBuild, plainData, expected)
const plain = damageWith(plainData, plainBuild)
const bonus = (permanent.stats.burstDmg ?? 0)
// 两套面板的攻击力/本套加成不同，按「攻击力 × (1 + 属伤 + 类型加成)」推算理论比值
const geo = permanent.stats.geo
const atkEmb = permanent.stats.atk
const atkPlain = plainStats.stats.atk
const expectedBurstRatio = (atkEmb * (1 + geo + bonus)) / (atkPlain * (1 + geo + (plainStats.stats.burstDmg ?? 0)))
const expectedNormalRatio = (atkEmb * (1 + geo + (permanent.stats.normalDmg ?? 0))) / (atkPlain * (1 + geo + (plainStats.stats.normalDmg ?? 0)))
assert.ok(Math.abs(withEmblem.burst / plain.burst - expectedBurstRatio) < 1e-6,
  `爆发增幅 ${withEmblem.burst / plain.burst} 应为 ${expectedBurstRatio}（绝缘面板 ${atkEmb} / 对照 ${atkPlain}，4pc +${bonus}）`)
assert.ok(Math.abs(withEmblem.normal / plain.normal - expectedNormalRatio) < 1e-6,
  `普攻增幅应只有面板差，不含爆发加成：${withEmblem.normal / plain.normal} vs ${expectedNormalRatio}`)

console.log('绝缘之旗印 4 件套：充能转爆发伤害、4 件门槛与 75% 封顶均按口径')
