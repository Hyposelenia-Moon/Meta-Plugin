import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS } = await import(mod('modules/teamSimulation/timeline.js'))
const { recordingToRotation, validateRecording } = await import(mod('modules/teamSimulation/recording.js'))
const { evaluateReleaseGate, formatReleaseGate } = await import(mod('modules/teamSimulation/gate.js'))

const tier = FRAME_TIERS['fps-60']
const msPerFrame = 1000 / tier.fps
const frame = (n) => Math.round(n * msPerFrame)

const recording = (overrides = {}) => ({
  schemaVersion: 1,
  frameTierId: 'fps-60',
  keymapVersion: 'keys-1',
  gameVersion: '7.1',
  source: 'synthetic-recording',
  start: {
    activeActorId: 'actor:a',
    actors: [
      { actorId: 'actor:a', energy: 0, energyMax: 60, cooldowns: {} },
      { actorId: 'actor:b', energy: 0, energyMax: 60, cooldowns: {} }
    ]
  },
  events: [
    { atMs: frame(0), key: 'j', phase: 'down' },
    { atMs: frame(0) + 30, key: 'j', phase: 'up' },
    { atMs: frame(40), key: '2', phase: 'down' },
    { atMs: frame(40) + 20, key: '2', phase: 'up' },
    { atMs: frame(42), key: 'e', phase: 'down' }
  ],
  ...overrides
})

const keymap = {
  version: 'keys-1',
  bindings: {
    j: { actorId: 'actor:a', actionId: 'itto.normal-1' },
    '2': { actorId: 'actor:b', switch: true },
    e: { actorId: 'actor:b', actionId: 'itto.skill' }
  }
}

// 1. 校验：版本、档位、单调、元数据
assert.equal(validateRecording(recording({ schemaVersion: 2 })).status, 'version-mismatch')
assert.equal(validateRecording(recording({ frameTierId: 'fps-999' })).status, 'unsupported')

const unordered = recording()
unordered.events = [
  { atMs: 500, key: 'j', phase: 'down' },
  { atMs: 100, key: 'e', phase: 'down' }
]
const unorderedResult = validateRecording(unordered)
assert.equal(unorderedResult.status, 'invalid')
assert.ok(unorderedResult.issues.some(issue => issue.path === 'recording.events.1.atMs'))

const noMetadata = recording({ source: '  ' })
assert.equal(validateRecording(noMetadata).status, 'invalid')

const emptyEvents = recording({ events: [{ atMs: 0, key: 'j', phase: 'up' }] })
assert.equal(validateRecording(emptyEvents).status, 'invalid')

// 2. 转换：按下才成步骤、帧号四舍五入、switch 绑定
const converted = recordingToRotation(recording(), keymap, { id: 'rotation:rec', measurementEndFrame: frame(120) })
assert.equal(converted.status, 'ok')
assert.deepEqual(converted.rotation.steps, [
  { id: 'step-1', kind: 'action', actorId: 'actor:a', actionId: 'itto.normal-1', atFrame: 0 },
  { id: 'step-2', kind: 'switch', actorId: 'actor:b', atFrame: 40 },
  { id: 'step-3', kind: 'action', actorId: 'actor:b', actionId: 'itto.skill', atFrame: 42 }
])
assert.equal(converted.rotation.frameTier.id, 'fps-60')
assert.equal(converted.rotation.activeActorId, 'actor:a')

// 同时刻两键、相对时序单调
assert.deepEqual(validateRecording(recording()).issues, [])

// 3. 键位表版本不一致、未知键、窗口过小
assert.equal(recordingToRotation(recording(), { ...keymap, version: 'keys-2' }, { id: 'r', measurementEndFrame: frame(120) }).status, 'invalid')

const unknownKey = recording({
  events: [{ atMs: 0, key: 'z', phase: 'down' }]
})
const unknownKeyResult = recordingToRotation(unknownKey, keymap, { id: 'r', measurementEndFrame: 2000 })
assert.equal(unknownKeyResult.status, 'unsupported')

const smallWindow = recordingToRotation(recording(), keymap, { id: 'r', measurementEndFrame: 30 })
assert.equal(smallWindow.status, 'invalid')
assert.ok(smallWindow.issues.some(issue => issue.path === 'options.measurementEndFrame'))

// 4. 交给 validateRotation 时能报未知动作
const pack = {
  schemaVersion: 1,
  gameVersion: '7.1',
  source: 'synthetic-pack',
  actions: {
    'itto.skill': {
      id: 'itto.skill', element: 'geo',
      timing: { type: 'frames', frames: 30 },
      hits: [{ atFrame: 10, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true }]
    }
  }
}
const withPack = recordingToRotation(recording(), keymap, { id: 'r', measurementEndFrame: frame(120) }, pack)
assert.equal(withPack.status, 'unsupported')
assert.ok(withPack.issues.some(issue => issue.path === 'rotation.steps.0.actionId'))

// 5. 发布闸门：三态与六关
const failed = { status: 'invalid' }
assert.equal(evaluateReleaseGate({ result: failed }).status, 'blocked')
assert.deepEqual(evaluateReleaseGate({ result: failed }).blocking, ['run'])

const base = {
  status: 'calculated',
  mode: 'dps-standard',
  checks: [],
  versions: { pack: '7.1', panels: '7.1' },
  timeline: { accuracy: 'verified', approximateItems: [], endFrame: 100, events: [], hits: [] },
  damage: { status: 'calculated', total: 1, rows: [], perActor: {}, byAction: {} },
  plan: { checks: [] },
  dps: { total: 1, windowSeconds: 120, value: 0.008 }
}

const goldenCase = (id) => ({ id, kind: 'measured', source: 'synthetic', expected: { total: 100 } })
const goldenActual = (id) => ({ id, total: 100 })

// 诊断口径被拦
assert.deepEqual(evaluateReleaseGate({ result: { ...base, mode: 'diagnostic' } }).blocking, ['mode'])

// 近似项被拦
const approximate = evaluateReleaseGate({ result: { ...base, timeline: { ...base.timeline, accuracy: 'approximate', approximateItems: ['hitlag:x'] } } })
assert.deepEqual(approximate.blocking, ['accuracy'])

// 未知反应家族被拦
const unknownReaction = evaluateReleaseGate({ result: base, reactions: ['unknown-family'] })
assert.deepEqual(unknownReaction.blocking, ['reactions'])

// 机制违规被拦
const violation = evaluateReleaseGate({ result: { ...base, plan: { checks: [{ id: 'itto.stacks', status: 'violation', message: '逆袈裟需要至少 1 层' }] } } })
assert.deepEqual(violation.blocking, ['resources'])

// 黄金集不足
const notEnough = evaluateReleaseGate({ result: base, golden: { cases: [goldenCase('g1')], actuals: [goldenActual('g1')] } })
assert.equal(notEnough.status, 'insufficient-data')
assert.ok(notEnough.checks.some(check => check.id === 'golden' && check.status === 'insufficient-data'))

// 十例达标 → pass
const ten = Array.from({ length: 10 }, (_, i) => `g${i + 1}`)
const pass = evaluateReleaseGate({
  result: base,
  golden: { cases: ten.map(goldenCase), actuals: ten.map(goldenActual) }
})
assert.equal(pass.status, 'pass')
assert.deepEqual(pass.blocking, [])
assert.ok(formatReleaseGate(pass)[0] === '发布闸门：pass')

// 黄金集超差 → blocked
const off = evaluateReleaseGate({
  result: base,
  golden: { cases: ten.map(goldenCase), actuals: ten.map(id => ({ id, total: 130 })) }
})
assert.equal(off.status, 'blocked')
assert.deepEqual(off.blocking, ['golden'])

console.log('team-sim-p5 ok')
