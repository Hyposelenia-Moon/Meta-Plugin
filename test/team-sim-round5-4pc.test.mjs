/**
 * 第 5 轮：翠绿/磐岩/饰金/烬城/黑曜/穹境/纺月/晨星/天之美赐/血红/炉火。
 * 只测能确定的通道：夜魂消耗触发、晶片拾取触发、按反应族加成的月/星伤害、按元素/月相的登记。
 * 数值近似与未建模部分已写进各套 `unmodeled`，这里不重复断言。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))
const { buildRuntimePermanent } = await import(mod('model/PermanentSource.js'))

const baseStats = {
  hp: 20000,
  atk: 1000,
  def: 800,
  mastery: 0,
  cpct: 0,
  cdmg: 1,
  recharge: 1,
  dmg: 0,
  phy: 0,
  heal: 0,
  pyro: 0,
  hydro: 0,
  electro: 0,
  cryo: 0,
  anemo: 0,
  geo: 0,
  dendro: 0
}

const context = { level: 90, targetPresetId: 'dummy-lv100', crit: 'expected', gameVersion: '7.1', source: 'round5-test', stats: baseStats, debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 } }

function run ({ effects, triggers, actions, steps, endFrame = 200, extra = {} }) {
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    effects,
    effectTriggers: triggers,
    actors: [{ actorId: 'a', energy: 0, energyMax: 60 }],
    activeActorId: 'a',
    measurementEndFrame: endFrame,
    steps,
    ...extra
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const damage = calculateTimelineDamage({ timeline, contexts: { a: context } })
  assert.equal(damage.status, 'calculated', JSON.stringify(damage.issues))
  return { timeline, damage }
}

const normalHit = (extra = {}) => ({
  'a.normal-1': {
    id: 'a.normal-1',
    actorId: 'a',
    kind: 'normal',
    timing: { type: 'frames', frames: 60 },
    hits: [{ atFrame: 10, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: true }],
    ...extra
  }
})

// ---------- 1. 11 套都登记进了运行时效果表 ----------
{
  const result = buildRuntimePermanent({ characterId: '10000002', name: '神里绫华', weaponId: '11401', refinement: 1 })
  assert.equal(result.ok, true, JSON.stringify(result))
  const runtime = result.data.runtimeEffects ?? {}
  const ids = [
    'artifact-set:400094:4pc',
    'artifact-set:400154:4pc',
    'artifact-set:400214:4pc',
    'artifact-set:400321:4pc',
    'artifact-set:400331:4pc',
    'artifact-set:400361:4pc',
    'artifact-set:400361:4pc-full',
    'artifact-set:400371:4pc',
    'artifact-set:400371:4pc-full',
    'artifact-set:400381:4pc',
    'artifact-set:400381:4pc-full',
    'artifact-set:400401:4pc',
    'artifact-set:400421:4pc',
    'artifact-set:400431:4pc'
  ]
  for (const id of ids) assert.ok(runtime[id], `缺少 ${id}`)
  assert.equal(runtime['artifact-set:400331:4pc'].trigger, 'nightsoul-consume')
  assert.deepEqual(runtime['artifact-set:400421:4pc'].reactionKinds, ['stellar-swirl'])
  assert.equal(runtime['artifact-set:400361:4pc'].requiresMoonPhase, 'initial')
  assert.equal(runtime['artifact-set:400361:4pc-full'].requiresMoonPhase, 'full')
  // 翠绿的减抗已由运行时效果（400094:4pc-shred）承接，审计条目只剩口径说明。
  assert.equal(result.data.runtimeEffects['artifact-set:400094:4pc-shred'].trigger, 'reaction')
  assert.deepEqual(result.data.runtimeEffects['artifact-set:400094:4pc-shred'].resistanceShred, { value: 0.4, from: 'reaction-aura' })
}

// ---------- 2. 黑曜秘典：夜魂消耗后暴击率 +40% ----------
{
  const effects = { 'artifact-set:400331:4pc': { id: 'artifact-set:400331:4pc', target: 'self', trigger: 'nightsoul-consume', stacking: 'refresh', durationFrames: 360, icdFrames: 60, stats: { cpct: 0.4 } } }
  const triggers = [{ effectId: 'artifact-set:400331:4pc', actorId: 'a', on: 'nightsoul-consume' }]
  const actions = normalHit({ nightsoulConsume: { atFrame: 5, points: 1 } })
  const steps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.normal-1', atFrame: 0 }]
  const withNightSoul = run({ effects, triggers, actions, steps })
  const without = run({ effects: {}, triggers: [], actions: normalHit(), steps })
  const ratio = withNightSoul.damage.rows[0].damage / without.damage.rows[0].damage
  assert.ok(Math.abs(ratio - 1.4) < 1e-9, `暴击率 +40% 应按 0.4×1.0 放大到 1.4，实际 ${ratio}`)
  const triggerEvents = withNightSoul.timeline.events.filter(event => event.kind === 'trigger' && event.detail?.source === 'nightsoul-consume')
  assert.equal(triggerEvents.length, 1)
}

// ---------- 3. 磐岩：拾取晶片后全队 +35% ----------
{
  const effects = { 'artifact-set:400154:4pc': { id: 'artifact-set:400154:4pc', target: 'team', trigger: 'shard-pickup', stacking: 'refresh', durationFrames: 600, stats: { dmg: 0.35 } } }
  const triggers = [{ effectId: 'artifact-set:400154:4pc', actorId: 'a', on: 'shard-pickup' }]
  const actions = normalHit({ shardPickup: { atFrame: 5, element: 'pyro' } })
  const steps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.normal-1', atFrame: 0 }]
  const withShard = run({ effects, triggers, actions, steps })
  const without = run({ effects: {}, triggers: [], actions: normalHit(), steps })
  const ratio = withShard.damage.rows[0].damage / without.damage.rows[0].damage
  assert.ok(Math.abs(ratio - 1.35) < 1e-9, `晶片后 +35% 增伤，实际 ${ratio}`)
}

// ---------- 4. 翠绿之影：扩散反应伤害 +60% ----------
{
  const effects = { 'artifact-set:400094:4pc': { id: 'artifact-set:400094:4pc', target: 'self', trigger: 'always', stacking: 'refresh', reactionDmg: { swirl: 0.6, 'stellar-swirl': 0.2 } } }
  const actions = {
    'a.skill': {
      id: 'a.skill',
      actorId: 'a',
      kind: 'skill',
      timing: { type: 'frames', frames: 60 },
      hits: [{ atFrame: 10, motionValue: 1, scaling: 'atk', element: 'anemo', canCrit: false, reaction: { kind: 'swirl', aura: 'pyro' } }]
    }
  }
  const steps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  const triggers = [{ effectId: 'artifact-set:400094:4pc', actorId: 'a', on: 'always' }]
  const withSet = run({ effects, triggers, actions, steps })
  const without = run({ effects: {}, triggers: [], actions, steps })
  const rowWith = withSet.damage.rows.find(row => row.origin === 'reaction')
  const rowWithout = without.damage.rows.find(row => row.origin === 'reaction')
  const ratio = rowWith.damage / rowWithout.damage
  assert.ok(Math.abs(ratio - 1.6) < 1e-9, `扩散伤害应 ×1.6，实际 ${ratio}`)
}

// ---------- 5. 血红之证：星扩散触发后暴击率与星扩散伤害 ----------
{
  const effects = { 'artifact-set:400421:4pc': { id: 'artifact-set:400421:4pc', target: 'self', trigger: 'reaction', stacking: 'refresh', durationFrames: 600, reactionKinds: ['stellar-swirl'], stats: { cpct: 0.16 }, reactionDmg: { 'stellar-swirl': 0.4 } } }
  const triggers = [{ effectId: 'artifact-set:400421:4pc', actorId: 'a', on: 'reaction' }]
  const actions = {
    'a.skill': {
      id: 'a.skill',
      actorId: 'a',
      kind: 'skill',
      timing: { type: 'frames', frames: 60 },
      hits: [
        { atFrame: 10, motionValue: 1, scaling: 'atk', element: 'anemo', canCrit: false, reaction: { kind: 'stellar-swirl', aura: 'cryo' } },
        { atFrame: 30, motionValue: 1, scaling: 'atk', element: 'anemo', canCrit: false, reaction: { kind: 'stellar-swirl', aura: 'cryo' } }
      ]
    }
  }
  const steps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  const withSet = run({ effects, triggers, actions, steps })
  const without = run({ effects: {}, triggers: [], actions, steps })
  const rowsWith = withSet.damage.rows.filter(row => row.origin === 'reaction')
  const rowsWithout = without.damage.rows.filter(row => row.origin === 'reaction')
  assert.equal(rowsWith.length, 2, '两发都应产生星扩散行')
  // 触发发生在本发结算之后：第一发不吃加成，第二发吃 +40%。
  assert.ok(Math.abs(rowsWith[0].damage / rowsWithout[0].damage - 1) < 1e-9, '第一发应按触发前结算')
  const ratio = rowsWith[1].damage / rowsWithout[1].damage
  assert.ok(Math.abs(ratio - 1.4) < 1e-9, `星扩散伤害 +40%，实际 ${ratio}`)
  const triggersSeen = withSet.timeline.events.filter(event => event.kind === 'trigger' && event.detail?.source === 'reaction')
  assert.ok(triggersSeen.length >= 1, '血红应由星扩散触发')
}

// ---------- 6. 月相门控：纺月的初辉/满辉只生效一档 ----------
{
  const { createEffectRuntime } = await import(mod('modules/teamSimulation/effects.js'))
  const effects = {
    'artifact-set:400371:4pc': { id: 'artifact-set:400371:4pc', target: 'team', trigger: 'hit', stacking: 'refresh', durationFrames: 480, stats: { mastery: 60 }, requiresMoonPhase: 'initial' },
    'artifact-set:400371:4pc-full': { id: 'artifact-set:400371:4pc-full', target: 'team', trigger: 'hit', stacking: 'refresh', durationFrames: 480, stats: { mastery: 120 }, requiresMoonPhase: 'full' }
  }
  const runtime = createEffectRuntime(effects)
  runtime.trigger('artifact-set:400371:4pc', 0, 'a')
  runtime.trigger('artifact-set:400371:4pc-full', 0, 'a')
  const initial = runtime.modifiersAt('a', 0, { moonPhase: 'initial' })
  const full = runtime.modifiersAt('a', 0, { moonPhase: 'full' })
  assert.equal(initial.stats.mastery ?? 0, 60, '初辉只计 60 精通')
  assert.equal(full.stats.mastery ?? 0, 120, '满辉只计 120 精通')
}
