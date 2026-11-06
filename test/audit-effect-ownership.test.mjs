import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const outFile = null
const { simulateTeam, requiredEffectSources, FRAME_TIERS } = await import(pathToFileURL(path.join(root, 'lib/modules/teamSimulation/index.js')))
const effectId = 'artifact-set:400164:4pc'
// Exact runtime spec declared by PermanentSource.ts for Heart of Depth.
const effect = { id: effectId, target: 'self', stats: { normalDmg: 0.3, chargedDmg: 0.3 }, durationFrames: 900, trigger: 'cast-skill' }
const slots = ['flower', 'plume', 'sands', 'goblet', 'circlet']
const mains = [{ key: 'hp', value: 4780 }, { key: 'atk', value: 311 }, { key: 'defPct', value: 0.2 }, { key: 'geo', value: 0.466 }, { key: 'cdmg', value: 0.62 }]
const subs = [[{ key: 'hpPct', value: 0.05 }], [{ key: 'atkPct', value: 0.1 }], [{ key: 'mastery', value: 20 }], [{ key: 'cpct', value: 0.07 }], [{ key: 'recharge', value: 0.1 }]]
const expected = { gameVersion: '7.1', bundleId: 'audit-synthetic', source: 'audit-synthetic' }

function member(index, setIds, includeRuntime = true) {
  const build = {
    schemaVersion: 1, actorId: `actor:${index}`, characterId: `fixture-${index}`, name: `Synthetic ${index}`, element: 'geo',
    level: 90, ascension: 6, constellation: 0, talents: { normal: 9, skill: 9, burst: 9 },
    weapon: { id: `weapon-${index}`, name: 'Synthetic Weapon', level: 90, ascension: 6, refinement: 1 },
    artifacts: slots.map((slot, i) => ({ slot, name: slot, setId: setIds[i], rarity: 5, level: 20, main: mains[i], sub: subs[i] })),
    requiredEffects: [], provenance: { provider: 'audit-synthetic', providerVersion: null, sourceTime: null }
  }
  build.requiredEffects = requiredEffectSources(build)
  return { build, permanentData: {
    ...expected,
    character: { id: build.characterId, level: 90, ascension: 6, base: { hp: 10000, atk: 300, def: 700 }, bonuses: [] },
    weapon: { id: build.weapon.id, level: 90, ascension: 6, baseAtk: 500, bonuses: [] },
    effects: Object.fromEntries(build.requiredEffects.map(e => [e.id, { status: 'known-no-static', modifiers: [], runtimeRequired: e.id === effectId }])),
    ...(includeRuntime ? { runtimeEffects: { [effectId]: effect } } : {})
  } }
}

function run(setLists, includeRuntime = true) {
  const members = setLists.map((sets, i) => member(i, sets, includeRuntime))
  const actions = {}
  const steps = []
  members.forEach(({ build }, i) => {
    const skillId = `fixture${i}.skill`
    const normalId = `fixture${i}.normal-1`
    actions[skillId] = { id: skillId, actorId: build.actorId, kind: 'skill', timing: { type: 'frames', frames: 20 }, hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: false }] }
    actions[normalId] = { id: normalId, actorId: build.actorId, kind: 'normal', timing: { type: 'frames', frames: 20 }, hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: false }] }
    if (i) steps.push({ id: `switch-${i}`, kind: 'switch', actorId: build.actorId, atFrame: i * 50 })
    steps.push({ id: `skill-${i}`, kind: 'action', actorId: build.actorId, actionId: skillId, atFrame: i * 50 })
    steps.push({ id: `normal-${i}`, kind: 'action', actorId: build.actorId, actionId: normalId, atFrame: i * 50 + 20 })
  })
  const result = simulateTeam({
    pack: { schemaVersion: 1, gameVersion: expected.gameVersion, source: 'audit-synthetic', actions },
    rotation: { id: 'audit-synthetic', scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'], measurementEndFrame: setLists.length * 50,
      steps, actors: members.map(m => ({ actorId: m.build.actorId, energy: 0, energyMax: 60 })), activeActorId: 'actor:0', switchFrames: 0 },
    members, expected, targetPresetId: 'dummy-lv100', crit: 'non-critical',
    debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }, mode: 'diagnostic'
  })
  return { status: result.status, issues: result.issues, triggers: result.timeline?.triggers,
    hits: result.timeline?.hits.map(h => ({ actorId: h.actorId, actionId: h.actionId, stats: h.modifiers.stats })),
    rows: result.damage?.rows.map(r => ({ actorId: r.actorId, actionId: r.actionId, damage: r.damage })) }
}

const twoPiece = ['400164', '400164', 'other', 'other', 'spare']
const fourPiece = ['400164', '400164', '400164', '400164', 'spare']
const other = ['other', 'other', 'other', 'other', 'spare']
const results = {
  sha: '60907e0efb4a91091aee879009d3c68499106d57', root,
  twoPiece: run([twoPiece]), twoPieceControl: run([twoPiece], false),
  fourPiece: run([fourPiece]), teammateOnly: run([fourPiece, other]), teammateOnlyControl: run([fourPiece, other], false)
}
const json = JSON.stringify(results, null, 2)
if (outFile) fs.writeFileSync(outFile, json + '\n')
console.log('Audit regression passed')

const normal = (run, actor='actor:0') => run.rows.find(row => row.actorId===actor && row.actionId.endsWith('.normal-1')).damage
if (results.twoPiece.status !== 'calculated' || normal(results.twoPiece)!==normal(results.twoPieceControl) || normal(results.teammateOnly,'actor:1')!==normal(results.teammateOnlyControl,'actor:1') || normal(results.fourPiece)<=normal(results.twoPieceControl)) throw new Error('4pc ownership regression')
