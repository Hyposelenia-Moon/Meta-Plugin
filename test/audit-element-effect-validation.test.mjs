import assert from 'node:assert/strict'
import { validateDataPack } from '../lib/modules/teamSimulation/index.js'

const effectId = 'fixture-deepwood'
const pack = enemy => ({
  schemaVersion: 1, gameVersion: '7.1', source: 'synthetic-audit-fixture',
  actions: { 'fixture.skill': { id: 'fixture.skill', actorId: 'fixture', kind: 'skill', timing: { type: 'frames', frames: 60 }, hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'dendro', canCrit: false }] } },
  effects: { [effectId]: { id: effectId, target: 'enemy', durationFrames: 480, trigger: 'hit', hitElements: ['dendro'], enemy } }
})
const rows = []
for (const [name, enemy, expected] of [
  ['deepwood element map', { resistanceByElement: { dendro: 0.3 } }, 'ok'],
  ['global and element reductions combine', { resistanceReduction: 0.1, resistanceByElement: { dendro: 0.3 } }, 'ok'],
  ['legacy global reduction', { resistanceReduction: 0.2 }, 'ok'],
  ['unknown element', { resistanceByElement: { unknown: 0.3 } }, 'unsupported'],
  ['non-finite amount', { resistanceByElement: { dendro: Infinity } }, 'invalid'],
  ['string amount', { resistanceByElement: { dendro: '0.3' } }, 'invalid'],
  ['array map', { resistanceByElement: [] }, 'invalid'],
  ['null map', { resistanceByElement: null }, 'invalid'],
  ['unknown enemy property', { unrelated: 0.3 }, 'unsupported']
]) {
  const result = validateDataPack(pack(enemy))
  rows.push({ name, actual: result.status, expected })
  assert.equal(result.status, expected, `${name}: ${JSON.stringify(result.issues)}`)
}
console.log(JSON.stringify({ passed: rows.length, total: rows.length, rows }))
