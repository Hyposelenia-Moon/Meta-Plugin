/**
 * 生命值条件与治疗事件（第 2 轮）：
 * - 战狂 400023：生命值低于 70% 时暴击率 +36%，比例由 `hpRatios` 给出；
 * - 逐影猎人 400261：生命值变化（治疗事件）触发暴击率 +12%，最多 3 层；
 * - 治疗事件本身作为数据通道验证：只在声明帧发生、写入 `heal` 事件。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))
const { createEffectRuntime } = await import(mod('modules/teamSimulation/effects.js'))
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

const context = { level: 90, targetPresetId: 'dummy-lv100', crit: 'expected', gameVersion: '7.1', source: 'hp-4pc-test', stats: baseStats, debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 } }

// ---------- 1. 运行时：hpRatio 过滤 ----------
{
  const runtime = createEffectRuntime({
    'artifact-set:400023:4pc': {
      id: 'artifact-set:400023:4pc',
      target: 'self',
      trigger: 'always',
      stacking: 'refresh',
      requiresHpBelow: 0.7,
      stats: { cpct: 0.24 }
    }
  })
  runtime.trigger('artifact-set:400023:4pc', 0, 'a')
  assert.equal(runtime.modifiersAt('a', 10, { hpRatio: 0.5 }).stats.cpct, 0.24, '低于 70% 时计入')
  assert.equal(runtime.modifiersAt('a', 10, { hpRatio: 0.9 }).stats.cpct, undefined, '高于 70% 时不计入')
  assert.equal(runtime.modifiersAt('a', 10, {}).stats.cpct, undefined, '缺省按满血处理')
}

// ---------- 2. 战狂：比例决定是否 +36% ----------
function runBattle (hpRatio) {
  const actions = {
    'a.skill': {
      id: 'a.skill',
      actorId: 'a',
      kind: 'skill',
      timing: { type: 'frames', frames: 60 },
      hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: true }]
    }
  }
  const effects = {
    'artifact-set:400023:4pc': {
      id: 'artifact-set:400023:4pc',
      target: 'self',
      trigger: 'always',
      stacking: 'refresh',
      requiresHpBelow: 0.7,
      stats: { cpct: 0.24 }
    }
  }
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    effects,
    effectTriggers: [{ effectId: 'artifact-set:400023:4pc', actorId: 'a', on: 'always' }],
    actors: [{ actorId: 'a', energy: 0, energyMax: 60 }],
    activeActorId: 'a',
    hpRatios: { a: hpRatio },
    measurementEndFrame: 120,
    steps: [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const damage = calculateTimelineDamage({ timeline, contexts: { a: context } })
  assert.equal(damage.status, 'calculated', JSON.stringify(damage.issues))
  return damage.rows[0].damage
}

{
  const low = runBattle(0.5)
  const high = runBattle(1)
  assert.ok(Math.abs(low / high - 1.24) < 1e-9, `低血量时 +24% 暴击率（100% 爆伤）→ ×1.24，实际 ${low / high}`)
}

// ---------- 3. 逐影猎人：治疗事件触发叠层 ----------
function runShadow (withHeal) {
  const actions = {
    'a.skill': {
      id: 'a.skill',
      actorId: 'a',
      kind: 'skill',
      timing: { type: 'frames', frames: 90 },
      hits: [{ atFrame: 60, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: true }],
      ...(withHeal ? { heal: { atFrame: 30, amount: 2000 } } : {})
    }
  }
  const effects = {
    'artifact-set:400261:4pc': {
      id: 'artifact-set:400261:4pc',
      target: 'self',
      trigger: 'hp-change',
      stacking: 'stack',
      maxStacks: 3,
      durationFrames: 300,
      stats: { cpct: 0.12 }
    }
  }
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    effects,
    effectTriggers: [{ effectId: 'artifact-set:400261:4pc', actorId: 'a', on: 'hp-change' }],
    actors: [{ actorId: 'a', energy: 0, energyMax: 60 }],
    activeActorId: 'a',
    hpRatios: { a: 0.5 },
    measurementEndFrame: 200,
    steps: [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const damage = calculateTimelineDamage({ timeline, contexts: { a: context } })
  assert.equal(damage.status, 'calculated', JSON.stringify(damage.issues))
  return { damage: damage.rows[0].damage, timeline }
}

{
  const { damage: withHeal, timeline } = runShadow(true)
  const { damage: noHeal } = runShadow(false)
  assert.ok(Math.abs(withHeal / noHeal - 1.12) < 1e-9, `一次生命值变化 → 一层 +12% 暴击率 → ×1.12，实际 ${withHeal / noHeal}`)
  const heal = timeline.events.find(event => event.kind === 'heal')
  assert.ok(heal, '应写入 heal 事件')
  assert.equal(heal.frame, 30, '治疗发生在声明的帧')
  assert.equal(heal.detail?.amount, 2000)
  const trigger = timeline.events.find(event => event.kind === 'trigger' && event.detail?.source === 'hp-change')
  assert.ok(trigger, '应写入 hp-change 触发')
  assert.equal(trigger.frame, 30)
}

// ---------- 4. 永久数据 ----------
{
  const permanent = buildRuntimePermanent({ characterId: 10000030, name: '钟离', weaponId: 13303, refinement: 1 })
  assert.equal(permanent.ok, true, JSON.stringify(permanent))
  assert.equal(permanent.data.runtimeEffects?.['artifact-set:400023:4pc']?.requiresHpBelow, 0.7, '战狂的生命值条件')
  assert.equal(permanent.data.runtimeEffects?.['artifact-set:400261:4pc']?.trigger, 'hp-change', '逐影猎人的触发方式')
  assert.equal(permanent.data.runtimeEffects?.['artifact-set:400261:4pc']?.maxStacks, 3)
  assert.equal(permanent.data.effects['artifact-set:400023:4pc']?.runtimeRequired, true)
  assert.equal(permanent.data.effects['artifact-set:400261:4pc']?.runtimeRequired, true)
}
