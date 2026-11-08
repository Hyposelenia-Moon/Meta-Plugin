/**
 * 元素定向减抗（翠绿之影 400094）与队伍元素计数（饰金之梦 400214）。
 * - 翠绿：扩散后按扩散光环元素降 40% 抗性，10 秒；只影响该元素的后续命中；
 * - 饰金：按 `elements` 实际计数，同元素队友每个 +14% 攻击、异元素队友每个 +50 精通。
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
  source: 'element-shred-teamcounts', stats: baseStats, base: { hp: 20000, atk: 1000, def: 800 },
  debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
}

function run ({ effects = {}, triggers = [], actions, elements, steps, endFrame = 300 }) {
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

// ---------- 1. 翠绿之影：减抗只作用于扩散元素 ----------
{
  const actions = {
    'a.skill': {
      id: 'a.skill', actorId: 'a', kind: 'skill',
      timing: { type: 'frames', frames: 240 },
      hits: [
        { atFrame: 10, motionValue: 1, scaling: 'atk', element: 'anemo', canCrit: false, reaction: { kind: 'swirl', aura: 'pyro' } },
        { atFrame: 60, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false },
        { atFrame: 120, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: false }
      ]
    }
  }
  const steps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  const baseline = run({ actions, steps })
  const withSet = run({
    effects: {
      'artifact-set:400094:4pc': { id: 'artifact-set:400094:4pc', target: 'self', trigger: 'always', stacking: 'refresh', reactionDmg: { swirl: 0.6, 'stellar-swirl': 0.2 } },
      'artifact-set:400094:4pc-shred': { id: 'artifact-set:400094:4pc-shred', target: 'team', trigger: 'reaction', reactionKinds: ['swirl'], stacking: 'refresh', durationFrames: 600, resistanceShred: { value: 0.4, from: 'reaction-aura' } }
    },
    triggers: [
      { effectId: 'artifact-set:400094:4pc', actorId: 'a', on: 'always' },
      { effectId: 'artifact-set:400094:4pc-shred', actorId: 'a', on: 'reaction' }
    ],
    actions, steps
  })
  const pick = (rows, element) => rows.find(row => row.element === element && row.origin === 'action').damage
  // 10% 抗 → -30% 抗：0.9 → 1.15
  const expected = 1.15 / 0.9
  assert.ok(Math.abs(pick(withSet, 'pyro') / pick(baseline, 'pyro') - expected) < 1e-9, '火伤应按 -30% 抗结算')
  assert.ok(Math.abs(pick(withSet, 'hydro') / pick(baseline, 'hydro') - 1) < 1e-9, '水伤不受火减抗影响')
}

// ---------- 2. 饰金之梦：按 elements 实际计数 ----------
{
  const actions = {
    'a.skill': {
      id: 'a.skill', actorId: 'a', kind: 'skill',
      timing: { type: 'frames', frames: 240 },
      hits: [
        { atFrame: 10, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false, reaction: { kind: 'vaporize', aura: 'hydro' } },
        { atFrame: 60, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false }
      ]
    }
  }
  const steps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  const baseline = run({ actions, steps })
  const withSet = run({
    effects: {
      'artifact-set:400214:4pc': { id: 'artifact-set:400214:4pc', target: 'self', trigger: 'reaction', stacking: 'refresh', durationFrames: 480, icdFrames: 480, scalesWithTeamElements: { same: { stat: 'atkPct', value: 0.14 }, different: { stat: 'mastery', value: 50 } } }
    },
    triggers: [{ effectId: 'artifact-set:400214:4pc', actorId: 'a', on: 'reaction' }],
    elements: { a: 'pyro', b: 'pyro', c: 'hydro', d: 'cryo' },
    actions, steps
  })
  const pick = rows => rows.filter(row => row.element === 'pyro' && row.origin === 'action')[1].damage
  // 1 名同元素队友 → +14% 攻击；异元素精通不影响无反应的火伤
  assert.ok(Math.abs(pick(withSet) / pick(baseline) - 1.14) < 1e-9, '同元素队友 1 人应 +14% 攻击')
}

// ---------- 3. 没有 elements 时按 0 计 ----------
{
  const actions = {
    'a.skill': {
      id: 'a.skill', actorId: 'a', kind: 'skill',
      timing: { type: 'frames', frames: 240 },
      hits: [
        { atFrame: 10, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false, reaction: { kind: 'vaporize', aura: 'hydro' } },
        { atFrame: 60, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false }
      ]
    }
  }
  const steps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  const baseline = run({ actions, steps })
  const withoutElements = run({
    effects: {
      'artifact-set:400214:4pc': { id: 'artifact-set:400214:4pc', target: 'self', trigger: 'reaction', stacking: 'refresh', durationFrames: 480, icdFrames: 480, scalesWithTeamElements: { same: { stat: 'atkPct', value: 0.14 }, different: { stat: 'mastery', value: 50 } } }
    },
    triggers: [{ effectId: 'artifact-set:400214:4pc', actorId: 'a', on: 'reaction' }],
    actions, steps
  })
  const pick = rows => rows.filter(row => row.element === 'pyro' && row.origin === 'action')[1].damage
  assert.ok(Math.abs(pick(withoutElements) / pick(baseline) - 1) < 1e-9, '未声明 elements 时不加攻击')
}
