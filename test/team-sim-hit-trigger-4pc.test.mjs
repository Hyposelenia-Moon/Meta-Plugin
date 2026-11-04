/**
 * 泛化命中触发的 4 件套（2026-11-04 第一轮第一批）：武人、沙上楼阁、回声之林、水仙之梦。
 *
 * 1) 永久数据：runtimeEffects 的 trigger / 数值 / 时长；
 * 2) 时间轴：技能起手、重击命中、任意命中各自激活；
 * 3) 泛化后旧的 geo-hit / skill-hit 不受影响（由既有套件覆盖）。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { buildRuntimePermanent } = await import(mod('model/PermanentSource.js'))

const specOf = (charId, name, weaponId, effectId) => {
  const runtime = buildRuntimePermanent({ characterId: charId, name, weaponId, refinement: 1 })
  assert.equal(runtime.ok, true, `${name} 应能生成永久数据`)
  const spec = runtime.data.runtimeEffects?.[effectId]
  assert.ok(spec, `${name} 的 ${effectId} 应出现在 runtimeEffects`)
  return { spec, audit: runtime.data.effects[effectId] }
}

// ---------- 1. 永久数据 ----------
{
  const { spec, audit } = specOf('10000023', '香菱', '13407', 'artifact-set:400028:4pc')
  assert.equal(spec.trigger, 'cast-skill')
  assert.equal(spec.stats.normalDmg, 0.25)
  assert.equal(spec.stats.chargedDmg, 0.25)
  assert.equal(spec.durationFrames, 480)
  assert.equal(audit.status, 'verified-static')
}

{
  const { spec, audit } = specOf('10000023', '香菱', '13407', 'artifact-set:400221:4pc')
  assert.equal(spec.trigger, 'charged-hit')
  assert.equal(spec.stats.normalDmg, 0.4)
  assert.equal(spec.stats.chargedDmg, 0.4)
  assert.equal(spec.stats.plungeDmg, 0.4)
  assert.equal(spec.durationFrames, 900)
  assert.equal(audit.unmodeled === undefined, false, '普攻提速没进帧表，必须披露')
}

{
  const { spec } = specOf('10000030', '钟离', '13303', 'artifact-set:400291:4pc')
  assert.equal(spec.trigger, 'cast-skill')
  assert.equal(spec.stats.geo, 0.2)
  assert.equal(spec.durationFrames, 600)
}

{
  const { spec } = specOf('10000023', '香菱', '13407', 'artifact-set:400241:4pc')
  assert.equal(spec.trigger, 'hit')
  assert.equal(spec.stacking, 'stack')
  assert.equal(spec.maxStacks, 3)
  assert.equal(spec.stats.atkPct, 0.07)
}

// ---------- 2. 时间轴：重击命中触发沙上楼阁 ----------
{
  const effects = {
    'artifact-set:400221:4pc': {
      id: 'artifact-set:400221:4pc', target: 'self',
      stats: { normalDmg: 0.4, chargedDmg: 0.4, plungeDmg: 0.4 },
      durationFrames: 900, trigger: 'charged-hit', stacking: 'refresh'
    }
  }
  const actions = {
    'a0.charged': {
      id: 'a0.charged', actorId: 'actor:0', kind: 'charged',
      timing: { type: 'frames', frames: 60 },
      hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: true }]
    },
    'a0.normal-1': {
      id: 'a0.normal-1', actorId: 'actor:0', kind: 'normal',
      timing: { type: 'frames', frames: 40 },
      hits: [{ atFrame: 30, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: true }]
    }
  }
  const run = simulateTimeline({
    scheduler: 'fixed',
    steps: [
      { id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'a0.charged', atFrame: 0 },
      { id: 's2', kind: 'action', actorId: 'actor:0', actionId: 'a0.normal-1', atFrame: 60 }
    ],
    actions,
    actors: [{ actorId: 'actor:0', energy: 0, energyMax: 60 }],
    activeActorId: 'actor:0',
    frameTier: FRAME_TIERS['fps-60'],
    measurementEndFrame: 200,
    effects,
    effectTriggers: [{ effectId: 'artifact-set:400221:4pc', actorId: 'actor:0', on: 'charged-hit' }]
  })
  assert.equal(run.status, 'simulated', JSON.stringify(run.issues))
  const fired = run.triggers.filter(t => t.effectId === 'artifact-set:400221:4pc')
  assert.deepEqual(fired.map(t => t.frame), [6], '只有重击命中触发，普攻命中不再触发')
  const event = run.events.find(e => e.detail?.effectId === 'artifact-set:400221:4pc')
  assert.equal(event?.detail?.source, 'charged-hit')
}

// ---------- 3. 任意命中触发（水仙之梦） ----------
{
  const effects = {
    'artifact-set:400241:4pc': {
      id: 'artifact-set:400241:4pc', target: 'self',
      stats: { atkPct: 0.07, hydro: 0.04 },
      durationFrames: 480, trigger: 'hit', stacking: 'stack', maxStacks: 3, icdFrames: 1
    }
  }
  const actions = {
    'a0.skill': {
      id: 'a0.skill', actorId: 'actor:0', kind: 'skill',
      timing: { type: 'frames', frames: 30 },
      hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: true }]
    },
    'a0.normal-1': {
      id: 'a0.normal-1', actorId: 'actor:0', kind: 'normal',
      timing: { type: 'frames', frames: 40 },
      hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: true }]
    }
  }
  const run = simulateTimeline({
    scheduler: 'fixed',
    steps: [
      { id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'a0.skill', atFrame: 0 },
      { id: 's2', kind: 'action', actorId: 'actor:0', actionId: 'a0.normal-1', atFrame: 60 }
    ],
    actions,
    actors: [{ actorId: 'actor:0', energy: 0, energyMax: 60 }],
    activeActorId: 'actor:0',
    frameTier: FRAME_TIERS['fps-60'],
    measurementEndFrame: 200,
    effects,
    effectTriggers: [{ effectId: 'artifact-set:400241:4pc', actorId: 'actor:0', on: 'hit' }]
  })
  assert.equal(run.status, 'simulated', JSON.stringify(run.issues))
  const fired = run.triggers.filter(t => t.effectId === 'artifact-set:400241:4pc')
  assert.deepEqual(fired.map(t => t.stacks), [1, 2], '技能与普攻命中各叠一层')
}
