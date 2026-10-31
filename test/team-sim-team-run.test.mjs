import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS } = await import(mod('modules/teamSimulation/timeline.js'))
const { requiredEffectSources, buildPermanentStats } = await import(mod('modules/teamSimulation/build.js'))
const { calculateOrdinaryHit, TARGET_PRESETS } = await import(mod('modules/teamSimulation/formula.js'))
const { simulateTeam } = await import(mod('modules/teamSimulation/teamRun.js'))

const slots = ['flower', 'plume', 'sands', 'goblet', 'circlet']
const mains = [{ key: 'hp', value: 4780 }, { key: 'atk', value: 311 }, { key: 'defPct', value: 0.2 }, { key: 'geo', value: 0.466 }, { key: 'cdmg', value: 0.62 }]
const subs = [[{ key: 'hpPct', value: 0.05 }], [{ key: 'atkPct', value: 0.1 }], [{ key: 'mastery', value: 20 }], [{ key: 'cpct', value: 0.07 }], [{ key: 'recharge', value: 0.1 }]]

function makeBuild(index) {
  const build = {
    schemaVersion: 1, actorId: `actor:${index}`, characterId: `char:fixture-${index}`, name: `Synthetic ${index}`, element: 'geo',
    level: 90, ascension: 6, constellation: 1,
    talents: { normal: 9, skill: 9, burst: 9 },
    weapon: { id: `weapon:fixture-${index}`, name: 'Synthetic Weapon', level: 90, ascension: 6, refinement: 1 },
    artifacts: slots.map((slot, i) => ({ slot, name: `Artifact ${slot}`, setId: 'fixture-set', rarity: 5, level: 20, main: mains[i], sub: subs[i] })),
    requiredEffects: [], provenance: { provider: 'synthetic-fixture', providerVersion: null, sourceTime: null }
  }
  build.requiredEffects = requiredEffectSources(build)
  return build
}

function makeData(build, index) {
  const charSource = `character:${build.characterId}:a${build.ascension}`
  return {
    gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data',
    character: { id: build.characterId, level: 90, ascension: 6, base: { hp: 10000 + index * 100, atk: 300 + index * 10, def: 700 + index * 10 }, bonuses: [] },
    weapon: { id: build.weapon.id, level: 90, ascension: 6, baseAtk: 500 + index * 10, bonuses: [] },
    effects: Object.fromEntries(build.requiredEffects.map(e => [e.id,
      e.id === charSource ? { status: 'verified-static', modifiers: [{ key: 'atkPct', value: 0.1 }], runtimeRequired: false }
        : { status: 'known-no-static', modifiers: [], runtimeRequired: false }]))
  }
}

const expected = { gameVersion: '6.0-synthetic', bundleId: 'fixture-bundle-1', source: 'fixture-maintained-data' }
const members = [makeBuild(0), makeBuild(1)].map((build, index) => ({ build, permanentData: makeData(build, index) }))
const panels = members.map(({ build, permanentData }) => {
  const panel = buildPermanentStats(build, permanentData, expected)
  assert.equal(panel.status, 'permanent-ready', JSON.stringify(panel))
  return panel
})

const pack = {
  schemaVersion: 1, gameVersion: '6.0-synthetic', source: 'synthetic-pack',
  actions: {
    'itto.normal-1': {
      id: 'itto.normal-1', actorId: 'actor:0', kind: 'normal', timing: { type: 'frames', frames: 36 },
      hits: [
        { atFrame: 6, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true },
        { atFrame: 18, motionValue: 1.2, scaling: 'atk', element: 'physical', canCrit: true }
      ]
    },
    'albedo.skill': {
      id: 'albedo.skill', actorId: 'actor:1', kind: 'skill', timing: { type: 'frames', frames: 30 }, cooldownFrames: 600, cooldownId: 'skill',
      hits: [{ atFrame: 10, motionValue: 2, scaling: 'def', element: 'geo', canCrit: true }]
    }
  }
}

const rotation = {
  id: 'rotation:synthetic', scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'], measurementEndFrame: 120,
  steps: [
    { id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'itto.normal-1', atFrame: 0 },
    { id: 's2', kind: 'switch', actorId: 'actor:1', atFrame: 36 },
    { id: 's3', kind: 'action', actorId: 'actor:1', actionId: 'albedo.skill', atFrame: 36 }
  ],
  actors: [{ actorId: 'actor:0', energy: 0, energyMax: 60 }, { actorId: 'actor:1', energy: 0, energyMax: 40 }],
  activeActorId: 'actor:0'
}

const crit = 'expected'
const debuffs = { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
const run = simulateTeam({ pack, rotation, members, expected, targetPresetId: 'dummy-lv100', crit, debuffs })
assert.equal(run.status, 'calculated', JSON.stringify(run.issues))
assert.equal(run.scope, 'team-run-no-reaction')
assert.equal(run.simulationReady, false)
assert.deepEqual(run.checks.map(c => c.stage), ['data-pack', 'versions', 'rotation', 'members', 'timeline', 'damage'])
assert.ok(run.checks.every(c => c.status === 'ok' && c.issues.length === 0))
assert.deepEqual(run.versions, { pack: '6.0-synthetic', panels: '6.0-synthetic' })
assert.equal(run.timeline.status, 'simulated')
assert.equal(run.damage.status, 'calculated')

// 端到端的结果必须与逐段直接调用公式完全一致：编排只做串联，不改任何数值。
const preset = TARGET_PRESETS['dummy-lv100']
const byActor = Object.fromEntries(members.map((m, i) => [m.build.actorId, panels[i].stats]))
const direct = run.timeline.hits.map(hit => {
  const stats = byActor[hit.actorId]
  const stat = hit.scaling === 'atk' ? stats.atk : hit.scaling === 'hp' ? stats.hp : stats.def
  const result = calculateOrdinaryHit({
    kind: 'ordinary', reaction: 'none', gameVersion: '6.0-synthetic', source: 'fixture-bundle-1', targetId: preset.id,
    scaling: [{ stat, multiplier: hit.motionValue }], additiveBase: 0,
    damageBonus: hit.element === 'physical' ? stats.phy : stats.dmg + stats[hit.element],
    canCrit: hit.canCrit, crit, critRate: stats.cpct, critDamage: stats.cdmg,
    attackerLevel: 90, enemyLevel: preset.level, defenseReduction: 0, defenseIgnore: 0,
    resistance: preset.resistance, resistanceReduction: 0
  })
  assert.equal(result.status, 'calculated', JSON.stringify(result.issues))
  return result.damage
})
assert.deepEqual(run.damage.rows.map(r => r.damage), direct)
assert.deepEqual(run.damage.rows.map(r => r.actorId), run.timeline.hits.map(h => h.actorId))
assert.ok(Math.abs(run.damage.total - direct.reduce((a, b) => a + b, 0)) < 1e-9)
assert.deepEqual(Object.keys(run.damage.perActor).sort(), ['actor:0', 'actor:1'])

// 数据包坏了就在 data-pack 关拒绝，不再往下跑（版本不符按 invalid 收口，issues 里保留 version-mismatch）。
const badPack = simulateTeam({ pack: { ...pack, schemaVersion: 2 }, rotation, members, expected, targetPresetId: 'dummy-lv100', crit, debuffs })
assert.equal(badPack.status, 'invalid')
assert.equal(badPack.checks[0].status, 'version-mismatch')
assert.deepEqual(badPack.checks.map(c => c.stage), ['data-pack'])

// 数据包与面板版本不一致：在 versions 关拒绝，不能拿两份不同版本的数据混着跑。
const badVersion = simulateTeam({ pack: { ...pack, gameVersion: '7.1' }, rotation, members, expected, targetPresetId: 'dummy-lv100', crit, debuffs })
assert.equal(badVersion.status, 'invalid')
assert.deepEqual(badVersion.checks.map(c => c.stage), ['data-pack', 'versions'])
assert.equal(badVersion.checks[1].issues[0].path, 'pack.gameVersion')

// 面板版本没给：缺输入是 incomplete，关状态也要跟着，而不是一律 invalid。
const noVersion = simulateTeam({ pack, rotation, members, expected: { ...expected, gameVersion: undefined }, targetPresetId: 'dummy-lv100', crit, debuffs })
assert.equal(noVersion.status, 'incomplete')
assert.equal(noVersion.checks[1].stage, 'versions')
assert.equal(noVersion.checks[1].status, 'incomplete')

// 轴引用了包里没有的动作，在 rotation 关拒绝。
const badRotation = simulateTeam({ pack, rotation: { ...rotation, steps: [{ id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'itto.burst', atFrame: 0 }] }, members, expected, targetPresetId: 'dummy-lv100', crit, debuffs })
assert.equal(badRotation.status, 'unsupported')
assert.ok(badRotation.checks.find(c => c.stage === 'rotation').issues.some(i => i.path === 'rotation.steps.0.actionId'))
assert.ok(!badRotation.timeline)

// 成员面板算不出来（三元组不符）在 members 关拒绝，且点名是哪个成员。
const wrongExpected = simulateTeam({ pack, rotation, members, expected: { ...expected, bundleId: 'other-bundle' }, targetPresetId: 'dummy-lv100', crit, debuffs })
assert.equal(wrongExpected.status, 'unsupported')
assert.ok(wrongExpected.checks.find(c => c.stage === 'members').issues.some(i => i.path.startsWith('members.0.permanentData')))
assert.ok(!wrongExpected.timeline)

// 轴上出手的角色没有配装：拒绝，而不是按 0 伤害算。
const onlyOne = simulateTeam({ pack, rotation, members: [members[0]], expected, targetPresetId: 'dummy-lv100', crit, debuffs })
assert.equal(onlyOne.status, 'unsupported')
assert.ok(onlyOne.checks.find(c => c.stage === 'members').issues.some(i => i.message.includes('actor:1')))

// 空的成员表是 incomplete，不是 invalid：缺的是输入，不是输入写错了。
const noMembers = simulateTeam({ pack, rotation, members: [], expected, targetPresetId: 'dummy-lv100', crit, debuffs })
assert.equal(noMembers.status, 'incomplete')

// 目标口径与减益沿用同一套拒绝规则。
const badTarget = simulateTeam({ pack, rotation, members, expected, targetPresetId: 'dummy-lv200', crit, debuffs })
assert.equal(badTarget.status, 'unsupported')
assert.ok(badTarget.checks.find(c => c.stage === 'damage').issues.some(i => i.path.includes('targetPresetId')))

// 效果表端到端：同一份包挂一个队伍攻击加成，触发之后的每一段伤害都必须变大。
const effectPack = {
  ...pack,
  effects: { 'party-atk': { id: 'party-atk', target: 'team', stats: { atk: 300 }, durationFrames: 200 } },
  actions: {
    ...pack.actions,
    'itto.normal-1': {
      ...pack.actions['itto.normal-1'],
      hits: [{ ...pack.actions['itto.normal-1'].hits[0], triggerIds: ['party-atk'] }, pack.actions['itto.normal-1'].hits[1]]
    }
  }
}
const buffed = simulateTeam({ pack: effectPack, rotation, members, expected, targetPresetId: 'dummy-lv100', crit, debuffs })
assert.equal(buffed.status, 'calculated', JSON.stringify(buffed.issues))
assert.equal(buffed.timeline.triggers.length, 1)
assert.equal(buffed.timeline.triggers[0].effectId, 'party-atk')
assert.equal(buffed.damage.rows[0].damage, run.damage.rows[0].damage, '触发这一发不吃自己的加成')
assert.ok(buffed.damage.rows[1].damage > run.damage.rows[1].damage, '同角色后续命中必须吃到加成')
// 下一个角色是防御倍率，攻击力加成不会改变它的伤害，但修饰本身必须已经挂到它身上。
assert.equal(buffed.timeline.hits[2].modifiers.stats.atk, 300, '队伍加成对下一个出手角色同样生效')
assert.equal(buffed.damage.rows[2].damage, run.damage.rows[2].damage, '防御倍率的命中不吃攻击力加成')
assert.ok(buffed.damage.total > run.damage.total)

// 结果整理：真实一轮跑完后能直接投影成摘要，角色合计与命中段数对得上。
const { buildTeamRunReport, formatTeamRunReport } = await import(mod('modules/teamSimulation/report.js'))
const summary = buildTeamRunReport(run)
assert.equal(summary.status, 'calculated')
assert.equal(summary.hits, run.damage.rows.length)
assert.equal(summary.total, run.damage.total)
assert.deepEqual(summary.perActor.reduce((sum, actor) => sum + actor.total, 0), run.damage.total)
const lines = formatTeamRunReport(summary)
assert.equal(lines[0], '队伍模拟：calculated（不可用于正式结论）')
assert.ok(lines.some(line => line.startsWith(`命中：${run.damage.rows.length} 段`)), lines.join('\n'))

console.log('team-sim-team-run ok')
