import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mod } from './_helper.mjs'

const { validateDataPack } = await import(mod('modules/teamSimulation/dataPack.js'))
const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { calculateTimelineDamage } = await import(mod('modules/teamSimulation/hitDamage.js'))

const pack = JSON.parse(fs.readFileSync(new URL('./fixtures/team-sim/geo-four-pack.json', import.meta.url), 'utf8'))

// 真实帧表 + 天赋倍率：包必须整体通过校验。
const check = validateDataPack(pack)
assert.deepEqual(check.issues, [])
assert.equal(Object.keys(pack.actions).length, 12)

const stats = {
  hp: 20000, atk: 1000, def: 800,
  mastery: 0, cpct: 0.05, cdmg: 0.5, recharge: 1, dmg: 0.15, phy: 0.1, heal: 0,
  pyro: 0, hydro: 0, electro: 0, cryo: 0, anemo: 0, geo: 0.2, dendro: 0
}

const timeline = simulateTimeline({
  scheduler: 'fixed',
  frameTier: FRAME_TIERS['fps-60'],
  actions: pack.actions,
  effects: {},
  actors: [{ actorId: 'itto', energy: 0, energyMax: 70 }],
  activeActorId: 'itto',
  measurementEndFrame: 400,
  steps: [
    { id: 'n1', kind: 'action', actorId: 'itto', actionId: 'itto.na1', atFrame: 0 },
    { id: 'n2', kind: 'action', actorId: 'itto', actionId: 'itto.na2', atFrame: 41 },
    { id: 'n3', kind: 'action', actorId: 'itto', actionId: 'itto.na3', atFrame: 92 },
    { id: 'n4', kind: 'action', actorId: 'itto', actionId: 'itto.na4', atFrame: 149 }
  ]
})
assert.equal(timeline.status, 'simulated', JSON.stringify(timeline.issues))
// gcsim 命中帧 23/25/16/48，动作收尾 41/51/57/83，逐段累加后应落在 23/66/108/197。
assert.deepEqual(timeline.hits.map(hit => hit.frame), [23, 66, 108, 197])

const out = calculateTimelineDamage({
  timeline,
  contexts: {
    itto: {
      level: 90,
      stats,
      targetPresetId: 'dummy-lv100',
      crit: 'expected',
      gameVersion: '7.1',
      source: 'geo-four-pack',
      debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
    }
  }
})
assert.equal(out.status, 'calculated', JSON.stringify(out.issues))
assert.equal(out.rows.length, 4)
assert.ok(out.rows.every(row => row.element === 'geo'))
assert.ok(out.total > 0)

// 产球：五郎 E 两颗，18 秒冷却覆盖一个元素爆发所需的 80 点里只回一截，够验证路径即可。
const gorou = simulateTimeline({
  scheduler: 'fixed',
  frameTier: FRAME_TIERS['fps-60'],
  actions: pack.actions,
  effects: {},
  actors: [{ actorId: 'gorou', energy: 0, energyMax: 80 }],
  activeActorId: 'gorou',
  measurementEndFrame: 400,
  steps: [{ id: 'e1', kind: 'action', actorId: 'gorou', actionId: 'gorou.skill', atFrame: 0 }]
})
assert.equal(gorou.status, 'simulated', JSON.stringify(gorou.issues))
assert.equal(gorou.actors.find(actor => actor.actorId === "gorou").energy, 2)
assert.equal(gorou.hits[0].frame, 34)

console.log('geo-four-pack ok')
