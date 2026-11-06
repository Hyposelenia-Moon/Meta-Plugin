import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const { simulateTimeline, planMechanisms, calculateTimelineDamage, FRAME_TIERS } = await import(pathToFileURL(path.join(root, 'lib/modules/teamSimulation/index.js')))
const tier = FRAME_TIERS['fps-60']
const stats = { hp: 20000, atk: 1000, def: 800, mastery: 0, cpct: 0, cdmg: 0, recharge: 1, dmg: 0, phy: 0, heal: 0, pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0, dendro: 0 }
const contexts = { test: { level: 90, targetPresetId: 'dummy-lv100', crit: 'non-critical', gameVersion: '7.1', source: 'audit-synthetic', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }, stats } }
const pack = { schemaVersion: 1, gameVersion: '7.1', source: 'audit-synthetic', actions: {
  'fixture.skill': { id: 'fixture.skill', actorId: 'test', kind: 'skill', mechanism: 'zhongli-hold-e', timing: { type: 'frames', frames: 60 }, cooldownFrames: 720, hits: [{ atFrame: 50, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: false }] },
  'fixture.normal-1': { id: 'fixture.normal-1', actorId: 'test', kind: 'normal', timing: { type: 'frames', frames: 30 }, hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: false }] }
} }
function run(recast, extraResistance = false) {
  const rotation = { id: 'shield-refresh', scheduler: 'fixed', frameTier: tier, measurementEndFrame: 900, activeActorId: 'test',
    actors: [{ actorId: 'test', energy: 0, energyMax: 60 }], steps: [
      ...(recast ? [{ id: 'old', kind: 'action', actorId: 'test', actionId: 'fixture.skill', atFrame: 0 }] : []),
      { id: 'fresh', kind: 'action', actorId: 'test', actionId: 'fixture.skill', atFrame: 720 },
      { id: 'hit', kind: 'action', actorId: 'test', actionId: 'fixture.normal-1', atFrame: 780 }
    ] }
  const { plan, issues } = planMechanisms({ pack, rotation, contexts, builds: {}, tier })
  const timeline = simulateTimeline({ ...rotation, actions: pack.actions,
    ...(extraResistance ? { effects: { 'separate-resistance': { id: 'separate-resistance', target: 'enemy', trigger: 'always', enemy: { resistanceReduction: 0.1 } } }, effectTriggers: [{ effectId: 'separate-resistance', actorId: 'test', on: 'always' }] } : {})
  })
  const damage = calculateTimelineDamage({ timeline, contexts, plan })
  return { issues, timelineStatus: timeline.status, timelineIssues: timeline.issues, damageStatus: damage.status, damageIssues: damage.issues,
    windows: plan.enemyWindows, rows: damage.rows?.filter(r => r.actionId === 'fixture.normal-1') }
}
const results = { sha: '60907e0efb4a91091aee879009d3c68499106d57', root, oneShield: run(false), refreshedShield: run(true), oneShieldSeparateSource: run(false, true), refreshedShieldSeparateSource: run(true, true) }
const json = JSON.stringify(results, null, 2)

console.log('Audit regression passed')

const value = run => run.rows[0].damage
if (results.refreshedShield.damageStatus !== 'calculated' || value(results.oneShield)!==value(results.refreshedShield) || value(results.oneShieldSeparateSource)!==value(results.refreshedShieldSeparateSource) || value(results.oneShieldSeparateSource)<=value(results.oneShield)) throw new Error('shield refresh regression')
