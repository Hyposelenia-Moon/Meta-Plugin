/**
 * 产球概率（2026-11-06）：图鉴 energy[] 里写着 67%/44% 这类概率，
 * 内核按期望值折算（count × chance × 充能效率）。
 *
 * 这里只测折算与校验，不测具体角色：角色数值写在 data/team-sim/curated/*.json，
 * 由 `test/team-sim-roster-packs.test.mjs` 的数据门禁兜底。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))

function run (particles, energyRecharge = {}) {
  return simulateTimeline({
    scheduler: 'fixed',
    frameTier: FRAME_TIERS['fps-60'],
    actions: {
      'itto.skill': {
        id: 'itto.skill',
        actorId: 'itto',
        kind: 'skill',
        timing: { type: 'frames', frames: 30 },
        hits: [],
        particles
      }
    },
    actors: [
      { actorId: 'itto', energy: 0, energyMax: 80 },
      { actorId: 'gorou', energy: 0, energyMax: 80 }
    ],
    activeActorId: 'itto',
    measurementEndFrame: 120,
    energyRecharge,
    steps: [{ id: 's1', kind: 'action', actorId: 'itto', actionId: 'itto.skill', atFrame: 0 }]
  })
}

// 期望值：2 颗 × 50% = 1 点（全队共享产球，每人各拿 1 点）。
const half = run([{ atFrame: 6, count: 2, chance: 0.5, element: 'geo', travelFrames: 0 }], { itto: 2, gorou: 1 })
assert.equal(half.status, 'simulated', JSON.stringify(half.issues))
const halfEvent = half.events.find((event) => event.kind === 'particle' && event.phase === 'energy')
assert.ok(halfEvent, '应记录粒子到账事件')
assert.equal(halfEvent.detail.chance, 0.5)
assert.equal(halfEvent.detail.gain.itto, 2)
assert.equal(halfEvent.detail.gain.gorou, 1)

// 缺省 chance = 1：2 颗就是 2 点。
const full = run([{ atFrame: 6, count: 2, element: 'geo', travelFrames: 0 }], { itto: 1, gorou: 1 })
const fullEvent = full.events.find((event) => event.kind === 'particle' && event.phase === 'energy')
assert.equal(fullEvent.detail.gain.itto, 2)

// 校验：0 与大于 1 都要拦下。
const zero = run([{ atFrame: 6, count: 2, chance: 0, element: 'geo', travelFrames: 0 }])
assert.equal(zero.status, 'invalid')
assert.ok(zero.issues.some((issue) => issue.path.endsWith('.chance')))

const over = run([{ atFrame: 6, count: 2, chance: 1.5, element: 'geo', travelFrames: 0 }])
assert.equal(over.status, 'invalid')

console.log('产球概率：期望折算与 (0,1] 校验通过')
