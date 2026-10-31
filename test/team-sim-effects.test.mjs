import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { validateEffects, validateEffectSpec } = await import(mod('modules/teamSimulation/effects.js'))
const { validateDataPack } = await import(mod('modules/teamSimulation/dataPack.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))

// ── 1. 效果定义的校验：只收能兑现的写法 ─────────────────────────────
const okEffect = { id: 'team-atk', target: 'team', stats: { atk: 300 }, durationFrames: 120 }
assert.deepEqual(validateEffectSpec(okEffect, 'team-atk'), [])

const cases = [
  ['team-atk', { ...okEffect, id: 'other' }, 'effects.team-atk.id', 'invalid', 'id 必须与键一致'],
  ['team-atk', { ...okEffect, target: 'both' }, 'effects.team-atk.target', 'unsupported', '未知作用对象'],
  ['team-atk', { ...okEffect, stats: { atkPct: 0.2 } }, 'effects.team-atk.stats.atkPct', 'unsupported', '构筑期百分比不能当面板加成'],
  ['team-atk', { ...okEffect, stats: {} }, 'effects.team-atk.stats', 'invalid', '空面板加成'],
  ['team-atk', { id: 'team-atk', target: 'self' }, 'effects.team-atk.stats', 'missing', '己方效果必须给面板加成'],
  ['team-atk', { id: 'team-atk', target: 'enemy' }, 'effects.team-atk.enemy', 'missing', '敌人效果必须给减益'],
  ['team-atk', { id: 'team-atk', target: 'enemy', stats: { atk: 1 } }, 'effects.team-atk.stats', 'invalid', '敌人效果不能带面板加成'],
  ['team-atk', { id: 'team-atk', target: 'enemy', enemy: { resistanceReduction: 0.2 }, durationFrames: 0 }, 'effects.team-atk.durationFrames', 'invalid', '持续帧必须是正整数'],
  ['team-atk', { id: 'team-atk', target: 'team', stats: { atk: 1 }, stacking: 'stack' }, 'effects.team-atk.maxStacks', 'invalid', '叠层必须给上限'],
  ['team-atk', { id: 'team-atk', target: 'team', stats: { atk: 1 }, maxStacks: 2 }, 'effects.team-atk.maxStacks', 'invalid', '非叠层策略不该写上限']
]
for (const [key, effect, path, code, why] of cases) {
  const issues = validateEffectSpec(effect, key)
  assert.ok(issues.some(i => i.path === path && i.code === code), `${why}：${JSON.stringify(issues)}`)
}
assert.equal(validateEffects('x').length, 1)
assert.deepEqual(validateEffects({ 'team-atk': okEffect }), [])

// 数据包层：triggerIds 必须能找到效果定义，否则整包拒绝而不是静默忽略。
const packBase = {
  schemaVersion: 1, gameVersion: '7.1', source: 'effects-test',
  actions: {
    'itto.mark': {
      id: 'itto.mark', actorId: 'itto', kind: 'skill', timing: { type: 'frames', frames: 20 },
      hits: [{ atFrame: 5, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true, triggerIds: ['team-atk'] }]
    }
  },
  effects: { 'team-atk': okEffect }
}
assert.equal(validateDataPack(packBase).status, 'ok')
const missingEffect = validateDataPack({ ...packBase, effects: {} })
assert.equal(missingEffect.status, 'unsupported')
assert.ok(missingEffect.issues.some(i => i.path === 'actions.itto.mark.hits.0.triggerIds.0'))

// ── 2. 触发语义：先结算伤害、再结算触发 ─────────────────────────────
const baseHit = (atFrame, extra = {}) => ({ atFrame, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true, ...extra })
const actions = {
  'itto.mark': { id: 'itto.mark', actorId: 'itto', kind: 'skill', timing: { type: 'frames', frames: 20 }, hits: [baseHit(5, { triggerIds: ['team-atk'] })] },
  'itto.strike': { id: 'itto.strike', actorId: 'itto', kind: 'normal', timing: { type: 'frames', frames: 20 }, hits: [baseHit(5)] },
  'albedo.strike': { id: 'albedo.strike', actorId: 'albedo', kind: 'skill', timing: { type: 'frames', frames: 20 }, hits: [baseHit(5)] }
}
const mkActions = markHits => ({ ...actions, 'itto.mark': { ...actions['itto.mark'], hits: markHits } })
const steps = [
  { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.mark', atFrame: 0 },
  { id: 's2', kind: 'action', actorId: 'itto', actionId: 'itto.strike', atFrame: 30 },
  { id: 's3', kind: 'switch', actorId: 'albedo', atFrame: 60 },
  { id: 's4', kind: 'action', actorId: 'albedo', actionId: 'albedo.strike', atFrame: 60 }
]
const run = (actionMap, effects) => simulateTimeline({
  scheduler: 'fixed', frameTier: FRAME_TIERS['fps-60'], actions: actionMap,
  actors: [{ actorId: 'itto', energy: 0, energyMax: 60 }, { actorId: 'albedo', energy: 0, energyMax: 40 }],
  activeActorId: 'itto', measurementEndFrame: 120, steps, effects
})

const boosted = run(actions, { 'team-atk': okEffect })
assert.equal(boosted.status, 'simulated', JSON.stringify(boosted.issues))
assert.equal(boosted.hits.length, 3)
// 触发这一发自己不吃自己的加成；之后的两发都吃到，且队伍效果对另一个角色同样生效。
assert.equal(boosted.hits[0].modifiers.stats.atk ?? 0, 0)
assert.equal(boosted.hits[1].modifiers.stats.atk, 300)
assert.equal(boosted.hits[2].modifiers.stats.atk, 300)
assert.equal(boosted.triggers.length, 1)
assert.deepEqual(boosted.triggers[0], { frame: 5, actorId: 'itto', effectId: 'team-atk', stacks: 1, startsAt: 5, expiresAt: 125 })
assert.deepEqual(boosted.effects.map(e => [e.effectId, e.actorIds.sort()]), [['team-atk', ['albedo', 'itto']]])
// 触发事件落在同一帧、相位在 hit 之后。
const frame5 = boosted.events.filter(e => e.frame === 5).map(e => e.kind)
assert.deepEqual(frame5, ['hit', 'trigger'])

const contexts = {
  itto: { level: 90, stats: { hp: 20000, atk: 1000, def: 800, mastery: 0, cpct: 0.05, cdmg: 0.5, recharge: 1, dmg: 0.15, phy: 0.1, heal: 0, pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0.2, dendro: 0 },
    targetPresetId: 'dummy-lv100', crit: 'expected', gameVersion: '7.1', source: 'effects-test', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 } },
  albedo: { level: 90, stats: { hp: 20000, atk: 1000, def: 1400, mastery: 0, cpct: 0.05, cdmg: 0.5, recharge: 1, dmg: 0.15, phy: 0.1, heal: 0, pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0.2, dendro: 0 },
    targetPresetId: 'dummy-lv100', crit: 'expected', gameVersion: '7.1', source: 'effects-test', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 } }
}
const plain = run(mkActions([baseHit(5)]), {})
assert.equal(plain.status, 'simulated', JSON.stringify(plain.issues))
const boostedDamage = calculateTimelineDamage({ timeline: boosted, contexts })
const plainDamage = calculateTimelineDamage({ timeline: plain, contexts })
assert.equal(boostedDamage.status, 'calculated', JSON.stringify(boostedDamage.issues))
assert.equal(plainDamage.status, 'calculated', JSON.stringify(plainDamage.issues))
assert.equal(boostedDamage.rows[0].damage, plainDamage.rows[0].damage)
assert.ok(boostedDamage.rows[1].damage > plainDamage.rows[1].damage)
assert.ok(boostedDamage.rows[2].damage > plainDamage.rows[2].damage)

// ── 3. 敌人减益与到期 ─────────────────────────────────────────────
const enemyEffect = { id: 'shield-res', target: 'enemy', enemy: { resistanceReduction: 0.2 }, durationFrames: 20 }
const enemyBoosted = run(mkActions([baseHit(5, { triggerIds: ['shield-res'] })]), { 'shield-res': enemyEffect })
assert.equal(enemyBoosted.status, 'simulated', JSON.stringify(enemyBoosted.issues))
assert.equal(enemyBoosted.hits[1].modifiers.enemy.resistanceReduction, 0)   // 5+20 之后已到期
assert.equal(enemyBoosted.hits[0].modifiers.enemy.resistanceReduction, 0)   // 自己这一发不吃
const enemyActive = run(mkActions([baseHit(5, { triggerIds: ['shield-res'] })]), { 'shield-res': { ...enemyEffect, durationFrames: 200 } })
assert.equal(enemyActive.hits[1].modifiers.enemy.resistanceReduction, 0.2)
const enemyDamage = calculateTimelineDamage({ timeline: enemyActive, contexts })
assert.ok(enemyDamage.rows[1].damage > plainDamage.rows[1].damage)

// ── 4. 叠层、刷新与忽略 ───────────────────────────────────────────
const twoHits = [baseHit(2, { triggerIds: ['stack-atk'] }), baseHit(6, { triggerIds: ['stack-atk'] }), baseHit(10)]
const stackEffect = { id: 'stack-atk', target: 'self', stats: { atk: 100 }, stacking: 'stack', maxStacks: 2, durationFrames: 300 }
const stacked = run(mkActions(twoHits), { 'stack-atk': stackEffect })
assert.deepEqual(stacked.triggers.map(t => t.stacks), [1, 2])
assert.equal(stacked.hits[2].modifiers.stats.atk, 200)
// 超过上限后层数不再增加。
const capped = run(mkActions([...twoHits.slice(0, 2), baseHit(10, { triggerIds: ['stack-atk'] })]), { 'stack-atk': stackEffect })
assert.deepEqual(capped.triggers.map(t => t.stacks), [1, 2, 2])

const ignored = run(mkActions(twoHits), { 'stack-atk': { ...stackEffect, stacking: 'ignore' } })
assert.equal(ignored.triggers.length, 1)
assert.equal(ignored.hits[2].modifiers.stats.atk, 100)

const refreshed = run(mkActions([baseHit(2, { triggerIds: ['stack-atk'] }), baseHit(15, { triggerIds: ['stack-atk'] })]), { 'stack-atk': { ...stackEffect, stacking: 'refresh', durationFrames: 60 } })
assert.deepEqual(refreshed.triggers.map(t => [t.stacks, t.expiresAt]), [[1, 62], [1, 75]])

// 到期后再触发要从 1 层重新开始，而不是接着上一轮的层数与起点继续累。
const expiredStack = { ...stackEffect, durationFrames: 20 }
const regrown = (() => {
  const markHits = [baseHit(2, { triggerIds: ['stack-atk'] }), baseHit(6, { triggerIds: ['stack-atk'] })]
  const pack = mkActions(markHits)
  return simulateTimeline({
    frameTier: FRAME_TIERS['fps-60'], measurementEndFrame: 400, scheduler: 'fixed',
    actions: { ...pack, 'itto.mark2': { ...pack['itto.mark'], id: 'itto.mark2', hits: [baseHit(5, { triggerIds: ['stack-atk'] }), baseHit(10)] } },
    effects: { 'stack-atk': expiredStack },
    actors: [{ actorId: 'itto', energy: 60, energyMax: 60 }], activeActorId: 'itto',
    steps: [
      { id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.mark', atFrame: 0 },
      { id: 's2', kind: 'action', actorId: 'itto', actionId: 'itto.mark2', atFrame: 40 }
    ]
  })
})()
assert.equal(regrown.status, 'simulated', JSON.stringify(regrown.issues))
assert.deepEqual(regrown.triggers.map(t => [t.frame, t.stacks, t.startsAt]), [[2, 1, 2], [6, 2, 2], [45, 1, 45]], JSON.stringify(regrown.triggers))
assert.equal(regrown.hits[3].modifiers.stats.atk, 100, JSON.stringify(regrown.hits[3].modifiers))

// 命中快照里的「在场效果」：触发的那一发不算自己，之后才算（与 modifiers 同一时刻）。
const snapshot = run(mkActions([baseHit(5, { triggerIds: ['stack-atk'] }), baseHit(9)]), { 'stack-atk': { ...stackEffect, durationFrames: 60 } })
assert.equal(snapshot.status, 'simulated', JSON.stringify(snapshot.issues))
assert.deepEqual(snapshot.hits[0].activeEffects, [])
assert.deepEqual(snapshot.hits[1].activeEffects, ['stack-atk'])

// ── 5. 未登记触发标记在内核里也要拒绝 ─────────────────────────────
const unknown = run(mkActions([baseHit(5, { triggerIds: ['nope'] })]), {})
assert.equal(unknown.status, 'invalid')
assert.ok(unknown.issues.some(i => i.code === 'unsupported' && i.path === 'actions.itto.mark.hits.0.triggerIds.0'), JSON.stringify(unknown.issues))

console.log('team-sim-effects ok')
