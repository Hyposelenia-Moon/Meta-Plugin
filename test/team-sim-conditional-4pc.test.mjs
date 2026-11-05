/**
 * 条件型 4 件套（2026-11-03 切片 5）：华馆梦醒形骸记「魄力」与辰砂往生录。
 *
 * 1) 永久数据：华馆 400189 写进 runtimeEffects（岩伤命中 + 后台计时两路触发、0.3 秒 ICD、最多 4 层）；
 * 2) 时间轴：岩元素命中叠层、ICD 内不重复叠、后台每 3 秒补层（角色不在场时）；
 * 3) 辰砂 400199：爆发起手 +8% 攻击，生命值降低那部分明确标未建模。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { buildRuntimePermanent } = await import(mod('model/PermanentSource.js'))

// ---------- 1. 永久数据 ----------
{
  const runtime = buildRuntimePermanent({ characterId: '10000030', name: '钟离', weaponId: '13303', refinement: 1 })
  assert.equal(runtime.ok, true)
  const spec = runtime.data.runtimeEffects?.['artifact-set:400189:4pc']
  assert.ok(spec, '华馆 4 件套应出现在 runtimeEffects')
  assert.equal(spec.trigger, 'geo-hit')
  assert.deepEqual(spec.extraTriggers, ['off-field-tick'])
  assert.equal(spec.icdFrames, 18)
  assert.equal(spec.tickFrames, 180)
  assert.equal(spec.stacking, 'stack')
  assert.equal(spec.maxStacks, 4)
  assert.equal(spec.durationFrames, 360)
  assert.equal(spec.stats.defPct, 0.06)
  assert.equal(spec.stats.geo, 0.06)
  const audit = runtime.data.effects['artifact-set:400189:4pc']
  assert.equal(audit.status, 'verified-static')
  assert.equal(audit.runtimeRequired, true)
  assert.equal(audit.unmodeled, undefined)
}
{
  const runtime = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: '13407', refinement: 1 })
  assert.equal(runtime.ok, true)
  const spec = runtime.data.runtimeEffects?.['artifact-set:400199:4pc']
  assert.ok(spec, '辰砂 4 件套应出现在 runtimeEffects')
  assert.equal(spec.trigger, 'cast-burst')
  assert.equal(spec.stats.atkPct, 0.08)
  assert.equal(spec.durationFrames, 960)
  const audit = runtime.data.effects['artifact-set:400199:4pc']
  assert.equal(audit.runtimeRequired, true)
  assert.match(String(audit.unmodeled ?? ''), /生命值降低/)
}

// ---------- 2. 时间轴：华馆叠层 ----------
const effects = {
  'artifact-set:400189:4pc': {
    id: 'artifact-set:400189:4pc',
    target: 'self',
    stats: { defPct: 0.06, geo: 0.06 },
    durationFrames: 360,
    trigger: 'geo-hit',
    extraTriggers: ['off-field-tick'],
    icdFrames: 18,
    tickFrames: 180,
    stacking: 'stack',
    maxStacks: 4
  }
}
const actions = {
  'a0.skill': {
    id: 'a0.skill',
    actorId: 'actor:0',
    kind: 'skill',
    timing: { type: 'frames', frames: 30 },
    hits: [
      { atFrame: 6, motionValue: 2, scaling: 'atk', element: 'geo', canCrit: true },
      { atFrame: 10, motionValue: 2, scaling: 'atk', element: 'geo', canCrit: true }
    ]
  },
  'a0.normal-1': {
    id: 'a0.normal-1',
    actorId: 'actor:0',
    kind: 'normal',
    timing: { type: 'frames', frames: 40 },
    hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true }]
  }
}
const run = simulateTimeline({
  scheduler: 'fixed',
  steps: [
    { id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'a0.skill', atFrame: 0 },
    { id: 's2', kind: 'action', actorId: 'actor:0', actionId: 'a0.normal-1', atFrame: 40 },
    { id: 's3', kind: 'switch', actorId: 'actor:1', atFrame: 100 },
    { id: 's4', kind: 'wait', frames: 300 }
  ],
  actions,
  actors: [
    { actorId: 'actor:0', energy: 0, energyMax: 60 },
    { actorId: 'actor:1', energy: 0, energyMax: 60 }
  ],
  activeActorId: 'actor:0',
  frameTier: FRAME_TIERS['fps-60'],
  measurementEndFrame: 400,
  effects,
  effectTriggers: [
    { effectId: 'artifact-set:400189:4pc', actorId: 'actor:0', on: 'geo-hit' },
    { effectId: 'artifact-set:400189:4pc', actorId: 'actor:0', on: 'off-field-tick' }
  ]
})
assert.equal(run.status, 'simulated', JSON.stringify(run.issues))

const geoTriggers = run.triggers.filter(t => t.effectId === 'artifact-set:400189:4pc')
const frames = geoTriggers.map(t => t.frame)
// 命中帧 6 与 10 落在同一个 0.3 秒 ICD 里：只有 6 叠层；第二段普攻命中在 46，距上次 40 帧，叠第 2 层。
assert.deepEqual(frames.slice(0, 2), [6, 46], `岩伤命中触发帧 ${frames.join(',')}`)
assert.ok(!frames.includes(10), 'ICD 内的第二段命中不得叠层')
// 换人后每 180 帧一次后台叠层：180 与 360。
assert.deepEqual(frames.slice(2), [180, 360], `后台计时触发帧 ${frames.join(',')}`)
const stacks = geoTriggers.map(t => t.stacks)
assert.deepEqual(stacks, [1, 2, 3, 4], '层数应按 1→4 递增')

const tickEvents = run.events.filter(e => e.detail?.source === 'off-field-tick')
assert.equal(tickEvents.length, 2, '后台计时应各记一次触发事件')
assert.deepEqual(tickEvents.map(e => e.frame), [180, 360])

console.log('条件型 4 件套：岩伤叠层、ICD 去重、后台计时补层、辰砂爆发触发均按口径')
