/**
 * 元素定向增伤通道（2026-11-08）：
 * - 悠古的磐岩 400154：晶片元素 → 该元素伤害 +35%；
 * - 烬城勇者绘卷 400321：反应附着元素 → 该元素伤害 +12%；
 * - 天之美赐 400401：穿戴者自身元素 → 该元素伤害 +20%。
 *
 * 这三套此前按「全元素增伤」近似，本测试锁定定向口径：不匹配的元素不加成。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))

const baseStats = {
  hp: 20000, atk: 1000, def: 800, mastery: 0, cpct: 0, cdmg: 1, recharge: 1,
  dmg: 0, phy: 0, heal: 0, pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0, dendro: 0
}
const context = {
  level: 90, targetPresetId: 'dummy-lv100', crit: 'expected', gameVersion: '7.1',
  source: 'element-dmg-test', stats: baseStats,
  debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
}

function run ({ effects = {}, triggers = [], actions, elements, steps, endFrame = 400 }) {
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    effects,
    ...(triggers.length ? { effectTriggers: triggers } : {}),
    ...(elements ? { elements } : {}),
    actors: [{ actorId: 'a', energy: 60, energyMax: 60 }],
    activeActorId: 'a',
    measurementEndFrame: endFrame,
    steps
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const damage = calculateTimelineDamage({ timeline, contexts: { a: context } })
  assert.equal(damage.status, 'calculated', JSON.stringify(damage.issues))
  return damage.rows
}

const ratioOf = (rows, element, baseline) => {
  const current = rows.find(row => row.element === element && row.origin === 'action')
  const base = baseline.find(row => row.element === element && row.origin === 'action')
  return current.damage / base.damage
}

// ---------- 1. 悠古的磐岩：只加晶片元素 ----------
{
  const actions = {
    'a.skill': {
      id: 'a.skill', actorId: 'a', kind: 'skill',
      timing: { type: 'frames', frames: 200 },
      shardPickup: { atFrame: 10, element: 'pyro' },
      hits: [
        { atFrame: 60, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false },
        { atFrame: 90, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: false }
      ]
    }
  }
  const steps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  const baseline = run({ actions, steps })
  const withSet = run({
    effects: { 'artifact-set:400154:4pc': { id: 'artifact-set:400154:4pc', target: 'team', trigger: 'shard-pickup', stacking: 'refresh', durationFrames: 600, elementDmg: { value: 0.35, from: 'shard-element' } } },
    triggers: [{ effectId: 'artifact-set:400154:4pc', actorId: 'a', on: 'shard-pickup' }],
    actions, steps
  })
  assert.ok(Math.abs(ratioOf(withSet, 'pyro', baseline) - 1.35) < 1e-9, '火伤应 +35%')
  assert.ok(Math.abs(ratioOf(withSet, 'hydro', baseline) - 1) < 1e-9, '水伤不享受晶片加成')
}

// ---------- 2. 烬城勇者绘卷：只加反应附着元素 ----------
{
  const actions = {
    'a.skill': {
      id: 'a.skill', actorId: 'a', kind: 'skill',
      timing: { type: 'frames', frames: 200 },
      hits: [
        { atFrame: 10, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false, reaction: { kind: 'vaporize', aura: 'hydro' } },
        { atFrame: 60, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: false },
        { atFrame: 90, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false }
      ]
    }
  }
  const steps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  const baseline = run({ actions, steps })
  const withSet = run({
    effects: { 'artifact-set:400321:4pc': { id: 'artifact-set:400321:4pc', target: 'team', trigger: 'reaction', stacking: 'refresh', durationFrames: 900, elementDmg: { value: 0.12, from: 'reaction-aura' } } },
    triggers: [{ effectId: 'artifact-set:400321:4pc', actorId: 'a', on: 'reaction' }],
    actions, steps
  })
  assert.ok(Math.abs(ratioOf(withSet, 'hydro', baseline) - 1.12) < 1e-9, '水伤（反应附着）应 +12%')
  assert.ok(Math.abs(ratioOf(withSet, 'pyro', baseline) - 1) < 1e-9, '火伤不享受')
}

// ---------- 3. 天之美赐：只加穿戴者自身元素 ----------
{
  const actions = {
    'a.skill': {
      id: 'a.skill', actorId: 'a', kind: 'skill',
      timing: { type: 'frames', frames: 200 },
      hits: [
        { atFrame: 60, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false },
        { atFrame: 90, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: false }
      ]
    }
  }
  const steps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  const baseline = run({ actions, steps })
  const withSet = run({
    effects: { 'artifact-set:400401:4pc': { id: 'artifact-set:400401:4pc', target: 'team', trigger: 'cast-skill', stacking: 'refresh', durationFrames: 1200, elementDmg: { value: 0.2, from: 'wearer-element' } } },
    triggers: [{ effectId: 'artifact-set:400401:4pc', actorId: 'a', on: 'cast-skill' }],
    elements: { a: 'pyro' },
    actions, steps
  })
  assert.ok(Math.abs(ratioOf(withSet, 'pyro', baseline) - 1.2) < 1e-9, '穿戴者火伤 +20%')
  assert.ok(Math.abs(ratioOf(withSet, 'hydro', baseline) - 1) < 1e-9, '水伤不享受')
}

// ---------- 4. 没有元素来源时按不满足处理 ----------
{
  const actions = {
    'a.skill': {
      id: 'a.skill', actorId: 'a', kind: 'skill',
      timing: { type: 'frames', frames: 200 },
      hits: [{ atFrame: 60, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false }]
    }
  }
  const steps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  const baseline = run({ actions, steps })
  const withoutElement = run({
    effects: { 'artifact-set:400401:4pc': { id: 'artifact-set:400401:4pc', target: 'team', trigger: 'cast-skill', stacking: 'refresh', durationFrames: 1200, elementDmg: { value: 0.2, from: 'wearer-element' } } },
    triggers: [{ effectId: 'artifact-set:400401:4pc', actorId: 'a', on: 'cast-skill' }],
    actions, steps
  })
  assert.ok(Math.abs(ratioOf(withoutElement, 'pyro', baseline) - 1) < 1e-9, '未声明 elements 时不加伤')
}
