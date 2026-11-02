import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { mod } from './_helper.mjs'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(import.meta.url)('typescript')
const sourceCache = new Map()
// 源码模式把 .ts 转译成 data URL 再 import；相对 import 也要一起转译，否则 data: 协议解析不到文件。
async function sourceUrl(rel) {
  if (sourceCache.has(rel)) return sourceCache.get(rel)
  const source = fs.readFileSync(path.join(root, 'src', 'modules', 'teamSimulation', rel), 'utf8')
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [specifier] of js.matchAll(/(?<=from ')\.\/[\w-]+\.js(?=')/g)) {
    const depRel = specifier.replace(/^\.\//, '').replace(/\.js$/, '.ts')
    js = js.replaceAll(`'${specifier}'`, `'${await sourceUrl(depRel)}'`)
  }
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
  sourceCache.set(rel, url)
  return url
}
async function load(rel) {
  if (process.env.META_TEAM_SIM_SOURCE_TEST !== '1') return import(mod(`modules/teamSimulation/${rel.replace(/\.ts$/, '.js')}`))
  return import(await sourceUrl(rel))
}
const { FRAME_RATE, FRAME_TIERS, EVENT_PHASES, simulateTimeline, validateActionSpec, validateFrameTier, resolveActionTiming } = await load('timeline.ts')

const actions = {
  'itto.normal-1': {
    id: 'itto.normal-1', actorId: 'itto', kind: 'normal', timing: { type: 'frames', frames: 36 },
    hits: [{ atFrame: 6, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true }, { atFrame: 18, motionValue: 1.2, element: 'geo', scaling: 'atk', canCrit: true }],
    cancelWindows: [{ fromFrame: 24, toFrame: 36 }]
  },
  'itto.skill': {
    id: 'itto.skill', actorId: 'itto', kind: 'skill', timing: { type: 'frames', frames: 30 },
    hits: [{ atFrame: 10, motionValue: 2, element: 'geo', scaling: 'atk', canCrit: true }],
    cooldownFrames: 600, particles: [{ atFrame: 10, count: 3, element: 'geo', travelFrames: 12 }]
  },
  'itto.burst': {
    id: 'itto.burst', actorId: 'itto', kind: 'burst', timing: { type: 'frames', frames: 60 },
    hits: [{ atFrame: 20, motionValue: 3, element: 'geo', scaling: 'atk', canCrit: true }], energyCost: 60
  },
  'helper.particles': {
    id: 'helper.particles', actorId: 'itto', kind: 'skill', timing: { type: 'frames', frames: 20 }, hits: [],
    particles: [{ atFrame: 10, count: 10, element: 'geo', travelFrames: 10 }]
  },
  'helper.big': {
    id: 'helper.big', actorId: 'itto', kind: 'skill', timing: { type: 'frames', frames: 20 }, hits: [],
    particles: [{ atFrame: 10, count: 60, element: 'geo', travelFrames: 10 }]
  }
}
const base = {
  scheduler: 'fixed', actions, activeActorId: 'itto', measurementEndFrame: 400,
  frameTier: FRAME_TIERS['fps-60'],
  actors: [{ actorId: 'itto', energy: 60, energyMax: 60 }]
}

// 帧是整数，帧率固定 60。
assert.equal(FRAME_RATE, 60)
assert.deepEqual(EVENT_PHASES, ['action-start', 'cost', 'snapshot', 'hit', 'damage', 'trigger', 'energy', 'state'])

// 单动作：命中落在起手帧 + 偏移，按整数帧对齐。
const single = simulateTimeline({ ...base, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 0 }] })
assert.equal(single.status, 'simulated', JSON.stringify(single.issues))
assert.deepEqual(single.hits.map(h => h.frame), [6, 18])
assert.equal(single.hits[0].actionId, 'itto.normal-1')
assert.equal(single.simulationReady, false)
// 档位要透出：60 档一帧 17ms 游戏时间、16.567ms 现实时间，计时器时间 0.9745（快帧）。
assert.equal(single.timing.tierId, 'fps-60')
assert.equal(single.timing.timerTickMs, 17)
assert.equal(single.timing.fps, 60.36144)
assert.ok(Math.abs(single.timing.realMsPerFrame - 1000 / 60.36144) < 1e-9)
assert.ok(Math.abs(single.timing.timerSecondsPerGameSecond - 0.974522) < 1e-6, String(single.timing.timerSecondsPerGameSecond))
assert.deepEqual(single.timing.assumptions, ['constant-frame-rate'])

// 事件顺序：先按帧，再按相位表，再按登记顺序，不能按角色 id 排。
const order = (e) => [e.frame, EVENT_PHASES.indexOf(e.phase), e.sequence]
for (let i = 1; i < single.events.length; i++) {
  const [f0, p0, q0] = order(single.events[i - 1])
  const [f1, p1, q1] = order(single.events[i])
  assert.ok(f0 < f1 || (f0 === f1 && (p0 < p1 || (p0 === p1 && q0 < q1))), `事件顺序错乱：${JSON.stringify(single.events[i - 1])} → ${JSON.stringify(single.events[i])}`)
}
assert.equal(single.events[0].kind, 'action-start')
assert.equal(single.events[0].frame, 0)
assert.ok(single.events.some(e => e.kind === 'action-end' && e.frame === 36))

// 取消窗口：24 帧接下一段普攻，前一段第 36 帧的收尾与后续命中不再发生。
const chained = simulateTimeline({
  ...base,
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 0 },
    { id: 's2', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 24 }
  ]
})
assert.equal(chained.status, 'simulated', JSON.stringify(chained.issues))
assert.deepEqual(chained.hits.map(h => h.frame), [6, 18, 30, 42])
assert.equal(chained.events.filter(e => e.kind === 'action-end').length, 1)

// 固定轴：动作没准备好就报失败帧与原因，不能自动前移。
const cooldown = simulateTimeline({
  ...base,
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.skill', atFrame: 0 },
    { id: 's2', kind: 'action', actorId: 'itto', actionId: 'itto.skill', atFrame: 300 }
  ]
})
assert.equal(cooldown.status, 'invalid')
assert.ok(cooldown.issues.some(i => i.path === 'steps.s2.cooldown' && i.code === 'invalid'), JSON.stringify(cooldown.issues))

const early = simulateTimeline({ ...base, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 0 }, { id: 's2', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 1 }] })
assert.equal(early.status, 'invalid')
assert.ok(early.issues.some(i => i.path === 'steps.s2.atFrame' && i.message.includes('可取消')))

// 能量：扣费发生在起手帧；不够就拒绝，不能先打后补。
const burst = simulateTimeline({ ...base, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.burst', atFrame: 0 }] })
assert.equal(burst.status, 'simulated', JSON.stringify(burst.issues))
assert.equal(burst.actors[0].energy, 0)
const doubleBurst = simulateTimeline({ ...base, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.burst', atFrame: 0 }, { id: 's2', kind: 'action', actorId: 'itto', actionId: 'itto.burst', atFrame: 60 }] })
assert.equal(doubleBurst.status, 'invalid')
assert.ok(doubleBurst.issues.some(i => i.path === 'steps.s2.energy'))

// 粒子到达才回能：产球帧 10 + 飞行 10 帧。
const particles = simulateTimeline({ ...base, actors: [{ actorId: 'itto', energy: 0, energyMax: 60 }], steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'helper.particles', atFrame: 0 }] })
assert.equal(particles.status, 'simulated', JSON.stringify(particles.issues))
assert.ok(particles.events.some(e => e.kind === 'particle' && e.frame === 20), JSON.stringify(particles.events))
assert.equal(particles.actors[0].energy, 10)

// ASAP：能量不足时等到粒子到达的下一帧再执行，等待时间进固定窗口。
const asap = simulateTimeline({
  ...base, scheduler: 'asap-sequence', actors: [{ actorId: 'itto', energy: 0, energyMax: 60 }],
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'helper.big' },
    { id: 's2', kind: 'action', actorId: 'itto', actionId: 'itto.burst' }
  ]
})
assert.equal(asap.status, 'simulated', JSON.stringify(asap.issues))
const deferred = asap.requests.find(r => r.stepId === 's2')
assert.equal(deferred.ok, true, JSON.stringify(deferred))
assert.equal(deferred.actualFrame, 21)

// 动作数据校验：小数帧、越界帧、空命中都要拒绝。
assert.ok(validateActionSpec({ ...actions['itto.normal-1'], timing: { type: 'frames', frames: 36.5 } }).some(i => i.path.endsWith('timing.frames')))
assert.ok(validateActionSpec({ ...actions['itto.normal-1'], hits: [{ atFrame: 6.5, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true }] }).some(i => i.path.endsWith('hits.0.atFrame')))
assert.ok(validateActionSpec({ ...actions['itto.normal-1'], hits: [{ atFrame: 40, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true }] }).some(i => i.message.includes('超出动作时长')))
assert.ok(validateActionSpec({ ...actions['itto.normal-1'], hits: [{ atFrame: 9, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true }, { atFrame: 3, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true }] }).some(i => i.message.includes('递增')))
assert.ok(validateActionSpec({ ...actions['itto.normal-1'], hits: [{ atFrame: 6, motionValue: 1, element: 'geo', canCrit: true }] }).some(i => i.code === 'missing' && i.path.endsWith('hits.0.scaling')))
assert.ok(validateActionSpec({ ...actions['itto.normal-1'], hits: [{ atFrame: 6, motionValue: 1, element: 'geo', scaling: 'mastery', canCrit: true }] }).some(i => i.code === 'unsupported' && i.path.endsWith('hits.0.scaling')))
assert.ok(validateActionSpec({ ...actions['itto.normal-1'], cancelWindows: [{ fromFrame: 30, toFrame: 20 }] }).some(i => i.message.includes('不早于')))
const badHit = simulateTimeline({ ...base, actions: { bad: { id: 'bad', actorId: 'itto', kind: 'normal', timing: { type: 'frames', frames: 10 }, hits: [{ atFrame: 2.5, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true }] } }, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'bad', atFrame: 0 }] })
assert.equal(badHit.status, 'invalid')
assert.ok(badHit.issues.some(i => i.message.includes('整数')))

// 未登记动作：拒绝，不能静默跳过。
const unknown = simulateTimeline({ ...base, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'missing', atFrame: 0 }] })
assert.equal(unknown.status, 'invalid')
assert.ok(unknown.issues.some(i => i.code === 'unsupported'))

// 卡肉：命中造成的冻结把之后的一切顺延，现实帧照走、游戏帧不走。
const lagged = {
  ...actions['itto.normal-1'], id: 'itto.lagged',
  hits: [
    { atFrame: 6, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true, hitlagFrames: 5 },
    { atFrame: 18, motionValue: 1.2, element: 'geo', scaling: 'atk', canCrit: true }
  ]
}
const lag = simulateTimeline({ ...base, actions: { ...actions, 'itto.lagged': lagged }, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.lagged', atFrame: 0 }] })
assert.equal(lag.status, 'simulated', JSON.stringify(lag.issues))
// 第一发在第 6 帧冻结 5 帧：第二发从 18 顺延到 23，收尾从 36 顺延到 41。
assert.deepEqual(lag.hits.map(h => h.frame), [6, 23])
assert.ok(lag.events.some(e => e.kind === 'action-end' && e.frame === 41), JSON.stringify(lag.events.filter(e => e.kind === 'action-end')))
assert.equal(lag.timing.hitlagFrames, 5)
// 游戏时间把冻结帧扣掉，现实时间不扣：同一个动作在现实里更久。
assert.equal(lag.endFrame, 24 + 5)
assert.equal(lag.timing.gameMs, 24 * 17)
assert.ok(Math.abs(lag.timing.realMs - (24 + 5) * (1000 / 60.36144)) < 1e-9, String(lag.timing.realMs))
assert.equal(lag.accuracy, 'approximate')
assert.ok(lag.approximateItems.some(item => item.startsWith('hitlag:')))
// 效果到期也在冻结里顺延：6 帧触发、持续 40 帧，本应 46 帧到期；同帧冻结 10 帧后推到 56 帧。
const lagTrigger = {
  ...actions['itto.normal-1'], id: 'itto.lag-trigger',
  hits: [{ atFrame: 6, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true, triggerIds: ['buff'], hitlagFrames: 10 }]
}
const shifted = simulateTimeline({
  ...base, actions: { ...actions, 'itto.lag-trigger': lagTrigger },
  effects: { buff: { id: 'buff', target: 'team', stats: { atk: 100 }, durationFrames: 40 } },
  steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.lag-trigger', atFrame: 0 }]
})
assert.equal(shifted.status, 'simulated', JSON.stringify(shifted.issues))
assert.equal(shifted.triggers[0].expiresAt, 56)
assert.equal(shifted.effects[0].expiresAt, 56)
// 冷却期限也在冻结里顺延：600 帧的冷却变成 605。
const lagSkill = {
  ...actions['itto.skill'], id: 'itto.lag-skill',
  hits: [{ atFrame: 10, motionValue: 2, element: 'geo', scaling: 'atk', canCrit: true, hitlagFrames: 5 }]
}
const cool = simulateTimeline({
  ...base, measurementEndFrame: 700, actions: { ...actions, 'itto.lag-skill': lagSkill },
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.lag-skill', atFrame: 0 },
    { id: 's2', kind: 'action', actorId: 'itto', actionId: 'itto.lag-skill', atFrame: 600 }
  ]
})
assert.equal(cool.status, 'invalid')
assert.ok(cool.issues.some(i => i.path === 'steps.s2.cooldown' && i.message.includes('605')), JSON.stringify(cool.issues))
assert.equal(simulateTimeline({
  ...base, measurementEndFrame: 700, actions: { ...actions, 'itto.lag-skill': lagSkill },
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.lag-skill', atFrame: 0 },
    { id: 's2', kind: 'action', actorId: 'itto', actionId: 'itto.lag-skill', atFrame: 605 }
  ]
}).status, 'simulated')
// 固定轴把动作排进冻结期：直接拒绝，并报最早可行动帧。
// 取消窗口（10 帧）比命中（20 帧）早时，动作最早可取消帧是 70，而冻结到 80——请求 70 落在冻结里。
const frozenBurst = {
  ...actions['itto.burst'], id: 'itto.frozen', cancelWindows: [{ fromFrame: 10, toFrame: 60 }],
  hits: [{ atFrame: 20, motionValue: 3, element: 'geo', scaling: 'atk', canCrit: true, hitlagFrames: 60 }]
}
const inFrozen = simulateTimeline({
  ...base, actions: { ...actions, 'itto.frozen': frozenBurst }, actors: [{ actorId: 'itto', energy: 120, energyMax: 120 }],
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.frozen', atFrame: 0 },
    { id: 's2', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 70 }
  ]
})
assert.equal(inFrozen.status, 'invalid')
assert.ok(inFrozen.issues.some(i => i.path === 'steps.s2.hitlag' && i.message.includes('80')), JSON.stringify(inFrozen.issues))
// 冻结段若整体落在结束帧之后（取消窗口早于命中），游戏时长不能被扣成负数。
assert.ok(inFrozen.timing.gameMs >= 0, String(inFrozen.timing.gameMs))
assert.ok(inFrozen.timing.hitlagFrames <= inFrozen.endFrame, `${inFrozen.timing.hitlagFrames} > ${inFrozen.endFrame}`)
// 请求帧正好压在命中帧上：这一发的卡肉要在起手前结算，动作不能在冻结期里起手。
const sameFrameHit = simulateTimeline({
  ...base, actions: { ...actions, 'itto.frozen': frozenBurst }, actors: [{ actorId: 'itto', energy: 120, energyMax: 120 }],
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.frozen', atFrame: 0 },
    { id: 's2', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 20 }
  ]
})
assert.equal(sameFrameHit.status, 'invalid')
assert.ok(sameFrameHit.issues.some(i => i.path === 'steps.s2.hitlag'), JSON.stringify(sameFrameHit.issues))
assert.equal(sameFrameHit.requests.find(r => r.stepId === 's2').ok, false)
// 同一帧的多段命中落在同一段冻结里：不叠加顺延，也不把同一段冻结算两次。
const twinLag = simulateTimeline({
  ...base,
  actions: {
    ...actions,
    'itto.twin': {
      ...actions['itto.normal-1'], id: 'itto.twin',
      hits: [
        { atFrame: 6, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true, hitlagFrames: 10 },
        { atFrame: 6, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true, hitlagFrames: 10 }
      ]
    }
  },
  steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.twin', atFrame: 0 }]
})
assert.equal(twinLag.status, 'simulated', JSON.stringify(twinLag.issues))
assert.equal(twinLag.timing.hitlagFrames, 10, String(twinLag.timing.hitlagFrames))
assert.equal(twinLag.endFrame, 24 + 10, `${twinLag.endFrame}`)
// ASAP 轴在冻结结束时才排下一个动作，请求帧与实际帧都记录下来。
// 请求帧要落在命中之后，内核才知道冻结存在：请求 30 帧被顺延到 80 帧。
const asapLag = simulateTimeline({
  ...base, scheduler: 'asap-sequence', actions: { ...actions, 'itto.frozen': frozenBurst }, actors: [{ actorId: 'itto', energy: 120, energyMax: 120 }],
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.frozen', atFrame: 0 },
    { id: 's2', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 30 }
  ]
})
assert.equal(asapLag.status, 'simulated', JSON.stringify(asapLag.issues))
assert.equal(asapLag.requests.find(r => r.stepId === 's2').actualFrame, 80)
// 卡肉帧数必须是非负整数，且只有命中层能声明。
assert.ok(validateActionSpec(lagged).length === 0)
assert.ok(validateActionSpec({ ...lagged, hits: [{ ...lagged.hits[0], hitlagFrames: -1 }] }).some(i => i.path.endsWith('hits.0.hitlagFrames')))
assert.ok(validateActionSpec({ ...actions['itto.normal-1'], hitlagFrames: 3 }).length === 0)

// 响应型：动作时长按 `k × 帧生成时间 + bMs` 算现实时长，再向上取整到帧——换档位帧数会变。
const response = { id: 'itto.response', actorId: 'itto', kind: 'normal', timing: { type: 'response', k: 10, bMs: 100 }, hits: [{ atFrame: 6, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true }] }
const r60 = resolveActionTiming(response.timing, FRAME_TIERS['fps-60'])
assert.equal(r60.frames, 17, JSON.stringify(r60))
assert.ok(Math.abs(r60.realMs - 265.6687) < 0.01, String(r60.realMs))
assert.equal(resolveActionTiming(response.timing, FRAME_TIERS['fps-56']).frames, 16)
assert.equal(resolveActionTiming(response.timing, FRAME_TIERS['fps-625']).frames, 77)
assert.equal(r60.model, 'response')
assert.equal(resolveActionTiming(actions['itto.normal-1'].timing, FRAME_TIERS['fps-60']).frames, 36)
// 同一动作换档位，动作结束帧跟着变，命中帧不变。
const resp60 = simulateTimeline({ ...base, actions: { ...actions, 'itto.response': response }, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.response', atFrame: 0 }] })
assert.equal(resp60.status, 'simulated', JSON.stringify(resp60.issues))
assert.deepEqual(resp60.hits.map(h => h.frame), [6])
assert.equal(resp60.endFrame, 17)
const resp625 = simulateTimeline({ ...base, frameTier: FRAME_TIERS['fps-625'], actions: { ...actions, 'itto.response': response }, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.response', atFrame: 0 }] })
assert.equal(resp625.status, 'simulated', JSON.stringify(resp625.issues))
assert.equal(resp625.endFrame, 77)
// 响应型的帧上界要等档位给定后才判：60 帧的命中在 56 档放不进 16 帧的动作。
const longHit = { ...response, id: 'itto.long', hits: [{ atFrame: 60, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true }] }
const longOk = simulateTimeline({ ...base, frameTier: FRAME_TIERS['fps-625'], actions: { ...actions, 'itto.long': longHit }, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.long', atFrame: 0 }] })
assert.equal(longOk.status, 'simulated', JSON.stringify(longOk.issues))
const longBad = simulateTimeline({ ...base, frameTier: FRAME_TIERS['fps-56'], actions: { ...actions, 'itto.long': longHit }, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.long', atFrame: 0 }] })
assert.equal(longBad.status, 'invalid')
assert.ok(longBad.issues.some(i => i.path === 'actions.itto.long.hits.0.atFrame' && i.message.includes('fps-56')), JSON.stringify(longBad.issues))
// 时长口径校验：缺字段、负系数、k 与 bMs 同时为 0、未知口径都要拒绝。
assert.ok(validateActionSpec({ ...actions['itto.normal-1'], timing: undefined }).some(i => i.code === 'missing' && i.path.endsWith('timing')))
assert.ok(validateActionSpec({ ...response, timing: { type: 'response', k: -1, bMs: 0 } }).some(i => i.path.endsWith('timing.k')))
assert.ok(validateActionSpec({ ...response, timing: { type: 'response', k: 0, bMs: 0 } }).some(i => i.message.includes('不能同时为 0')))
assert.ok(validateActionSpec({ ...response, timing: { type: 'plunge', k: 1, bMs: 1 } }).some(i => i.code === 'unsupported' && i.path.endsWith('timing.type')))


assert.deepEqual(simulateTimeline({ ...base, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 0 }] }), single)

// 档位改变时长：同样是 36 帧，60 档每帧 17ms、56 档每帧 18ms，帧号不变而毫秒不同。
const tier56 = simulateTimeline({ ...base, frameTier: FRAME_TIERS['fps-56'], steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 0 }] })
assert.equal(tier56.status, 'simulated', JSON.stringify(tier56.issues))
assert.deepEqual(tier56.hits.map(h => h.frame), single.hits.map(h => h.frame))
assert.equal(single.timing.gameMs, single.endFrame * 17)
assert.equal(tier56.timing.gameMs, tier56.endFrame * 18)
assert.ok(tier56.timing.realMs < tier56.timing.gameMs)
assert.ok(Math.abs(tier56.timing.timerSecondsPerGameSecond - 0.986518) < 1e-6, String(tier56.timing.timerSecondsPerGameSecond))

// 档位校验：缺省、空 id、非正帧率、取整不自洽都要拒绝；表内每一条都要自洽。
for (const tier of Object.values(FRAME_TIERS)) assert.deepEqual(validateFrameTier(tier), [], tier.id)
assert.equal(validateFrameTier(undefined)[0].code, 'missing')
assert.equal(validateFrameTier({ id: '', fps: 0, timerTickMs: 0, source: '' }).length, 3)
const badTick = simulateTimeline({ ...base, frameTier: { ...FRAME_TIERS['fps-60'], timerTickMs: 18 }, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 0 }] })
assert.equal(badTick.status, 'invalid')
assert.ok(badTick.issues.some(i => i.path === 'frameTier.timerTickMs' && i.message.includes('应取整为 17ms')), JSON.stringify(badTick.issues))
const noTier = simulateTimeline({ ...base, frameTier: undefined, steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 0 }] })
assert.equal(noTier.status, 'invalid')
assert.ok(noTier.issues.some(i => i.code === 'missing' && i.path === 'frameTier'))

// 换人：与动作同口径，压在上一动作最早可取消帧之前就换不出去。
const duo = [{ actorId: 'itto', energy: 60, energyMax: 60 }, { actorId: 'albedo', energy: 0, energyMax: 60 }]
const duoActions = {
  ...actions,
  'itto.slow': {
    id: 'itto.slow', actorId: 'itto', kind: 'normal', timing: { type: 'frames', frames: 40 },
    hits: [
      { atFrame: 6, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true },
      { atFrame: 30, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true }
    ],
    cancelWindows: [{ fromFrame: 24, toFrame: 40 }]
  },
  'albedo.skill': {
    id: 'albedo.skill', actorId: 'albedo', kind: 'skill', timing: { type: 'frames', frames: 20 },
    hits: [{ atFrame: 5, motionValue: 2, element: 'geo', scaling: 'def', canCrit: true }]
  }
}
const earlySwitch = simulateTimeline({
  ...base, actors: duo, actions: duoActions,
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.slow', atFrame: 0 },
    { id: 's2', kind: 'switch', actorId: 'albedo', atFrame: 12 }
  ]
})
assert.equal(earlySwitch.status, 'invalid')
assert.ok(earlySwitch.issues.some(i => i.path === 'steps.s2.atFrame' && i.message.includes('最早可取消帧')), JSON.stringify(earlySwitch.issues))

// 换人打断后摇：取消帧之后尚未发生的命中与收尾都不再结算。
const cut = simulateTimeline({
  ...base, actors: duo, actions: duoActions,
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.slow', atFrame: 0 },
    { id: 's2', kind: 'switch', actorId: 'albedo', atFrame: 24 }
  ]
})
assert.equal(cut.status, 'simulated', JSON.stringify(cut.issues))
assert.deepEqual(cut.hits.map(h => h.frame), [6])
assert.equal(cut.events.some(e => e.kind === 'action-end'), false)

// 换人动画占用帧数：新前台在换人结束前不能起手，结束帧之后才可以。
const switchFrames = simulateTimeline({
  ...base, actors: duo, actions: duoActions, switchFrames: 10,
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.slow', atFrame: 0 },
    { id: 's2', kind: 'switch', actorId: 'albedo', atFrame: 24 },
    { id: 's3', kind: 'action', actorId: 'albedo', actionId: 'albedo.skill', atFrame: 30 }
  ]
})
assert.equal(switchFrames.status, 'invalid')
assert.ok(switchFrames.issues.some(i => i.path === 'steps.s3.atFrame' && i.message.includes('最早可取消帧 34')), JSON.stringify(switchFrames.issues))
const afterSwitch = simulateTimeline({
  ...base, actors: duo, actions: duoActions, switchFrames: 10,
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.slow', atFrame: 0 },
    { id: 's2', kind: 'switch', actorId: 'albedo', atFrame: 24 },
    { id: 's3', kind: 'action', actorId: 'albedo', actionId: 'albedo.skill', atFrame: 34 }
  ]
})
assert.equal(afterSwitch.status, 'simulated', JSON.stringify(afterSwitch.issues))
assert.deepEqual(afterSwitch.hits.map(h => [h.frame, h.actorId]), [[6, 'itto'], [39, 'albedo']])

// 换人请求帧超出测量窗口同样拒绝，不能只在动作上判窗口。
const lateSwitch = simulateTimeline({
  ...base, actors: duo, actions: duoActions,
  steps: [
    { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.slow', atFrame: 0 },
    { id: 's2', kind: 'switch', actorId: 'albedo', atFrame: 500 }
  ]
})
assert.equal(lateSwitch.status, 'invalid')
assert.ok(lateSwitch.issues.some(i => i.path === 'steps.s2.atFrame' && i.message.includes('超出测量窗口')), JSON.stringify(lateSwitch.issues))
console.log('team-sim-timeline: passed; integer-frame scheduling, cancel windows, cooldown, energy, frame tier, switch semantics and determinism checked')

// 延迟命中：由后续事件触发的命中可以越过动作结束帧，且不被后续动作取消。
const delayedActions = {
  ...actions,
  'itto.q': {
    id: 'itto.q', actorId: 'itto', kind: 'burst', timing: { type: 'frames', frames: 56 },
    hits: [
      { atFrame: 31, motionValue: 3, element: 'geo', scaling: 'atk', canCrit: true },
      { atFrame: 121, motionValue: 1.34, element: 'geo', scaling: 'atk', canCrit: true, delayed: true }
    ]
  }
}
const delayedRun = simulateTimeline({
  ...base, actions: delayedActions,
  steps: [
    { id: 'q', kind: 'action', actorId: 'itto', actionId: 'itto.q', atFrame: 0 },
    { id: 'n', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 60 }
  ]
})
assert.equal(delayedRun.status, 'simulated', JSON.stringify(delayedRun.issues))
assert.deepEqual(delayedRun.hits.map(hit => hit.frame), [31, 66, 78, 121])

const overflowSpec = { id: 'itto.over', actorId: 'itto', kind: 'burst', timing: { type: 'frames', frames: 56 }, hits: [{ atFrame: 121, motionValue: 1, element: 'geo', scaling: 'atk', canCrit: true }] }
assert.ok(validateActionSpec(overflowSpec).some(issue => issue.path.endsWith('.hits.0.atFrame')), '未标 delayed 的越界命中必须拒')
assert.equal(validateActionSpec({ ...overflowSpec, hits: [{ ...overflowSpec.hits[0], delayed: true }] }).length, 0)
assert.ok(validateActionSpec({ ...overflowSpec, hits: [{ ...overflowSpec.hits[0], delayed: 'yes' }] }).some(issue => issue.path.endsWith('.delayed')), 'delayed 必须是布尔值')

// 延迟产球（2026-11-02）：召唤物在动作结束后产球，允许 atFrame 超出动作时长，且不会被下一个动作取消。
{
  const summon = {
    id: 'itto.summon', actorId: 'itto', kind: 'skill', timing: { type: 'frames', frames: 20 }, hits: [],
    delayedParticles: [{ atFrame: 40, count: 2, element: 'geo', travelFrames: 0 }]
  }
  assert.equal(validateActionSpec(summon).length, 0, '延迟产球允许超出动作时长')
  const beyond = { ...summon, particles: [{ atFrame: 40, count: 2, element: 'geo', travelFrames: 0 }] }
  assert.ok(validateActionSpec(beyond).some(issue => issue.path.endsWith('.particles.0.atFrame')), '普通产球仍不许越界')
  assert.ok(validateActionSpec({ ...summon, delayedParticles: [{ atFrame: -1, count: 1, element: 'geo', travelFrames: 0 }] }).some(issue => issue.path.endsWith('.delayedParticles.0.atFrame')), '延迟产球帧必须非负')

  // 第一个动作在 0 帧，20 帧结束；第二个动作 30 帧开始。粒子在 40 帧到账，不该被第二个动作取消。
  const sharedRun = simulateTimeline({
    ...base,
    actions: { ...actions, 'itto.summon': summon },
    actors: [{ actorId: 'itto', energy: 0, energyMax: 60 }, { actorId: 'gorou', energy: 0, energyMax: 80 }],
    steps: [
      { id: 'a', kind: 'action', actorId: 'itto', actionId: 'itto.summon', atFrame: 0 },
      { id: 'a2', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 30 }
    ]
  })
  assert.equal(sharedRun.status, 'simulated', JSON.stringify(sharedRun.issues))
  const energyEvents = sharedRun.events.filter(event => event.kind === 'particle')
  assert.equal(energyEvents.length, 1)
  assert.equal(energyEvents[0].frame, 40)
  // 产球按队伍共享：两名角色都按自己的倍率回能（缺省 1×）。
  assert.equal(sharedRun.actors.find(a => a.actorId === 'itto').energy, 2)
  assert.equal(sharedRun.actors.find(a => a.actorId === 'gorou').energy, 2)
}

// 动作直接回能（2026-11-02）：爆发类动作在指定帧给全队或自己加能量，且不会被下一个动作取消。
{
  const burst = {
    id: 'itto.burst2', actorId: 'itto', kind: 'burst', timing: { type: 'frames', frames: 20 }, hits: [],
    energyRestore: [
      { atFrame: 5, amount: 2, target: 'team' },
      // self 且按充能效率放大：ER 2.0 → 1 + 0.006×100 = 1.6 倍
      { atFrame: 30, amount: 1, target: 'self', rechargeScaling: true }
    ]
  }
  assert.equal(validateActionSpec(burst).length, 0)
  assert.ok(validateActionSpec({ ...burst, energyRestore: [{ atFrame: 1, amount: 1, target: 'party' }] }).some(issue => issue.path.endsWith('.energyRestore.0.target')), '回能目标只认 team/self')
  assert.ok(validateActionSpec({ ...burst, energyRestore: [{ atFrame: -1, amount: 1 }] }).some(issue => issue.path.endsWith('.energyRestore.0.atFrame')), '回能帧必须非负')

  const run = simulateTimeline({
    ...base,
    actions: { ...actions, 'itto.burst2': burst },
    energyRecharge: { itto: 2 },
    actors: [{ actorId: 'itto', energy: 0, energyMax: 60 }, { actorId: 'gorou', energy: 0, energyMax: 80 }],
    steps: [
      { id: 'b', kind: 'action', actorId: 'itto', actionId: 'itto.burst2', atFrame: 0 },
      { id: 'n', kind: 'action', actorId: 'itto', actionId: 'itto.normal-1', atFrame: 25 }
    ]
  })
  assert.equal(run.status, 'simulated', JSON.stringify(run.issues))
  const restores = run.events.filter(event => event.kind === 'energy-restore')
  assert.equal(restores.length, 2)
  assert.equal(restores[0].frame, 5)
  assert.equal(restores[1].frame, 30, 'self 回能按动作起手 + atFrame 落在 30 帧，且不被 25 帧开始的普攻取消')
  assert.equal(run.actors.find(a => a.actorId === 'itto').energy, 2 + 1.6)
  assert.equal(run.actors.find(a => a.actorId === 'gorou').energy, 2)
}

