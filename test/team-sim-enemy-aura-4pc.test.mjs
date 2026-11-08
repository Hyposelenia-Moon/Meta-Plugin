/**
 * 敌人附着条件（第 1 轮收尾）：
 * 冰风迷途的勇士 / 平息鸣雷的尊者 / 渡过烈火的贤人 依赖「敌人当前附着」，
 * 这里验证 `requiresEnemyAura` 在两种模式下都按当帧附着过滤。
 *
 * 1) 运行时：`enemyAura` 命中才计入，拿不到时不计；
 * 2) 时间轴（simulated）：先挂冰再打，第二发吃到 +20% 暴击率；
 * 3) 时间轴（declared）：读命中声明的反应光环，无声明时不计；
 * 4) 永久数据：三套都登记为 `always` + `requiresEnemyAura`。
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

// ---------- 1. 运行时：按当帧附着过滤 ----------
{
  const runtime = createEffectRuntime({
    'artifact-set:400069:4pc': {
      id: 'artifact-set:400069:4pc',
      target: 'self',
      stats: { cpct: 0.2 },
      trigger: 'always',
      stacking: 'refresh',
      requiresEnemyAura: ['cryo']
    }
  })
  runtime.trigger('artifact-set:400069:4pc', 0, 'a')
  assert.equal(runtime.modifiersAt('a', 10, { enemyAura: 'cryo' }).stats.cpct, 0.2, '冰附着时计入')
  assert.equal(runtime.modifiersAt('a', 10, { enemyAura: 'pyro' }).stats.cpct, undefined, '火附着时不计入')
  assert.equal(runtime.modifiersAt('a', 10, {}).stats.cpct, undefined, '拿不到附着时不计入')
}

// ---------- 2. 时间轴（simulated）：先挂冰，第二发吃暴击率 ----------
function runSimulated (withSet) {
  const actions = {
    'a.skill': {
      id: 'a.skill',
      actorId: 'a',
      kind: 'skill',
      timing: { type: 'frames', frames: 120 },
      hits: [
        { atFrame: 6, motionValue: 1, scaling: 'atk', element: 'cryo', canCrit: true, attachment: { gauge: 1 } },
        { atFrame: 60, motionValue: 1, scaling: 'atk', element: 'cryo', canCrit: true, attachment: { gauge: 1 } }
      ]
    }
  }
  const effects = withSet
    ? {
        'artifact-set:400069:4pc': {
          id: 'artifact-set:400069:4pc',
          target: 'self',
          stats: { cpct: 0.2 },
          trigger: 'always',
          stacking: 'refresh',
          requiresEnemyAura: ['cryo']
        }
      }
    : {}
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    auraMode: 'simulated',
    actions,
    effects,
    effectTriggers: withSet ? [{ effectId: 'artifact-set:400069:4pc', actorId: 'a', on: 'always' }] : [],
    actors: [{ actorId: 'a', energy: 0, energyMax: 60 }],
    activeActorId: 'a',
    measurementEndFrame: 200,
    steps: [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const damage = calculateTimelineDamage({ timeline, contexts: { a: { level: 90, targetPresetId: 'dummy-lv100', crit: 'expected', gameVersion: '7.1', source: 'enemy-aura-4pc-test', stats: baseStats, debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 } } } })
  return damage.rows.map(row => row.damage)
}

{
  const plain = runSimulated(false)
  assert.equal(plain.length, 2)
  assert.ok(Math.abs(plain[0] - plain[1]) < 1e-9, '不穿套装时两发同伤')

  const withSet = runSimulated(true)
  assert.ok(Math.abs(withSet[0] - plain[0]) < 1e-9, '第一发挂冰之前没有附着，不吃加成')
  assert.ok(Math.abs(withSet[1] / plain[1] - 1.2) < 1e-9, `第二发吃到 +20% 暴击率（100% 爆伤）→ ×1.2，实际 ${withSet[1] / plain[1]}`)
}

// ---------- 3. 时间轴（declared）：读命中声明的反应光环 ----------
function runDeclared (aura, requiredAura) {
  const actions = {
    'a.skill': {
      id: 'a.skill',
      actorId: 'a',
      kind: 'skill',
      timing: { type: 'frames', frames: 60 },
      hits: [{
        atFrame: 6,
        motionValue: 1,
        scaling: 'atk',
        element: 'pyro',
        canCrit: false,
        ...(aura ? { reaction: { kind: 'vaporize', aura } } : {})
      }]
    }
  }
  const effects = {
    'x.aura-dmg': {
      id: 'x.aura-dmg',
      target: 'self',
      stats: { dmg: 0.2 },
      trigger: 'always',
      stacking: 'refresh',
      requiresEnemyAura: requiredAura
    }
  }
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    effects,
    effectTriggers: [{ effectId: 'x.aura-dmg', actorId: 'a', on: 'always' }],
    actors: [{ actorId: 'a', energy: 0, energyMax: 60 }],
    activeActorId: 'a',
    measurementEndFrame: 120,
    steps: [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const damage = calculateTimelineDamage({ timeline, contexts: { a: { level: 90, targetPresetId: 'dummy-lv100', crit: 'expected', gameVersion: '7.1', source: 'enemy-aura-4pc-test', stats: baseStats, debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 } } } })
  return damage.rows[0].damage
}

{
  const withAura = runDeclared('hydro', ['hydro'])
  const mismatched = runDeclared('hydro', ['pyro'])
  const noAura = runDeclared(undefined, ['hydro'])
  const plain = runDeclared(undefined, ['pyro'])
  assert.ok(Math.abs(withAura / mismatched - 1.2) < 1e-9, `声明水附着时 +20% 增伤生效，实际 ${withAura / mismatched}`)
  assert.ok(Math.abs(noAura / plain - 1) < 1e-9, '没有声明附着时不加算')
}

// ---------- 4. 永久数据：三套都登记 ----------
{
  const permanent = buildRuntimePermanent({ characterId: 10000030, name: '钟离', weaponId: 13303, refinement: 1 })
  assert.equal(permanent.ok, true, JSON.stringify(permanent))
  for (const [id, aura] of [['400069', 'cryo'], ['400074', 'electro'], ['400079', 'pyro']]) {
    const runtimeEffect = permanent.data.runtimeEffects?.[`artifact-set:${id}:4pc`]
    assert.ok(runtimeEffect, `${id} 应有运行时效果`)
    assert.equal(runtimeEffect.trigger, 'always', `${id} 应常驻注册`)
    assert.deepEqual(runtimeEffect.requiresEnemyAura, [aura], `${id} 的附着条件`)
  }
  const effects = permanent.data.effects
  for (const id of ['400069', '400074', '400079']) {
    const entry = effects[`artifact-set:${id}:4pc`]
    assert.equal(entry.status, 'verified-static', `${id} 审计状态`)
    assert.equal(entry.runtimeRequired, true, `${id} 需要运行时触发`)
  }
}
