/**
 * 百分比面板通道（2026-11-02 切片 3）。
 *
 * 1) `applyPanelModifiers` 把 atkPct/hpPct/defPct 按基础面板折算成点数；缺 base 时记 0。
 * 2) 宗室 4 件套（400119）：爆发起手触发，全队攻击力 +20%，只影响之后的伤害。
 * 3) 千岩 4 件套（400169）：战技命中触发（skill-hit），触发事件带 source。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS } = await import(mod('modules/teamSimulation/timeline.js'))
const { requiredEffectSources, buildPermanentStats } = await import(mod('modules/teamSimulation/build.js'))
const { applyPanelModifiers } = await import(mod('modules/teamSimulation/effects.js'))
const { simulateTeam } = await import(mod('modules/teamSimulation/teamRun.js'))

// ---------- 1. 单位：pct 折算 ----------
{
  const stats = { hp: 14000, atk: 1000, def: 700, mastery: 0, cpct: 0.05, cdmg: 0.5, recharge: 1, dmg: 0, phy: 0, heal: 0, pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0, dendro: 0 }
  const withBase = applyPanelModifiers(stats, { atkPct: 0.2, hpPct: 0.1, defPct: 0.1 }, { hp: 14000, atk: 1000, def: 700 })
  assert.equal(withBase.atk, 1200)
  assert.equal(withBase.hp, 15400)
  assert.equal(withBase.def, 770)
  const noBase = applyPanelModifiers(stats, { atkPct: 0.2 })
  assert.equal(noBase.atk, 1000, '缺 base 时 pct 记 0，由调用方负责校验')
}

// ---------- 2/3. teamRun ----------
const slots = ['flower', 'plume', 'sands', 'goblet', 'circlet']
const mains = [{ key: 'hp', value: 4780 }, { key: 'atk', value: 311 }, { key: 'defPct', value: 0.2 }, { key: 'hydro', value: 0.466 }, { key: 'cdmg', value: 0.62 }]
const subs = [[{ key: 'hpPct', value: 0.05 }], [{ key: 'atkPct', value: 0.1 }], [{ key: 'mastery', value: 20 }], [{ key: 'cpct', value: 0.07 }], [{ key: 'recharge', value: 0.1 }]]

function makeBuild (index, setIds) {
  const build = {
    schemaVersion: 1, actorId: `actor:${index}`, characterId: `char:fixture-${index}`, name: `Synthetic ${index}`, element: 'geo',
    level: 90, ascension: 6, constellation: 1,
    talents: { normal: 9, skill: 9, burst: 9 },
    weapon: { id: `weapon:fixture-${index}`, name: 'Synthetic Weapon', level: 90, ascension: 6, refinement: 1 },
    artifacts: slots.map((slot, i) => ({ slot, name: `Artifact ${slot}`, setId: setIds[i], rarity: 5, level: 20, main: mains[i], sub: subs[i] })),
    requiredEffects: [], provenance: { provider: 'synthetic-fixture', providerVersion: null, sourceTime: null }
  }
  build.requiredEffects = requiredEffectSources(build)
  return build
}

function makeData (build, index) {
  const charSource = `character:${build.characterId}:a${build.ascension}`
  return {
    gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data',
    character: { id: build.characterId, level: 90, ascension: 6, base: { hp: 10000 + index * 100, atk: 300 + index * 10, def: 700 + index * 10 }, bonuses: [] },
    weapon: { id: build.weapon.id, level: 90, ascension: 6, baseAtk: 500 + index * 10, bonuses: [] },
    effects: Object.fromEntries(build.requiredEffects.map(e => [e.id,
      e.id === charSource ? { status: 'verified-static', modifiers: [], runtimeRequired: false } : { status: 'known-no-static', modifiers: [], runtimeRequired: false }]))
  }
}

function run (runtimeEffects) {
  const build = makeBuild(0, ['400119', '400119', '400119', '400119', '400119'])
  const permanentData = makeData(build, 0)
  if (runtimeEffects) permanentData.runtimeEffects = runtimeEffects
  const pack = {
    schemaVersion: 1, gameVersion: '6.0-synthetic', source: 'synthetic-pack',
    actions: {
      'actor0.burst': { id: 'actor0.burst', actorId: 'actor:0', kind: 'burst', timing: { type: 'frames', frames: 40 }, energyCost: 0, hits: [{ atFrame: 20, motionValue: 3, scaling: 'atk', element: 'geo', canCrit: true }] },
      'actor0.skill': { id: 'actor0.skill', actorId: 'actor:0', kind: 'skill', timing: { type: 'frames', frames: 30 }, cooldownFrames: 600, cooldownId: 'skill', hits: [{ atFrame: 10, motionValue: 2, scaling: 'atk', element: 'geo', canCrit: true }] },
      'actor0.normal-1': { id: 'actor0.normal-1', actorId: 'actor:0', kind: 'normal', timing: { type: 'frames', frames: 36 }, hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true }] }
    }
  }
  const rotation = {
    id: 'rotation:pct', scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'], measurementEndFrame: 200,
    steps: [
      { id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'actor0.burst', atFrame: 0 },
      { id: 's2', kind: 'action', actorId: 'actor:0', actionId: 'actor0.normal-1', atFrame: 60 }
    ],
    actors: [{ actorId: 'actor:0', energy: 0, energyMax: 60 }],
    activeActorId: 'actor:0'
  }
  const members = [{ build, permanentData }]
  return {
    run: simulateTeam({
      pack, rotation, members,
      expected: { gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data' },
      targetPresetId: 'dummy-lv100', crit: 'expected',
      debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
      mode: 'diagnostic'
    }),
    permanent: buildPermanentStats(build, permanentData, { gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data' })
  }
}

const plain = run(null)
assert.equal(plain.run.status, 'calculated', JSON.stringify(plain.run.issues))

// 宗室：爆发起手触发，普攻吃全队 +20% 攻击力
const royal = run({
  'artifact-set:400119:4pc': { id: 'artifact-set:400119:4pc', target: 'team', stats: { atkPct: 0.2 }, durationFrames: 720, trigger: 'cast-burst', stacking: 'ignore' }
})
assert.equal(royal.run.status, 'calculated', JSON.stringify(royal.run.issues))
const fired = royal.run.timeline.triggers.filter(t => t.effectId === 'artifact-set:400119:4pc')
assert.equal(fired.length, 1, '施放爆发应触发宗室 4 件套')
assert.equal(fired[0].frame, 0)
assert.equal(royal.run.timeline.events.find(e => e.detail?.effectId === 'artifact-set:400119:4pc' && e.phase === 'trigger')?.detail?.source, 'cast')

const baseAtk = royal.permanent.base.atk
const statsAtk = royal.permanent.stats.atk
const normalPlain = plain.run.damage.rows.find(r => r.actionId === 'actor0.normal-1').damage
const normalRoyal = royal.run.damage.rows.find(r => r.actionId === 'actor0.normal-1').damage
const expectedRatio = (statsAtk + baseAtk * 0.2) / statsAtk
assert.ok(Math.abs(normalRoyal / normalPlain - expectedRatio) < 1e-9,
  `普攻增幅 ${normalRoyal / normalPlain} 应为 ${expectedRatio}（白值 ${baseAtk} / 面板 ${statsAtk}）`)

// 千岩：战技命中触发 skill-hit
function runSkill (runtimeEffects) {
  const build = makeBuild(0, ['400169', '400169', '400169', '400169', '400169'])
  const permanentData = makeData(build, 0)
  if (runtimeEffects) permanentData.runtimeEffects = runtimeEffects
  const pack = {
    schemaVersion: 1, gameVersion: '6.0-synthetic', source: 'synthetic-pack',
    actions: {
      'actor0.skill': { id: 'actor0.skill', actorId: 'actor:0', kind: 'skill', timing: { type: 'frames', frames: 30 }, cooldownFrames: 600, cooldownId: 'skill', hits: [{ atFrame: 10, motionValue: 2, scaling: 'atk', element: 'geo', canCrit: true }] },
      'actor0.normal-1': { id: 'actor0.normal-1', actorId: 'actor:0', kind: 'normal', timing: { type: 'frames', frames: 36 }, hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true }] }
    }
  }
  const rotation = {
    id: 'rotation:millelith', scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'], measurementEndFrame: 200,
    steps: [
      { id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'actor0.skill', atFrame: 0 },
      { id: 's2', kind: 'action', actorId: 'actor:0', actionId: 'actor0.normal-1', atFrame: 80 }
    ],
    actors: [{ actorId: 'actor:0', energy: 0, energyMax: 60 }],
    activeActorId: 'actor:0'
  }
  return simulateTeam({
    pack, rotation, members: [{ build, permanentData }],
    expected: { gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data' },
    targetPresetId: 'dummy-lv100', crit: 'expected',
    debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
    mode: 'diagnostic'
  })
}

const skillPlain = runSkill(null)
const skillMille = runSkill({ 'artifact-set:400169:4pc': { id: 'artifact-set:400169:4pc', target: 'team', stats: { atkPct: 0.2 }, durationFrames: 180, trigger: 'skill-hit', stacking: 'refresh' } })
assert.equal(skillMille.status, 'calculated', JSON.stringify(skillMille.issues))
const milleTrigger = skillMille.timeline.triggers.filter(t => t.effectId === 'artifact-set:400169:4pc')
assert.equal(milleTrigger.length, 1, '战技命中应触发千岩 4 件套')
assert.equal(milleTrigger[0].frame, 10, '触发帧等于战技命中帧')
assert.equal(skillMille.timeline.events.find(e => e.detail?.effectId === 'artifact-set:400169:4pc' && e.phase === 'trigger')?.detail?.source, 'skill-hit')
const skillRowPlain = skillPlain.damage.rows.find(r => r.actionId === 'actor0.skill').damage
const skillRowMille = skillMille.damage.rows.find(r => r.actionId === 'actor0.skill').damage
assert.ok(Math.abs(skillRowMille - skillRowPlain) < 1e-9, '战技自身不吃自己触发的加成')
const normalSkillPlain = skillPlain.damage.rows.find(r => r.actionId === 'actor0.normal-1').damage
const normalSkillMille = skillMille.damage.rows.find(r => r.actionId === 'actor0.normal-1').damage
assert.ok(normalSkillMille > normalSkillPlain, '战技命中之后的普攻应吃到 +20% 攻击力')

console.log('百分比面板通道：atkPct 折算、宗室爆发触发、千岩战技命中触发口径就绪')
