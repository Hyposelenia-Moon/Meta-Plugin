/**
 * 反应声明（2026-11-05 第一轮第十一批）：数据包按命中声明反应。
 *
 * 1) 数据：香菱爆发的三段挥舞（18/33/57 帧）声明为「蒸发」，aura 写 hydro；
 * 2) 结算：同一发火伤，声明蒸发后直伤按 1.5 倍放大（0 精通、无暴击）。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))

const pack = JSON.parse(await (await import('node:fs/promises')).readFile('data/team-sim/packs/xiangling.json', 'utf8'))
const swings = pack.actions['xiangling.burst'].hits.filter(hit => hit.reaction)
assert.deepEqual(swings.map(hit => hit.atFrame), [18, 33, 57], '只有三段挥舞声明反应')
assert.ok(swings.every(hit => hit.reaction.kind === 'vaporize' && hit.reaction.aura === 'hydro'))
assert.equal(pack.actions['xiangling.burst'].hits.length, 12, '旋火轮各跳不声明反应')

const stats = {
  hp: 20000, atk: 1000, def: 800,
  mastery: 0, cpct: 0, cdmg: 0, recharge: 1, dmg: 0, phy: 0, heal: 0,
  pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0, dendro: 0
}

function damageOf (reaction) {
  const actions = {
    'test.pyro': {
      id: 'test.pyro', actorId: 'test', kind: 'skill', timing: { type: 'frames', frames: 40 },
      hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'pyro', canCrit: false, ...(reaction ? { reaction } : {}) }]
    }
  }
  const timeline = simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions,
    actors: [{ actorId: 'test', energy: 0, energyMax: 60 }],
    activeActorId: 'test',
    measurementEndFrame: 40,
    steps: [{ id: 's1', kind: 'action', actorId: 'test', actionId: 'test.pyro', atFrame: 0 }]
  })
  assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
  const out = calculateTimelineDamage({
    timeline,
    contexts: {
      test: {
        level: 90, targetPresetId: 'dummy-lv100', crit: 'non-critical', gameVersion: '7.1',
        source: 'reaction-declaration-test', debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 },
        stats
      }
    }
  })
  assert.equal(out.status, 'calculated', JSON.stringify(out.issues))
  return out.rows
}

const plain = damageOf(null)
const vaporized = damageOf({ kind: 'vaporize', aura: 'hydro' })
assert.ok(Math.abs(vaporized[0].damage / plain[0].damage - 1.5) < 1e-9,
  `火打水蒸发应放大 1.5 倍：${vaporized[0].damage / plain[0].damage}`)
assert.equal(vaporized[0].reaction?.kind, 'vaporize')

console.log('反应声明：数据包声明蒸发后直伤按 1.5 倍结算')
