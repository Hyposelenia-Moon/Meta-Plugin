/**
 * 触发式 4 件套（2026-11-02 切片 2）。
 *
 * 1) 永久数据：沉沦之心 4 件套写进 `runtimeEffects`（trigger / 数值 / 时长）；
 * 2) 时间轴：施放战技当帧激活，之后 15 秒内的普攻吃 +30%，战技自身不吃；
 * 3) teamRun：只并入真正穿在身上的套装，没穿的那套不触发。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS } = await import(mod('modules/teamSimulation/timeline.js'))
const { requiredEffectSources, buildPermanentStats } = await import(mod('modules/teamSimulation/build.js'))
const { simulateTeam } = await import(mod('modules/teamSimulation/teamRun.js'))
const { buildRuntimePermanent } = await import(mod('model/PermanentSource.js'))

// ---------- 1. 永久数据 ----------
{
  const runtime = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: '13407', refinement: 1 })
  assert.equal(runtime.ok, true)
  const spec = runtime.data.runtimeEffects?.['artifact-set:400164:4pc']
  assert.ok(spec, '沉沦 4 件套应出现在 runtimeEffects')
  assert.equal(spec.trigger, 'cast-skill')
  assert.equal(spec.target, 'self')
  assert.equal(spec.stats.normalDmg, 0.3)
  assert.equal(spec.stats.chargedDmg, 0.3)
  assert.equal(spec.durationFrames, 900)
  const audit = runtime.data.effects['artifact-set:400164:4pc']
  assert.equal(audit.status, 'verified-static')
  assert.equal(audit.runtimeRequired, true)
  assert.equal(audit.unmodeled, undefined, '已建模的运行时效果不能再写未建模原因')
}

// ---------- 2/3. 时间轴与 teamRun ----------
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

/** 两个角色都穿 400164，但只有 0 号的永久数据里登记了 runtimeEffects。 */
function buildRun (withRuntimeEffects) {
  const setIds = ['400164', '400164', '400164', '400164', '400164']
  const members = [makeBuild(0, setIds), makeBuild(1, setIds)].map((build, index) => {
    const permanentData = makeData(build, index)
    if (withRuntimeEffects && index === 0) {
      permanentData.runtimeEffects = {
        'artifact-set:400164:4pc': { id: 'artifact-set:400164:4pc', target: 'self', stats: { normalDmg: 0.3, chargedDmg: 0.3 }, durationFrames: 900, trigger: 'cast-skill' },
        'artifact-set:400119:4pc': { id: 'artifact-set:400119:4pc', target: 'self', stats: { normalDmg: 0.9 }, durationFrames: 900, trigger: 'cast-burst' }
      }
    }
    return { build, permanentData }
  })
  const pack = {
    schemaVersion: 1, gameVersion: '6.0-synthetic', source: 'synthetic-pack',
    actions: {
      'actor0.skill': { id: 'actor0.skill', actorId: 'actor:0', kind: 'skill', timing: { type: 'frames', frames: 30 }, cooldownFrames: 600, cooldownId: 'skill', hits: [{ atFrame: 10, motionValue: 2, scaling: 'atk', element: 'geo', canCrit: true }] },
      'actor0.normal-1': { id: 'actor0.normal-1', actorId: 'actor:0', kind: 'normal', timing: { type: 'frames', frames: 36 }, hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true }] }
    }
  }
  const rotation = {
    id: 'rotation:triggered', scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'], measurementEndFrame: 120,
    steps: [
      { id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'actor0.skill', atFrame: 0 },
      { id: 's2', kind: 'action', actorId: 'actor:0', actionId: 'actor0.normal-1', atFrame: 40 }
    ],
    actors: [{ actorId: 'actor:0', energy: 0, energyMax: 60 }],
    activeActorId: 'actor:0'
  }
  return simulateTeam({
    pack, rotation, members,
    expected: { gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data' },
    targetPresetId: 'dummy-lv100', crit: 'expected',
    debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
    mode: 'diagnostic'
  })
}

const without = buildRun(false)
assert.equal(without.status, 'calculated', JSON.stringify(without.issues))
const withEffects = buildRun(true)
assert.equal(withEffects.status, 'calculated', JSON.stringify(withEffects.issues))

const triggered = withEffects.timeline.triggers.filter(t => t.effectId === 'artifact-set:400164:4pc')
assert.equal(triggered.length, 1, '施放战技应触发一次沉沦 4 件套')
assert.equal(triggered[0].frame, 0)
assert.equal(withEffects.timeline.triggers.some(t => t.effectId === 'artifact-set:400119:4pc'), false, '没穿宗室不能触发')

const hitOf = (run, actionId) => run.damage.rows.find(r => r.actionId === actionId && r.origin === 'action')
const skillWithout = hitOf(without, 'actor0.skill').damage
const skillWith = hitOf(withEffects, 'actor0.skill').damage
assert.ok(Math.abs(skillWith - skillWithout) < 1e-9, '战技自身不吃普攻加成')

const normalWithout = hitOf(without, 'actor0.normal-1')
const normalWith = hitOf(withEffects, 'actor0.normal-1')
assert.ok(normalWith.damage > normalWithout.damage, '战技之后的普攻应吃到 +30%')
// 这套面板没有岩伤/通用增伤，所以普攻就是裸 1.3 倍。
assert.ok(Math.abs(normalWith.damage / normalWithout.damage - 1.3) < 1e-9,
  `普攻增幅 ${normalWith.damage / normalWithout.damage} 应为 1.3`)

console.log('触发式 4 件套：施放战技触发、普攻吃加成、未穿套装不触发')
