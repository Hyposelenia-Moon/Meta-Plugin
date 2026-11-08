/**
 * 反应族加成的剩余套装（2026-11-08）。
 *
 * 魔女 400114（超载/燃烧 +40%）、乐园 400231（绽放 +40%）、
 * 影中沉凝 400411（超导 +80%）：只把引擎已有反应通道能吃下的部分计入，
 * 其余条件（蒸发/融化系数、草原核、星超导、暴击率）写进 unmodeled。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))
const { buildRuntimePermanent } = await import(mod('model/PermanentSource.js'))

// 1) 数据层：三套都在运行时效果里，数值与披露文案正确。
const runtime = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: 13407, refinement: 1 })
assert.equal(runtime.ok, true, runtime.error)
const effects = runtime.data.runtimeEffects
assert.ok(effects, '运行时应产出 runtimeEffects')

const witch = effects['artifact-set:400114:4pc']
assert.ok(witch, '魔女 400114 应登记为运行时效果')
assert.equal(witch.trigger, 'always')
assert.deepEqual(witch.reactionDmg, { overloaded: 0.4, burning: 0.4 })

const paradise = effects['artifact-set:400231:4pc']
assert.ok(paradise, '乐园 400231 应登记为运行时效果')
assert.deepEqual(paradise.reactionDmg, { bloom: 0.4 })

const dusk = effects['artifact-set:400411:4pc']
assert.ok(dusk, '影中沉凝 400411 应登记为运行时效果')
assert.deepEqual(dusk.reactionDmg, { superconduct: 0.8 })
const duskAudit = runtime.data.effects['artifact-set:400411:4pc']
assert.equal(duskAudit.status, 'verified-static')
assert.equal(duskAudit.runtimeRequired, true)
assert.match(duskAudit.unmodeled ?? '', /星超导.*暴击率/, '星超导与暴击率要写进披露')
const witchAudit = runtime.data.effects['artifact-set:400114:4pc']
assert.match(witchAudit.unmodeled ?? '', /蒸发\/融化|草原核/, '蒸发/融化与烈绽放要写进披露')
const paradiseAudit = runtime.data.effects['artifact-set:400231:4pc']
assert.match(paradiseAudit.unmodeled ?? '', /超绽放|草原核/, '超绽放要写进披露')

// 2) 结算层：超导反应行按 1.8 倍放大，直伤不变。
const stats = {
  hp: 20000, atk: 1000, def: 800,
  mastery: 0, cpct: 0, cdmg: 0, recharge: 1, dmg: 0, phy: 0, heal: 0,
  pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0, dendro: 0
}
const actions = {
  'test.electro': {
    id: 'test.electro', actorId: 'test', kind: 'skill', timing: { type: 'frames', frames: 40 },
    hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'electro', canCrit: false, reaction: { kind: 'superconduct', aura: 'cryo' } }]
  }
}

function run (withEffect) {
  const effectId = 'artifact-set:400411:4pc'
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    ...(withEffect
      ? {
          effects: {
            [effectId]: {
              id: effectId,
              target: 'self',
              trigger: 'always',
              stacking: 'refresh',
              reactionDmg: { superconduct: 0.8 }
            }
          },
          effectTriggers: [{ effectId, actorId: 'test', on: 'always' }]
        }
      : {}),
    actors: [{ actorId: 'test', energy: 0, energyMax: 60 }],
    activeActorId: 'test',
    measurementEndFrame: 40,
    steps: [{ id: 's1', kind: 'action', actorId: 'test', actionId: 'test.electro', atFrame: 0 }]
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const out = calculateTimelineDamage({
    timeline,
    contexts: {
      test: {
        level: 90, targetPresetId: 'dummy-lv100', crit: 'non-critical', gameVersion: '7.1',
        source: 'reaction-sets-test', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
        stats
      }
    }
  })
  assert.equal(out.status, 'calculated', JSON.stringify(out.issues))
  return out.rows
}

const plain = run(false)
const boosted = run(true)
const reactionRow = rows => rows.find(row => row.origin === 'reaction')
assert.ok(reactionRow(plain) && reactionRow(boosted), '两轮都要产生超导反应行')
const ratio = reactionRow(boosted).damage / reactionRow(plain).damage
assert.ok(Math.abs(ratio - 1.8) < 1e-9, `超导伤害应 ×1.8：${ratio}`)

const direct = rows => rows.filter(row => row.origin !== 'reaction').reduce((sum, row) => sum + row.damage, 0)
assert.ok(Math.abs(direct(boosted) - direct(plain)) < 1e-9, '直伤不吃反应族加成')

console.log('反应族剩余套装：魔女/乐园/影中沉凝的数据与超导 1.8 倍结算')
