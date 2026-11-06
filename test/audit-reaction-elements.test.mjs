import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'


const candidateRoot = path.resolve(import.meta.dirname, '..')

const stats = { hp: 20000, atk: 1000, def: 800, mastery: 0, cpct: 0, cdmg: 0, recharge: 1, dmg: 0, phy: 0, heal: 0, pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0, dendro: 0 }
const close = (a, b) => Math.abs(a - b) < 1e-9

async function evaluate(root) {
  const { simulateTimeline, calculateTimelineDamage, FRAME_TIERS } = await import(pathToFileURL(path.join(root, 'lib/modules/teamSimulation/index.js')))
  function run(kind, element, aura, reducePyro) {
    const action = { id: 'fixture.skill', actorId: 'test', kind: 'skill', timing: { type: 'frames', frames: 30 },
      hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element, canCrit: false, reaction: { kind, aura } }] }
    const effectId = 'fixture-pyro-shred'
    const timeline = simulateTimeline({ scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'], actions: { [action.id]: action },
      ...(reducePyro ? { effects: { [effectId]: { id: effectId, target: 'enemy', trigger: 'always', enemy: { resistanceByElement: { pyro: 0.3 } } } }, effectTriggers: [{ effectId, actorId: 'test', on: 'always' }] } : {}),
      actors: [{ actorId: 'test', energy: 0, energyMax: 60 }], activeActorId: 'test', measurementEndFrame: 30,
      steps: [{ id: 's1', kind: 'action', actorId: 'test', actionId: action.id, atFrame: 0 }] })
    const damage = calculateTimelineDamage({ timeline, contexts: { test: { level: 90, targetPresetId: 'dummy-lv100', crit: 'non-critical', gameVersion: '7.1', source: 'audit-synthetic', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }, stats } } })
    if (timeline.status !== 'simulated' || damage.status !== 'calculated') throw new Error(JSON.stringify({ timeline, damage }))
    return { direct: damage.rows.find(r => r.origin === 'action'), reaction: damage.rows.find(r => r.origin === 'reaction') }
  }
  const rows = {
    electroOverloadPlain: run('overloaded', 'electro', 'pyro', false), electroOverloadShred: run('overloaded', 'electro', 'pyro', true),
    pyroOverloadPlain: run('overloaded', 'pyro', 'electro', false), pyroOverloadShred: run('overloaded', 'pyro', 'electro', true),
    pyroSwirlPlain: run('swirl', 'anemo', 'pyro', false), pyroSwirlShred: run('swirl', 'anemo', 'pyro', true),
    hydroSwirlPlain: run('swirl', 'anemo', 'hydro', false), hydroSwirlShred: run('swirl', 'anemo', 'hydro', true)
  }
  const checks = [
    ['electro-trigger overload is pyro', rows.electroOverloadShred.reaction.element === 'pyro'],
    ['both overload directions equal under pyro shred', close(rows.electroOverloadShred.reaction.damage, rows.pyroOverloadShred.reaction.damage)],
    ['overload gains pyro shred', rows.electroOverloadShred.reaction.damage > rows.electroOverloadPlain.reaction.damage],
    ['electro direct hit unchanged by pyro shred', close(rows.electroOverloadShred.direct.damage, rows.electroOverloadPlain.direct.damage)],
    ['pyro direct hit still gains pyro shred', rows.pyroOverloadShred.direct.damage > rows.pyroOverloadPlain.direct.damage],
    ['pyro swirl reaction is pyro', rows.pyroSwirlShred.reaction.element === 'pyro'],
    ['pyro swirl gains pyro shred', rows.pyroSwirlShred.reaction.damage > rows.pyroSwirlPlain.reaction.damage],
    ['swirl anemo direct hit remains unchanged', close(rows.pyroSwirlShred.direct.damage, rows.pyroSwirlPlain.direct.damage)],
    ['hydro swirl reaction is hydro', rows.hydroSwirlShred.reaction.element === 'hydro'],
    ['hydro swirl unaffected by pyro shred', close(rows.hydroSwirlShred.reaction.damage, rows.hydroSwirlPlain.reaction.damage)]
  ].map(([name, pass]) => ({ name, pass }))
  return { root, rows, checks, passed: checks.filter(c => c.pass).length, total: checks.length }
}
const candidate = await evaluate(candidateRoot)
console.log(JSON.stringify({passed:candidate.passed,total:candidate.total,checks:candidate.checks}))
if(candidate.passed!==candidate.total)process.exitCode=1
