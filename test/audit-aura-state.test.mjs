import assert from 'node:assert/strict'
import { simulateTimeline, calculateTimelineDamage, FRAME_TIERS } from '../lib/modules/teamSimulation/index.js'

const stats = { hp: 20000, atk: 1000, def: 800, mastery: 0, cpct: 0, cdmg: 0, recharge: 1, dmg: 0, phy: 0, heal: 0, pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0, dendro: 0 }
const contexts = { fixture: { level: 90, targetPresetId: 'dummy-lv100', crit: 'non-critical', gameVersion: '7.1', source: 'audit-synthetic', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }, stats } }
function run(hits, tierId = 'fps-60', auraMode = 'simulated') {
  const end = Math.max(...hits.map(hit => hit.atFrame)) + 20
  const action = { id: 'fixture.skill', actorId: 'fixture', kind: 'skill', timing: { type: 'frames', frames: end }, hits: hits.map(hit => ({ motionValue: 1, scaling: 'atk', canCrit: false, ...hit })) }
  const timeline = simulateTimeline({ auraMode, scheduler: 'fixed', frameTier: FRAME_TIERS[tierId], measurementEndFrame: end,
    actors: [{ actorId: 'fixture', energy: 0, energyMax: 60 }], activeActorId: 'fixture', actions: { [action.id]: action },
    steps: [{ id: 'step', kind: 'action', actorId: 'fixture', actionId: action.id, atFrame: 0 }] })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const damage = calculateTimelineDamage({ timeline, contexts })
  assert.equal(damage.status, 'calculated', JSON.stringify(damage.issues))
  return { timeline, damage }
}
const cases = []
const check = (name, test) => { test(); cases.push(name) }

check('zero gauge neither reacts nor advances ICD', () => {
  const hits = [{ atFrame: 0, element: 'hydro', attachment: { icd: 'independent' } }, { atFrame: 10, element: 'pyro', attachment: { gauge: 0 } }]
  const zero = run(hits)
  assert.equal(zero.timeline.hits[1].reaction, undefined)
  assert.equal(zero.damage.total, run(hits, 'fps-60', 'declared').damage.total)
  assert.equal(run([...hits, { atFrame: 20, element: 'pyro' }]).timeline.hits[2].reaction?.kind, 'vaporize')
})
check('positive gauge still vaporizes', () => {
  assert.equal(run([{ atFrame: 0, element: 'hydro' }, { atFrame: 10, element: 'pyro', attachment: { gauge: 1 } }]).timeline.hits[1].reaction?.kind, 'vaporize')
})
check('bare anemo cannot become the aura of reverse swirl', () => {
  const out = run([{ atFrame: 0, element: 'anemo' }, { atFrame: 10, element: 'pyro' }])
  assert.ok(out.timeline.hits.every(hit => hit.reaction === undefined))
  assert.equal(out.damage.rows.filter(row => row.origin === 'reaction').length, 0)
})
check('anemo on pyro still swirls', () => {
  assert.deepEqual(run([{ atFrame: 0, element: 'pyro' }, { atFrame: 10, element: 'anemo' }]).timeline.hits[1].reaction, { kind: 'swirl', aura: 'pyro' })
})
check('anemo cannot replace a non-swirlable dendro aura', () => {
  const out = run([{ atFrame: 0, element: 'dendro' }, { atFrame: 10, element: 'anemo' }, { atFrame: 20, element: 'hydro' }])
  assert.equal(out.timeline.hits[1].reaction, undefined)
  assert.deepEqual(out.timeline.hits[2].reaction, { kind: 'bloom', aura: 'dendro' })
})
for (const tierId of ['fps-60', 'fps-217']) {
  const tick = FRAME_TIERS[tierId].timerTickMs
  check(`${tierId} Standard ICD follows game milliseconds`, () => {
    const oneSecond = Math.ceil(1000 / tick)
    const expired = Math.ceil(2500 / tick)
    const out = run([{ atFrame: 0, element: 'hydro', attachment: { gauge: 10, icd: 'independent' } },
      { atFrame: 10, element: 'pyro' }, { atFrame: 10 + oneSecond, element: 'pyro' }, { atFrame: 10 + expired, element: 'pyro' }], tierId)
    assert.deepEqual(out.timeline.hits.filter(hit => hit.reaction).map(hit => hit.frame), [10, 10 + expired])
  })
  check(`${tierId} decay follows game milliseconds`, () => {
    const aura = { atFrame: 0, element: 'hydro', attachment: { gauge: 1, icd: 'independent' } }
    assert.equal(run([aura, { atFrame: Math.floor(4000 / tick), element: 'pyro', attachment: { icd: 'independent' } }], tierId).timeline.hits[1].reaction?.kind, 'vaporize')
    assert.equal(run([aura, { atFrame: Math.ceil(10000 / tick), element: 'pyro', attachment: { icd: 'independent' } }], tierId).timeline.hits[1].reaction, undefined)
  })
}
check('declared mode retains its explicit reaction policy', () => {
  const out = run([{ atFrame: 0, element: 'hydro' }, { atFrame: 10, element: 'pyro', attachment: { gauge: 0 }, reaction: { kind: 'vaporize', aura: 'hydro' } }], 'fps-60', 'declared')
  assert.equal(out.timeline.hits[1].reaction?.kind, 'vaporize')
})
console.log(JSON.stringify({ passed: cases.length, total: cases.length, cases }))
