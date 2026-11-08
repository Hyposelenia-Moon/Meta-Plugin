/**
 * 4 件套的「外部状态条件」通道（2026-11-08）：
 * - 烬城勇者绘卷 400321 的夜魂档：只有调用方声明 nightsoul 时才追加到 28%；
 * - 天之美赐 400401：只有调用方声明 witchLesson（完成魔女课业）时才生效。
 *
 * 这两个状态内核推不出来（夜魂条、任务进度），所以由调用方声明；本测试锁定
 * 「未声明不加、声明才加」，且侧通道（定向增伤）与面板走同一套条件。
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
  source: 'state-conditions-test', stats: baseStats,
  debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
}

function run ({ effects = {}, triggers = [], actions, elements, steps, nightsoul, witchLesson, endFrame = 400 }) {
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    effects,
    ...(triggers.length ? { effectTriggers: triggers } : {}),
    ...(elements ? { elements } : {}),
    ...(nightsoul ? { nightsoul } : {}),
    ...(witchLesson !== undefined ? { witchLesson } : {}),
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

const witchSet = {
  'artifact-set:400401:4pc': {
    id: 'artifact-set:400401:4pc', target: 'team', trigger: 'cast-skill',
    stacking: 'refresh', durationFrames: 1200, requiresWitchLesson: true,
    elementDmg: { value: 0.2, from: 'wearer-element' }
  }
}
const witchActions = {
  'a.skill': {
    id: 'a.skill', actorId: 'a', kind: 'skill',
    timing: { type: 'frames', frames: 100 },
    hits: [{ atFrame: 30, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false }]
  }
}
const witchSteps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]

// ---------- 1. 天之美赐：未声明魔女课业 → 不加；声明 → 对应元素 +20% ----------
{
  const baseline = run({ actions: witchActions, steps: witchSteps, elements: { a: 'pyro' } })
  const without = run({ effects: witchSet, triggers: [{ effectId: 'artifact-set:400401:4pc', actorId: 'a', on: 'cast-skill' }], actions: witchActions, steps: witchSteps, elements: { a: 'pyro' } })
  assert.ok(Math.abs(ratioOf(without, 'pyro', baseline) - 1) < 1e-9, '未完成课业不应加伤')

  const withLesson = run({ effects: witchSet, triggers: [{ effectId: 'artifact-set:400401:4pc', actorId: 'a', on: 'cast-skill' }], actions: witchActions, steps: witchSteps, elements: { a: 'pyro' }, witchLesson: true })
  assert.ok(Math.abs(ratioOf(withLesson, 'pyro', baseline) - 1.2) < 1e-9, '完成课业后火伤应 +20%')
}

const emberEffects = {
  'artifact-set:400321:4pc': {
    id: 'artifact-set:400321:4pc', target: 'team', trigger: 'reaction',
    stacking: 'refresh', durationFrames: 900, elementDmg: { value: 0.12, from: 'reaction-aura' }
  },
  'artifact-set:400321:4pc-nightsoul': {
    id: 'artifact-set:400321:4pc-nightsoul', target: 'team', trigger: 'reaction',
    stacking: 'refresh', durationFrames: 1200, requiresNightsoul: true,
    elementDmg: { value: 0.16, from: 'reaction-aura' }
  }
}
const emberTriggers = [
  { effectId: 'artifact-set:400321:4pc', actorId: 'a', on: 'reaction' },
  { effectId: 'artifact-set:400321:4pc-nightsoul', actorId: 'a', on: 'reaction' }
]
const emberActions = {
  'a.skill': {
    id: 'a.skill', actorId: 'a', kind: 'skill',
    timing: { type: 'frames', frames: 100 },
    hits: [
      { atFrame: 20, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false, reaction: { kind: 'vaporize', aura: 'hydro' } },
      { atFrame: 40, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: false }
    ]
  }
}
const emberSteps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]

// ---------- 2. 烬城勇者绘卷：夜魂档只在声明 nightsoul 时追加 ----------
{
  const baseline = run({ actions: emberActions, steps: emberSteps })
  const without = run({ effects: emberEffects, triggers: emberTriggers, actions: emberActions, steps: emberSteps })
  assert.ok(Math.abs(ratioOf(without, 'hydro', baseline) - 1.12) < 1e-9, '无夜魂时应是 12%')

  const withNightsoul = run({ effects: emberEffects, triggers: emberTriggers, actions: emberActions, steps: emberSteps, nightsoul: { a: true } })
  assert.ok(Math.abs(ratioOf(withNightsoul, 'hydro', baseline) - 1.28) < 1e-9, '夜魂加持时应到 28%')

  // 夜魂档只影响水（反应附着元素），火伤不受影响。
  assert.ok(Math.abs(ratioOf(withNightsoul, 'pyro', baseline) - 1) < 1e-9, '火伤不应被反应附着元素加成')
}

console.log('4 件套外部状态条件：夜魂档与魔女课业按调用方声明生效')
