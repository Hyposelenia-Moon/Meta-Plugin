/**
 * 治疗量通道（第 3 轮）：
 * - 昔时之歌 400281：队伍累计治疗量每 1000 点给 +3% 伤害，封顶 +15%；
 * - 海染砗磲 400194：治疗时生成泡沫，3 秒后按治疗量 90% 结算一次固定伤害。
 *
 * 两条都走时间轴的治疗事件：`heal` 队列项既推动累计治疗量，也驱动泡沫调度。
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

const context = { level: 90, targetPresetId: 'dummy-lv100', crit: 'expected', gameVersion: '7.1', source: 'heal-4pc-test', stats: baseStats, debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 } }

// ---------- 1. 运行时：healRecord 按累计治疗量折算 ----------
{
  const runtime = createEffectRuntime({
    'artifact-set:400281:4pc': {
      id: 'artifact-set:400281:4pc',
      target: 'team',
      trigger: 'always',
      stacking: 'refresh',
      healRecord: { perHeal: 1000, ratio: 0.03, max: 0.15 }
    }
  })
  runtime.trigger('artifact-set:400281:4pc', 0, 'a')
  assert.equal(runtime.modifiersAt('a', 10, { healingTotal: 0 }).stats.dmg, undefined, '没有治疗量就不加伤')
  assert.ok(Math.abs(runtime.modifiersAt('a', 10, { healingTotal: 2000 }).stats.dmg - 0.06) < 1e-9, '2000 点治疗 → +6%')
  assert.ok(Math.abs(runtime.modifiersAt('a', 10, { healingTotal: 6000 }).stats.dmg - 0.15) < 1e-9, '封顶 +15%')
  // 队伍效果对每个角色都成立。
  assert.ok(Math.abs(runtime.modifiersAt('b', 10, { healingTotal: 3000 }).stats.dmg - 0.09) < 1e-9, '队伍效果对每个角色生效')
}

// ---------- 2. 昔时之歌：治疗量进时间轴后提高后续伤害 ----------
function runYesterday (healing, equipped) {
  const actions = {
    'a.skill': {
      id: 'a.skill',
      actorId: 'a',
      kind: 'skill',
      timing: { type: 'frames', frames: 120 },
      ...(healing > 0 ? { heal: { atFrame: 10, amount: healing } } : {}),
      hits: [{ atFrame: 60, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false }]
    }
  }
  const effects = equipped
    ? {
        'artifact-set:400281:4pc': {
          id: 'artifact-set:400281:4pc',
          target: 'team',
          trigger: 'always',
          stacking: 'refresh',
          healRecord: { perHeal: 1000, ratio: 0.03, max: 0.15 }
        }
      }
    : {}
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    effects,
    effectTriggers: equipped ? [{ effectId: 'artifact-set:400281:4pc', actorId: 'a', on: 'always' }] : [],
    actors: [{ actorId: 'a', energy: 0, energyMax: 60 }],
    activeActorId: 'a',
    measurementEndFrame: 200,
    steps: [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const damage = calculateTimelineDamage({ timeline, contexts: { a: context } })
  assert.equal(damage.status, 'calculated', JSON.stringify(damage.issues))
  const row = damage.rows.find(item => item.actionId === 'a.skill')
  assert.ok(row, '应有技能命中行')
  return row.damage
}

{
  const withoutSet = runYesterday(1000, false)
  const withSet = runYesterday(1000, true)
  assert.ok(Math.abs(withSet / withoutSet - 1.03) < 1e-9, `1000 点治疗 → ×1.03，实际 ${withSet / withoutSet}`)
  const capped = runYesterday(6000, true)
  assert.ok(Math.abs(capped / withoutSet - 1.15) < 1e-9, `6000 点治疗 → 封顶 ×1.15，实际 ${capped / withoutSet}`)
  assert.ok(Math.abs(runYesterday(0, true) / withoutSet - 1) < 1e-9, '没有治疗事件时不加伤')
}

// ---------- 3. 海染砗磲：治疗 3 秒后泡沫按 90% 结算 ----------
{
  const actions = {
    'a.skill': {
      id: 'a.skill',
      actorId: 'a',
      kind: 'skill',
      timing: { type: 'frames', frames: 400 },
      heal: { atFrame: 10, amount: 1000 },
      hits: [{ atFrame: 60, motionValue: 0.1, scaling: 'atk', element: 'physical', canCrit: false }]
    }
  }
  const effects = {
    'artifact-set:400194:4pc': {
      id: 'artifact-set:400194:4pc',
      target: 'self',
      trigger: 'always',
      stacking: 'refresh',
      healBubble: { ratio: 0.9, delayFrames: 180, icdFrames: 210 }
    }
  }
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    effects,
    effectTriggers: [{ effectId: 'artifact-set:400194:4pc', actorId: 'a', on: 'always' }],
    actors: [{ actorId: 'a', energy: 0, energyMax: 60 }],
    activeActorId: 'a',
    measurementEndFrame: 400,
    steps: [{ id: 's1', kind: 'action', actorId: 'a', actionId: 'a.skill', atFrame: 0 }]
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const bubbleHits = timeline.hits.filter(hit => hit.actionId === 'artifact-set:400194:4pc')
  assert.equal(bubbleHits.length, 1, '一次治疗只生成一个泡沫')
  assert.equal(bubbleHits[0].frame, 190, '治疗在第 10 帧，泡沫 180 帧后爆炸 → 第 190 帧')
  assert.ok(Math.abs(bubbleHits[0].fixedDamage - 900) < 1e-9, '治疗量 1000 × 90% = 900')

  const damage = calculateTimelineDamage({ timeline, contexts: { a: context } })
  assert.equal(damage.status, 'calculated', JSON.stringify(damage.issues))
  const bubbleRow = damage.rows.find(row => row.actionId === 'artifact-set:400194:4pc')
  assert.ok(bubbleRow, '泡沫应有一行伤害')
  // 900 基伤 → 90 级打 100 级防御 190/390 ≈ 0.48718 → 10% 抗性 0.9；泡沫不吃增伤、不暴击。
  const expected = 900 * (190 / 390) * 0.9
  assert.ok(Math.abs(bubbleRow.damage - expected) < 1e-6, `泡沫伤害应为 ${expected}，实际 ${bubbleRow.damage}`)
}

// ---------- 4. 永久数据：两套登记 ----------
{
  const result = buildRuntimePermanent({ characterId: '10000002', name: '神里绫华', weaponId: '11401', refinement: 1 })
  assert.equal(result.ok, true, JSON.stringify(result))
  const effects = result.data.effects
  const runtime = result.data.runtimeEffects ?? {}
  assert.equal(effects['artifact-set:400281:4pc'].status, 'verified-static', '昔时之歌应登记为已建模')
  assert.equal(effects['artifact-set:400281:4pc'].runtimeRequired, true)
  assert.deepEqual(runtime['artifact-set:400281:4pc'].healRecord, { perHeal: 1000, ratio: 0.03, max: 0.15 })
  assert.equal(effects['artifact-set:400194:4pc'].status, 'verified-static', '海染砗磲应登记为已建模')
  assert.equal(effects['artifact-set:400194:4pc'].runtimeRequired, true)
  assert.deepEqual(runtime['artifact-set:400194:4pc'].healBubble, { ratio: 0.9, delayFrames: 180, icdFrames: 210 })
}

// ---------- 5. 非法定义 ----------
{
  const runtime = createEffectRuntime({})
  assert.equal(runtime.has('artifact-set:400281:4pc'), false)
}
