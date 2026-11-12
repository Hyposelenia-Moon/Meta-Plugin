import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidenceRoot = path.join(root, 'test/fixtures/audit-20261110')
const fixtures = JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'side-effects-current.json'), 'utf8'))
const K = await import(pathToFileURL(path.join(root, 'lib/modules/teamSimulation/index.js')).href)
const effectId = 'artifact-set:400094:4pc-shred'
const run = input => {
  const result = K.simulateTimeline(input)
  assert.equal(result.status, 'simulated', JSON.stringify(result.issues))
  return result
}
const pyroProbe = result => result.hits.find(hit => hit.frame === 60)

for (const count of [1, 2, 3]) {
  test(`${count} same-element swirl triggers keep one refreshed 40% resistance reduction`, () => {
    const input = structuredClone(count === 1 ? fixtures.one.input : count === 2 ? fixtures.twice.input : fixtures.three.input)
    assert.equal(pyroProbe(run(input)).modifiers.enemy.resistanceByElement.pyro, 0.4)
  })
}

test('different elements keep independent refresh and expiry windows', () => {
  const input = structuredClone(fixtures.one.input)
  input.effects[effectId].durationFrames = 30
  const swirl = (atFrame, aura) => ({ atFrame, motionValue: 1, scaling: 'atk', element: 'anemo', canCrit: false, reaction: { kind: 'swirl', aura } })
  const probe = (atFrame, element) => ({ atFrame, motionValue: 1, scaling: 'atk', element, canCrit: false })
  input.actions['a.skill'].hits = [
    swirl(10, 'pyro'), swirl(20, 'hydro'), swirl(30, 'pyro'),
    probe(45, 'pyro'), probe(45, 'hydro'), probe(55, 'pyro'), probe(55, 'hydro'), probe(61, 'pyro')
  ]
  const result = run(input)
  const reduction = (frame, element) => result.hits.find(hit => hit.frame === frame && hit.element === element).modifiers.enemy.resistanceByElement?.[element] ?? 0
  assert.equal(reduction(45, 'pyro'), 0.4)
  assert.equal(reduction(45, 'hydro'), 0.4)
  assert.equal(reduction(55, 'pyro'), 0.4)
  assert.equal(reduction(55, 'hydro'), 0)
  assert.equal(reduction(61, 'pyro'), 0)
})

test('independent effect ids still add their resistance reductions', () => {
  const input = structuredClone(fixtures.twice.input)
  const otherId = 'audit-independent-shred'
  input.effects[otherId] = { ...structuredClone(input.effects[effectId]), id: otherId }
  input.effectTriggers.push({ effectId: otherId, actorId: 'a', on: 'reaction' })
  assert.equal(pyroProbe(run(input)).modifiers.enemy.resistanceByElement.pyro, 0.8)
})

test('elemental damage bonuses follow the same refresh policy', () => {
  const input = structuredClone(fixtures.three.input)
  delete input.effects[effectId].resistanceShred
  input.effects[effectId].elementDmg = { value: 0.2, from: 'reaction-aura' }
  assert.equal(pyroProbe(run(input)).modifiers.stats.pyro, 0.2)
})

test('team composition bonuses follow the same refresh policy', () => {
  const input = structuredClone(fixtures.three.input)
  delete input.effects[effectId].resistanceShred
  input.effects[effectId].target = 'self'
  input.effects[effectId].scalesWithTeamElements = { same: { stat: 'atkPct', value: 0.14 }, different: { stat: 'mastery', value: 50 } }
  input.elements = { a: 'anemo', b: 'anemo', c: 'hydro' }
  const stats = pyroProbe(run(input)).modifiers.stats
  assert.equal(stats.atkPct, 0.14)
  assert.equal(stats.mastery, 50)
})

test('a supported stack policy uses the effect runtime stack cap', () => {
  const input = structuredClone(fixtures.three.input)
  input.effects[effectId].stacking = 'stack'
  input.effects[effectId].maxStacks = 2
  input.effects[effectId].resistanceShred.value = 0.2
  assert.equal(pyroProbe(run(input)).modifiers.enemy.resistanceByElement.pyro, 0.4)
})

test('a supported ignore policy keeps the original expiry', () => {
  const input = structuredClone(fixtures.twice.input)
  input.effects[effectId].stacking = 'ignore'
  input.effects[effectId].durationFrames = 45
  assert.equal(pyroProbe(run(input)).modifiers.enemy.resistanceByElement?.pyro ?? 0, 0)
})
