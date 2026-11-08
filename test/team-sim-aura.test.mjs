/**
 * 附着状态机（第 1 轮）：`auraMode: 'simulated'` 时由附着推导反应。
 *
 * 1) 单元：AuraTracker 的附着、刷新、衰减、增幅/剧变消耗、ICD；
 * 2) 时间轴：水附着后火伤触发蒸发，未开模拟时仍读数据声明；
 * 3) 兼容：`declared`（缺省）行为不变。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { AuraTracker, AURA_DECAY_PER_FRAME, STANDARD_ICD_FRAMES } = await import(mod('modules/teamSimulation/aura.js'))
const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))

// ---------- 1. 单元：附着与反应 ----------
{
  const tracker = new AuraTracker()
  const hydro = tracker.apply({ frame: 0, actorId: 'a', element: 'hydro' })
  assert.equal(hydro.attached, true)
  assert.equal(hydro.reaction, undefined, '第一发只附着')
  assert.equal(hydro.aura.element, 'hydro')
  assert.equal(hydro.aura.gauge, 1)

  const pyro = tracker.apply({ frame: 10, actorId: 'b', element: 'pyro' })
  assert.equal(pyro.reaction.kind, 'vaporize', '火打水是蒸发')
  assert.equal(pyro.reaction.aura, 'hydro')
  assert.ok(Math.abs(pyro.aura.gauge - (1 - 10 * AURA_DECAY_PER_FRAME - 0.5)) < 1e-9, '增幅扣 0.5，且先补衰减')
}

{
  const tracker = new AuraTracker()
  tracker.apply({ frame: 0, actorId: 'a', element: 'pyro', gauge: 0.3 })
  const hit = tracker.apply({ frame: 5, actorId: 'b', element: 'hydro' })
  assert.equal(hit.reaction.kind, 'vaporize')
  assert.equal(hit.aura, null, '附着不足 0.5 时被反应吃光')
  const third = tracker.apply({ frame: 10, actorId: 'b', element: 'hydro' })
  assert.equal(third.reaction, undefined, '没附着就不再蒸发')
  assert.equal(third.attached, false, 'Standard ICD 内不再附着')
  const independent = tracker.apply({ frame: 12, actorId: 'b', element: 'hydro', icd: 'independent' })
  assert.equal(independent.attached, true, 'Independent 忽略 ICD')
  assert.equal(independent.aura.element, 'hydro')
}

{
  const tracker = new AuraTracker()
  tracker.apply({ frame: 0, actorId: 'a', element: 'hydro' })
  const late = tracker.apply({ frame: 900, actorId: 'b', element: 'pyro' })
  assert.equal(late.reaction, undefined, '1U 附着 900 帧后已衰减完，不再蒸发')
  assert.equal(late.attached, true, '这一发挂上火')
}

{
  const tracker = new AuraTracker()
  tracker.apply({ frame: 0, actorId: 'a', element: 'pyro' })
  const overload = tracker.apply({ frame: 10, actorId: 'b', element: 'electro' })
  assert.equal(overload.reaction.kind, 'overloaded')
  assert.equal(overload.aura, null, '剧变吃光附着')
}

{
  const tracker = new AuraTracker()
  tracker.apply({ frame: 0, actorId: 'a', element: 'hydro' })
  const refresh = tracker.apply({ frame: 10, actorId: 'a', element: 'hydro', gauge: 2, icd: 'independent' })
  assert.equal(refresh.reaction, undefined, '同元素只刷新')
  assert.equal(refresh.aura.gauge, 2)
}

{
  const tracker = new AuraTracker()
  assert.equal(tracker.apply({ frame: 0, actorId: 'a', element: 'physical' }).attached, false, '物理不附着')
  assert.equal(tracker.apply({ frame: 0, actorId: 'a', element: 'geo' }).attached, false, '岩不附着')
}

{
  const tracker = new AuraTracker()
  tracker.apply({ frame: 0, actorId: 'a', element: 'hydro', icd: 'independent' })
  const first = tracker.apply({ frame: 10, actorId: 'a', element: 'pyro' })
  const second = tracker.apply({ frame: 20, actorId: 'a', element: 'pyro' })
  const third = tracker.apply({ frame: 30, actorId: 'a', element: 'pyro' })
  const fourth = tracker.apply({ frame: 40, actorId: 'a', element: 'pyro' })
  assert.equal(first.reaction.kind, 'vaporize', '第 1 次命中放行（附着计数 0）')
  assert.equal(second.attached, false, '第 2 次命中被 Standard ICD 拦下')
  assert.equal(third.attached, false, '第 3 次命中仍被拦下')
  assert.equal(fourth.attached, true, '第 4 次命中重新放行并挂上火')
  const later = tracker.apply({ frame: 40 + STANDARD_ICD_FRAMES + 1, actorId: 'a', element: 'pyro', icd: 'standard' })
  assert.equal(later.attached, true, '过 2.5 秒窗口后重新计数')
}

// ---------- 2. 时间轴：模拟模式推导蒸发 ----------
{
  const actions = {
    'a0.skill': {
      id: 'a0.skill', actorId: 'actor:0', kind: 'skill',
      timing: { type: 'frames', frames: 120 },
      hits: [
        { atFrame: 10, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: true },
        { atFrame: 60, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: true }
      ]
    }
  }
  const make = auraMode => simulateTimeline({
    scheduler: 'fixed',
    steps: [{ id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'a0.skill', atFrame: 0 }],
    actions,
    actors: [{ actorId: 'actor:0', energy: 0, energyMax: 80 }],
    activeActorId: 'actor:0',
    frameTier: FRAME_TIERS['fps-60'],
    measurementEndFrame: 200,
    ...(auraMode ? { auraMode } : {})
  })
  const simulated = make('simulated')
  assert.equal(simulated.status, 'simulated', JSON.stringify(simulated.issues))
  assert.equal(simulated.hits.length, 2)
  assert.equal(simulated.hits[0].reaction, undefined, '第一发只挂水')
  assert.equal(simulated.hits[1].reaction?.kind, 'vaporize', '第二发火伤触发蒸发')
  assert.equal(simulated.hits[1].reaction?.aura, 'hydro')

  // 动作包没有附着元数据时，1U/Standard 只是近似，必须进 approximateItems。
  assert.ok(simulated.approximateItems.some(item => item.startsWith('attachment:default:')), '缺省附着要披露')
  const explicit = simulateTimeline({
    scheduler: 'fixed',
    steps: [{ id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'a0.skill', atFrame: 0 }],
    actions: {
      'a0.skill': {
        id: 'a0.skill', actorId: 'actor:0', kind: 'skill',
        timing: { type: 'frames', frames: 120 },
        hits: [
          { atFrame: 10, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: true, attachment: { gauge: 1, icd: 'standard' } },
          { atFrame: 60, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: true, attachment: { gauge: 1, icd: 'standard' } }
        ]
      }
    },
    actors: [{ actorId: 'actor:0', energy: 0, energyMax: 80 }],
    activeActorId: 'actor:0',
    frameTier: FRAME_TIERS['fps-60'],
    measurementEndFrame: 200,
    auraMode: 'simulated'
  })
  assert.equal(explicit.status, 'simulated', JSON.stringify(explicit.issues))
  assert.ok(!explicit.approximateItems.some(item => item.startsWith('attachment:default:')), '显式附着不再披露近似')

  const declared = make(undefined)
  assert.equal(declared.status, 'simulated', JSON.stringify(declared.issues))
  assert.equal(declared.hits[1].reaction, undefined, '缺省 declared 模式不推导反应')
}
