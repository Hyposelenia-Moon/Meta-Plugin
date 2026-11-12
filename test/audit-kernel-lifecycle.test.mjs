import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidenceRoot = path.join(root, 'test/fixtures/audit-20261110')
const fixtures = JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'new-kernel-current.json'), 'utf8'))
const K = await import(pathToFileURL(path.join(root, 'lib/modules/teamSimulation/index.js')).href)
const bubbleId = 'artifact-set:400194:4pc'
const run = input => {
  const result = K.simulateTimeline(input)
  assert.equal(result.status, 'simulated', JSON.stringify(result.issues))
  return result
}
const bubbles = result => result.hits.filter(hit => hit.actionId === bubbleId)

for (const auraMode of ['declared', 'simulated']) {
  test(`${auraMode}: teammate healing cannot trigger the wearer bubble`, () => {
    const input = structuredClone(fixtures.healingByTeammate.input)
    input.auraMode = auraMode
    assert.equal(bubbles(run(input)).length, 0)
  })
  test(`${auraMode}: a formed bubble survives the next action`, () => {
    const input = structuredClone(fixtures.bubbleAfterNextAction.input)
    input.auraMode = auraMode
    const hits = bubbles(run(input))
    assert.equal(hits.length, 1)
    assert.equal(hits[0].frame, 190)
    assert.equal(hits[0].actorId, 'wearer')
    assert.equal(hits[0].fixedDamage, 900)
  })
}

test('the next action still cancels an ordinary future hit while keeping a formed bubble', () => {
  const input = structuredClone(fixtures.bubbleAfterNextAction.input)
  const action = input.actions['healer.skill']
  action.timing.frames = 200
  action.cancelWindows = [{ fromFrame: 20, toFrame: 150 }]
  action.hits.push({ ...action.hits[0], atFrame: 120 })
  const result = run(input)
  assert.deepEqual(result.hits.filter(hit => hit.actionId === action.id).map(hit => hit.frame), [15])
  assert.equal(bubbles(result).length, 1)
})

test('two wearers retain their own bubble attribution across separate cooldown windows', () => {
  const input = structuredClone(fixtures.bubbleAfterNextAction.input)
  input.measurementEndFrame = 600
  input.switchFrames = 0
  input.effectTriggers.push({ effectId: bubbleId, actorId: 'teammate', on: 'always' })
  input.actions['teammate.skill'] = { ...structuredClone(input.actions['healer.skill']), id: 'teammate.skill', actorId: 'teammate' }
  input.steps = [
    input.steps[0],
    { id: 'switch', kind: 'switch', actorId: 'teammate', atFrame: 250 },
    { id: 'heal-again', kind: 'action', actorId: 'teammate', actionId: 'teammate.skill', atFrame: 260 }
  ]
  assert.deepEqual(bubbles(run(input)).map(hit => ({ actorId: hit.actorId, frame: hit.frame })), [
    { actorId: 'wearer', frame: 190 },
    { actorId: 'teammate', frame: 450 }
  ])
})

test('a repeated wearer heal within the bubble cooldown keeps exactly the first bubble', () => {
  const input = structuredClone(fixtures.bubbleAfterNextAction.input)
  input.steps[1] = { id: 'heal-again', kind: 'action', actorId: 'wearer', actionId: 'healer.skill', atFrame: 60 }
  assert.deepEqual(bubbles(run(input)).map(hit => hit.frame), [190])
})

test('all shipped packs remain valid in every supported frame tier', () => {
  const invalid = []
  let checked = 0
  for (const file of fs.readdirSync(path.join(root, 'data/team-sim/packs')).filter(file => file.endsWith('.json'))) {
    const pack = JSON.parse(fs.readFileSync(path.join(root, 'data/team-sim/packs', file), 'utf8'))
    assert.equal(K.validateDataPack(pack).status, 'ok', `${file} input`)
    for (const tier of Object.keys(K.FRAME_TIERS)) {
      checked += 1
      const result = K.validateDataPack(K.convertPackToFrameTier(pack, tier))
      if (result.status !== 'ok') invalid.push({ file, tier, issues: result.issues })
    }
  }
  assert.ok(checked > 0)
  assert.deepEqual(invalid, [])
})

test('the shipped Ayaka fourth normal attack runs after fps-56 conversion', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'data/team-sim/packs/kamisatoayaka.json'), 'utf8'))
  const pack = K.convertPackToFrameTier(raw, 'fps-56')
  const actionId = 'kamisatoayaka.normal-4'
  const timeline = run({
    scheduler: 'fixed', actions: pack.actions, frameTier: K.FRAME_TIERS['fps-56'],
    measurementEndFrame: 100, activeActorId: 'kamisatoayaka',
    actors: [{ actorId: 'kamisatoayaka', energy: 0, energyMax: 60 }],
    steps: [{ id: 'normal', kind: 'action', actorId: 'kamisatoayaka', actionId, atFrame: 0 }]
  })
  assert.equal(timeline.hits.length, 3)
})

test('downward conversion keeps delayed events outside the action duration', () => {
  const pack = {
    schemaVersion: 1, gameVersion: '7.1', source: 'audit-synthetic',
    actions: {
      'a.skill': {
        id: 'a.skill', actorId: 'a', kind: 'skill', timing: { type: 'frames', frames: 23 },
        hits: [
          { atFrame: 22, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: false },
          { atFrame: 100, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: false, delayed: true }
        ],
        particles: [{ atFrame: 22, travelFrames: 3, count: 1, element: 'hydro' }],
        delayedParticles: [{ atFrame: 100, travelFrames: 3, count: 1, element: 'hydro' }]
      }
    }
  }
  assert.equal(K.validateDataPack(pack).status, 'ok')
  const converted = K.convertPackToFrameTier(pack, 'fps-56')
  assert.equal(K.validateDataPack(converted).status, 'ok')
  const action = converted.actions['a.skill']
  assert.ok(action.hits[0].atFrame < action.timing.frames)
  assert.ok(action.particles[0].atFrame < action.timing.frames)
  assert.ok(action.hits[1].atFrame > action.timing.frames)
  assert.ok(action.delayedParticles[0].atFrame > action.timing.frames)
  assert.equal(action.hits[1].delayed, true)
  assert.equal(pack.actions['a.skill'].timing.frames, 23)
})

test('downward conversion keeps a supported response action long enough for its final hit', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'data/team-sim/packs/kamisatoayaka.json'), 'utf8'))
  const actionId = 'kamisatoayaka.normal-4'
  raw.actions[actionId].timing = { type: 'response', k: 23, bMs: 0 }
  const pack = K.convertPackToFrameTier(raw, 'fps-56')
  const result = run({
    scheduler: 'fixed', actions: pack.actions, frameTier: K.FRAME_TIERS['fps-56'],
    measurementEndFrame: 100, activeActorId: 'kamisatoayaka',
    actors: [{ actorId: 'kamisatoayaka', energy: 0, energyMax: 60 }],
    steps: [{ id: 'normal', kind: 'action', actorId: 'kamisatoayaka', actionId, atFrame: 0 }]
  })
  assert.equal(result.hits.length, 3)
  assert.equal(pack.actions[actionId].timing.bMs, 0)
})
