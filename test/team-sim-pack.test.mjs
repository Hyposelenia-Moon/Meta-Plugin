import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mod } from './_helper.mjs'

const { validateDataPack } = await import(mod('modules/teamSimulation/dataPack.js'))
const { validateRotation } = await import(mod('modules/teamSimulation/rotation.js'))
const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))

const normal = {
  id: 'itto.normal-1', actorId: 'actor:itto', kind: 'normal', timing: { type: 'frames', frames: 36 },
  hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true }]
}
const skill = {
  id: 'albedo.skill', actorId: 'actor:albedo', kind: 'skill', timing: { type: 'frames', frames: 30 }, cooldownFrames: 600, cooldownId: 'skill',
  hits: [{ atFrame: 10, motionValue: 2, scaling: 'def', element: 'geo', canCrit: true }]
}
const pack = {
  schemaVersion: 1,
  gameVersion: '7.1',
  source: 'synthetic-pack',
  actions: { 'itto.normal-1': normal, 'albedo.skill': skill }
}

const okPack = validateDataPack(pack)
assert.equal(okPack.status, 'ok', JSON.stringify(okPack.issues))
assert.deepEqual(okPack.issues, [])

// 版本、出处、动作表都必须显式给出：缺一个就不能当数据包用。
const wrongVersion = validateDataPack({ ...pack, schemaVersion: 2 })
assert.equal(wrongVersion.status, 'version-mismatch')
assert.ok(wrongVersion.issues.some(i => i.path === 'pack.schemaVersion'))
const noGameVersion = validateDataPack({ ...pack, gameVersion: '  ' })
assert.ok(noGameVersion.issues.some(i => i.path === 'pack.gameVersion' && i.code === 'invalid'))
const missingSource = validateDataPack({ ...pack, source: undefined })
assert.ok(missingSource.issues.some(i => i.path === 'pack.source' && i.code === 'missing'))
const emptyActions = validateDataPack({ ...pack, actions: {} })
assert.equal(emptyActions.status, 'invalid')
assert.ok(emptyActions.issues.some(i => i.path === 'pack.actions'))
const notObject = validateDataPack([])
assert.equal(notObject.status, 'invalid')

// 动作 id 必须与键一致，动作本身再走 validateActionSpec。
const idMismatch = validateDataPack({ ...pack, actions: { 'itto.normal-1': { ...normal, id: 'itto.normal-2' } } })
assert.equal(idMismatch.status, 'invalid')
assert.ok(idMismatch.issues.some(i => i.path === 'actions.itto.normal-1.id'))
const badAction = validateDataPack({ ...pack, actions: { 'itto.normal-1': { ...normal, hits: [{ atFrame: 6, motionValue: 1, element: 'geo', canCrit: true }] } } })
assert.equal(badAction.status, 'incomplete')
assert.ok(badAction.issues.some(i => i.path === 'actions.itto.normal-1.hits.0.scaling' && i.code === 'missing'))
const unknownElement = validateDataPack({ ...pack, actions: { 'itto.normal-1': { ...normal, hits: [{ ...normal.hits[0], element: 'rock' }] } } })
assert.equal(unknownElement.status, 'unsupported')
assert.ok(unknownElement.issues.some(i => i.path === 'actions.itto.normal-1.hits.0.element'))
const badTriggerList = validateDataPack({ ...pack, actions: { 'itto.normal-1': { ...normal, hits: [{ ...normal.hits[0], triggerIds: 'itto.hit' }] } } })
assert.equal(badTriggerList.status, 'invalid')
assert.ok(badTriggerList.issues.some(i => i.path === 'actions.itto.normal-1.hits.0.triggerIds'))
const badTriggerId = validateDataPack({ ...pack, actions: { 'itto.normal-1': { ...normal, hits: [{ ...normal.hits[0], triggerIds: ['itto.hit', ' '] }] } } })
assert.equal(badTriggerId.status, 'invalid')
assert.ok(badTriggerId.issues.some(i => i.path === 'actions.itto.normal-1.hits.0.triggerIds.1'), JSON.stringify(badTriggerId.issues))

const rotation = {
  id: 'rotation:synthetic',
  scheduler: 'fixed',
  frameTier: FRAME_TIERS['fps-60'],
  measurementEndFrame: 120,
  steps: [
    { id: 's1', kind: 'action', actorId: 'actor:itto', actionId: 'itto.normal-1', atFrame: 0 },
    { id: 's2', kind: 'switch', actorId: 'actor:albedo', atFrame: 36 },
    { id: 's3', kind: 'action', actorId: 'actor:albedo', actionId: 'albedo.skill', atFrame: 36 }
  ],
  actors: [{ actorId: 'actor:itto', energy: 0, energyMax: 60 }, { actorId: 'actor:albedo', energy: 0, energyMax: 40 }],
  activeActorId: 'actor:itto'
}
assert.deepEqual(validateRotation(rotation, pack), [])

// 引用包里没有的动作必须拒绝，不能跑空。
const unknownAction = validateRotation({ ...rotation, steps: [{ id: 's1', kind: 'action', actorId: 'actor:itto', actionId: 'itto.burst' }] }, pack)
assert.equal(unknownAction.length, 1)
assert.equal(unknownAction[0].code, 'unsupported')
assert.equal(unknownAction[0].path, 'rotation.steps.0.actionId')
const noPack = validateRotation(rotation, undefined)
assert.ok(noPack.some(i => i.code === 'unsupported' && i.path === 'rotation.steps.0.actionId'))

// 帧率档位、窗口、步骤类型、切人目标、初始资源都必须显式且合法。
const noTier = validateRotation({ ...rotation, frameTier: undefined }, pack)
assert.ok(noTier.some(i => i.code === 'missing' && i.path === 'rotation.frameTier'))
const badTier = validateRotation({ ...rotation, frameTier: { ...FRAME_TIERS['fps-60'], timerTickMs: 18 } }, pack)
assert.ok(badTier.some(i => i.code === 'invalid' && i.path === 'rotation.frameTier.timerTickMs'))
const zeroWindow = validateRotation({ ...rotation, measurementEndFrame: 0 }, pack)
assert.ok(zeroWindow.some(i => i.path === 'rotation.measurementEndFrame'))
const badKind = validateRotation({ ...rotation, steps: [{ id: 's1', kind: 'dash' }] }, pack)
assert.equal(badKind[0].code, 'unsupported')
assert.ok(badKind.some(i => i.path === 'rotation.steps.0.kind'))
const badWait = validateRotation({ ...rotation, steps: [{ id: 's1', kind: 'wait', frames: 0 }] }, pack)
assert.ok(badWait.some(i => i.path === 'rotation.steps.0.frames'))
const dupActor = validateRotation({ ...rotation, actors: [...rotation.actors, { actorId: 'actor:itto', energy: 0, energyMax: 60 }] }, pack)
assert.ok(dupActor.some(i => i.code === 'invalid' && i.message.includes('重复')))
const overEnergy = validateRotation({ ...rotation, actors: [{ actorId: 'actor:itto', energy: 70, energyMax: 60 }] }, pack)
assert.ok(overEnergy.some(i => i.path === 'rotation.actors.0.energy'))
const badActive = validateRotation({ ...rotation, activeActorId: 'actor:unknown' }, pack)
assert.ok(badActive.some(i => i.path === 'rotation.activeActorId'))
const badRecharge = validateRotation({ ...rotation, energyRecharge: { 'actor:itto': 0 } }, pack)
assert.ok(badRecharge.some(i => i.path === 'rotation.energyRecharge.actor:itto'))
// 充能效率的键必须是已登记角色，写错 id 会被内核查不到、静默忽略。
const ghostRecharge = validateRotation({ ...rotation, energyRecharge: { 'actor:itto': 1.5, 'actor:ghost': 1.2 } }, pack)
assert.ok(ghostRecharge.some(i => i.path === 'rotation.energyRecharge.actor:ghost' && i.message.includes('登记')), JSON.stringify(ghostRecharge))
assert.ok(!ghostRecharge.some(i => i.path === 'rotation.energyRecharge.actor:itto'))
const noRotation = validateRotation(undefined, pack)
assert.equal(noRotation[0].code, 'missing')

// 示例包：仓库里的示例 JSON 必须原样通过校验并能跑通一轮，这是录入侧的验收线。
const examplePack = JSON.parse(fs.readFileSync(new URL('./fixtures/team-sim/example-pack.json', import.meta.url), 'utf8'))
const exampleOk = validateDataPack(examplePack)
assert.equal(exampleOk.status, 'ok', JSON.stringify(exampleOk.issues))
const exampleRotation = {
  id: 'rotation:example',
  scheduler: 'fixed',
  frameTier: FRAME_TIERS['fps-60'],
  measurementEndFrame: 200,
  steps: [
    { id: 'e1', kind: 'action', actorId: 'actor:example-a', actionId: 'example.normal-1', atFrame: 0 },
    { id: 'e2', kind: 'switch', actorId: 'actor:example-b', atFrame: 24 },
    { id: 'e3', kind: 'action', actorId: 'actor:example-b', actionId: 'example.skill', atFrame: 24 }
  ],
  actors: [{ actorId: 'actor:example-a', energy: 0, energyMax: 60 }, { actorId: 'actor:example-b', energy: 0, energyMax: 40 }],
  activeActorId: 'actor:example-a'
}
assert.deepEqual(validateRotation(exampleRotation, examplePack), [])
const smoke = simulateTimeline({
  scheduler: exampleRotation.scheduler,
  steps: exampleRotation.steps,
  actions: examplePack.actions,
  actors: exampleRotation.actors,
  activeActorId: exampleRotation.activeActorId,
  frameTier: exampleRotation.frameTier,
  measurementEndFrame: exampleRotation.measurementEndFrame
})
assert.equal(smoke.status, 'simulated', JSON.stringify(smoke.issues))
assert.deepEqual(smoke.hits.map(h => h.frame), [6, 18, 30])

// 步骤里出现的角色必须在 rotation.actors 登记：否则内核拿不到能量与冷却状态。
const rosterMiss = validateRotation({ ...exampleRotation, actors: [{ actorId: 'actor:example-a', energy: 0, energyMax: 60 }] }, examplePack)
assert.ok(rosterMiss.some(i => i.path === 'rotation.steps.1.actorId' && i.message.includes('登记')), JSON.stringify(rosterMiss))

console.log('team-sim-pack ok')
