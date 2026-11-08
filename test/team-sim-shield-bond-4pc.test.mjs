/**
 * 护盾与生命之契通道（第 4 轮）：
 * - 逆飞的流星 400159：处于护盾庇护下时普攻/重击 +40%，护盾状态由 `shielded` 输入声明；
 * - 谐律异想断章 400301：生命之契数值变化时伤害 +18%，至多 3 层，由 `bond` 事件驱动。
 *
 * 这两条都不模拟「护盾吸收」与「生命之契数值」，只把状态/事件当作输入通道。
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

const context = { level: 90, targetPresetId: 'dummy-lv100', crit: 'expected', gameVersion: '7.1', source: 'shield-bond-4pc-test', stats: baseStats, debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 } }

const makeActions = (extra = {}) => ({
  'a.normal-1': {
    id: 'a.normal-1',
    actorId: 'a',
    kind: 'normal',
    timing: { type: 'frames', frames: 60 },
    hits: [{ atFrame: 10, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: false }],
    ...extra
  }
})

function runTimeline ({ effects, effectTriggers, actions, shielded, steps, endFrame = 200 }) {
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    effects,
    effectTriggers,
    actors: [{ actorId: 'a', energy: 0, energyMax: 60 }],
    activeActorId: 'a',
    ...(shielded ? { shielded } : {}),
    measurementEndFrame: endFrame,
    steps
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const damage = calculateTimelineDamage({ timeline, contexts: { a: context } })
  assert.equal(damage.status, 'calculated', JSON.stringify(damage.issues))
  return { timeline, damage }
}

// ---------- 1. 逆飞的流星：护盾状态决定是否 +40% ----------
{
  const effects = {
    'artifact-set:400159:4pc': {
      id: 'artifact-set:400159:4pc',
      target: 'self',
      trigger: 'always',
      stacking: 'refresh',
      requiresShield: true,
      stats: { normalDmg: 0.4, chargedDmg: 0.4 }
    }
  }
  const steps = [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.normal-1', atFrame: 0 }]
  const withShield = runTimeline({ effects, effectTriggers: [{ effectId: 'artifact-set:400159:4pc', actorId: 'a', on: 'always' }], actions: makeActions(), shielded: { a: true }, steps })
  const without = runTimeline({ effects, effectTriggers: [{ effectId: 'artifact-set:400159:4pc', actorId: 'a', on: 'always' }], actions: makeActions(), shielded: { a: false }, steps })
  const noInput = runTimeline({ effects, effectTriggers: [{ effectId: 'artifact-set:400159:4pc', actorId: 'a', on: 'always' }], actions: makeActions(), steps })
  const ratio = withShield.damage.rows[0].damage / without.damage.rows[0].damage
  assert.ok(Math.abs(ratio - 1.4) < 1e-9, `护盾下普攻 ×1.4，实际 ${ratio}`)
  assert.ok(Math.abs(noInput.damage.rows[0].damage - without.damage.rows[0].damage) < 1e-9, '没有声明时不加伤')
}

// ---------- 2. 谐律异想断章：生命之契变化叠层 ----------
{
  const effects = {
    'artifact-set:400301:4pc': {
      id: 'artifact-set:400301:4pc',
      target: 'self',
      trigger: 'bond-change',
      stacking: 'stack',
      maxStacks: 3,
      durationFrames: 360,
      stats: { dmg: 0.18 }
    }
  }
  const triggers = [{ effectId: 'artifact-set:400301:4pc', actorId: 'a', on: 'bond-change' }]

  function runBonds (count) {
    const actions = {
      'a.skill': {
        id: 'a.skill',
        actorId: 'a',
        kind: 'skill',
        timing: { type: 'frames', frames: 120 },
        bond: { atFrame: 10, delta: 100 },
        hits: [{ atFrame: 50, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false }]
      }
    }
    // 多次变化：用连续技能事件模拟（同一动作重复触发 bond）。
    const steps = Array.from({ length: count }, (_, index) => ({ id: `s${index}`, kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: index * 120 }))
    const timeline = simulateTimeline({
      scheduler: 'fixed',
      frameTier: FRAME_TIERS['fps-60'],
      actions,
      effects,
      effectTriggers: triggers,
      actors: [{ actorId: 'a', energy: 0, energyMax: 60 }],
      activeActorId: 'a',
      measurementEndFrame: count * 120,
      steps
    })
    assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
    const bondEvents = timeline.events.filter(event => event.kind === 'bond')
    assert.equal(bondEvents.length, count, '每次变化都应写入 bond 事件')
    const damage = calculateTimelineDamage({ timeline, contexts: { a: context } })
    assert.equal(damage.status, 'calculated', JSON.stringify(damage.issues))
    return { damage, timeline }
  }

  const one = runBonds(1)
  const three = runBonds(3)
  const four = runBonds(4)
  const base = one.damage.rows[0].damage / 1.18
  assert.ok(Math.abs(one.damage.rows[0].damage / base - 1.18) < 1e-9, '第一次变化 ×1.18')
  // 每次技能从第 10 帧起叠一层，最后一发的层数才是 3 层封顶。
  assert.ok(Math.abs(three.damage.rows.at(-1).damage / base - 1.54) < 1e-9, '第三次变化 3 层 ×1.54')
  assert.ok(Math.abs(four.damage.rows.at(-1).damage / base - 1.54) < 1e-9, '第 4 次变化封顶 3 层')
  const triggerEvents = three.timeline.events.filter(event => event.kind === 'trigger' && event.detail?.source === 'bond-change')
  assert.equal(triggerEvents.length, 3, '三次变化各触发一次')
}

// ---------- 3. 永久数据登记 ----------
{
  const result = buildRuntimePermanent({ characterId: '10000002', name: '神里绫华', weaponId: '11401', refinement: 1 })
  assert.equal(result.ok, true, JSON.stringify(result))
  const effects = result.data.effects
  const runtime = result.data.runtimeEffects ?? {}
  assert.equal(effects['artifact-set:400159:4pc'].status, 'verified-static')
  assert.equal(runtime['artifact-set:400159:4pc'].requiresShield, true)
  assert.equal(effects['artifact-set:400301:4pc'].runtimeRequired, true)
  assert.equal(runtime['artifact-set:400301:4pc'].trigger, 'bond-change')
  assert.deepEqual(runtime['artifact-set:400301:4pc'].stats, { dmg: 0.18 })
}

// ---------- 4. 风无法作为护盾来源的输入校验 ----------
{
  const actions = makeActions({ bond: { atFrame: 0, delta: 0 } })
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    effects: {},
    actors: [{ actorId: 'a', energy: 0, energyMax: 60 }],
    activeActorId: 'a',
    measurementEndFrame: 100,
    steps: [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.normal-1', atFrame: 0 }]
  })
  assert.equal(timeline.status, 'invalid', '生命之契变化量为 0 应判非法')
  assert.ok(timeline.issues.some(issue => issue.path.endsWith('bond.delta')), JSON.stringify(timeline.issues))
}
