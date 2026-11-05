/**
 * 黄金剧团 4 件套「处于队伍后台时再 +25%」（2026-11-05）。
 *
 * 这条效果与之前的触发式 4 件套不同：它不是「触发一次就生效一段时间」，而是「常驻、但只在后台计入」。
 * 断言四件事：
 *   1. 新增的 `trigger: 'always'` 可以不写持续时间，且不允许带触发冷却/计时/回能一类字段；
 *   2. 效果运行时按 `offField` 过滤 `offFieldOnly` 的效果；
 *   3. 可莉（法器）的永久数据里，审计条目保留常驻的 +25%，后台 +25% 单独进 runtimeEffects；
 *   4. 时间轴会把 `always` 效果在开局注册，快照里能读到。
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { libDir } from './_helper.mjs'

const mod = (rel) => pathToFileURL(path.join(libDir, rel)).href
const { createEffectRuntime, validateEffectSpec } = await import(mod('modules/teamSimulation/effects.js'))
const { simulateTimeline, FRAME_TIERS } = await import(mod('modules/teamSimulation/timeline.js'))
const { buildRuntimePermanent } = await import(mod('model/PermanentSource.js'))

// ---------- 1. 校验：常驻效果不写持续时间，也不允许带触发节奏 ----------
{
  const always = { id: 'test:always', target: 'self', stats: { skillDmg: 0.25 }, trigger: 'always', offFieldOnly: true }
  assert.deepEqual(validateEffectSpec(always, 'test:always'), [], '常驻效果不需要持续时间')

  const withIcd = validateEffectSpec({ ...always, icdFrames: 18 }, 'test:always')
  assert.ok(withIcd.some(issue => issue.path === 'effects.test:always.icdFrames'), '常驻效果不能带触发冷却')

  const triggeredNoDuration = validateEffectSpec({ id: 'test:cast', target: 'self', stats: { atk: 1 }, trigger: 'cast-skill' }, 'test:cast')
  assert.ok(triggeredNoDuration.some(issue => issue.path === 'effects.test:cast.durationFrames'), '其它触发仍必须给持续时间')
}

// ---------- 2. 运行时：只在 offField 时计入 ----------
{
  const runtime = createEffectRuntime({
    'test:always': { id: 'test:always', target: 'self', stats: { skillDmg: 0.25 }, trigger: 'always', offFieldOnly: true }
  }, ['a', 'b'], 600)
  assert.ok(runtime.trigger('test:always', 0, 'a'), '开局注册')
  assert.equal(runtime.modifiersAt('a', 100, { offField: true }).stats.skillDmg, 0.25, '后台时计入')
  assert.equal(runtime.modifiersAt('a', 100, { offField: false }).stats.skillDmg, undefined, '前台时不计入')
  assert.equal(runtime.modifiersAt('a', 100).stats.skillDmg, undefined, '不表态时按前台处理')
  assert.equal(runtime.modifiersAt('b', 100, { offField: true }).stats.skillDmg, undefined, 'self 效果不加给别人')
}

// ---------- 3. 永久数据：常驻部分进审计条目，后台部分进 runtimeEffects ----------
const klee = buildRuntimePermanent({ characterId: '10000029', name: '可莉', weaponId: '14514', refinement: 1 })
assert.equal(klee.ok, true)

const audit = klee.data.effects['artifact-set:400271:4pc']
assert.equal(audit.status, 'verified-static')
assert.equal(audit.runtimeRequired, true)
assert.equal(audit.unmodeled, undefined, '后台 +25% 已建模，不能再报未建模')
assert.deepEqual(audit.modifiers, [{ key: 'skillDmg', value: 0.25 }], '常驻的 +25% 仍在面板里')

const offField = klee.data.runtimeEffects['artifact-set:400271:4pc-offfield']
assert.ok(offField, '后台 +25% 进运行时效果表')
assert.equal(offField.trigger, 'always')
assert.equal(offField.offFieldOnly, true)
assert.equal(offField.stats.skillDmg, 0.25)
assert.equal(offField.durationFrames, undefined, '常驻到窗口结束')

// ---------- 4. 时间轴：always 效果开局注册 ----------
{
  const run = simulateTimeline({
    scheduler: 'asap',
    steps: [{ id: 's1', kind: 'action', actionId: 'a0.skill', actorId: 'actor:0' }],
    actions: {
      'a0.skill': {
        id: 'a0.skill', actorId: 'actor:0', kind: 'skill',
        timing: { type: 'frames', frames: 40 },
        hits: [{ atFrame: 10, motionValue: 1, scaling: 'atk', element: 'geo', canCrit: true }]
      }
    },
    actors: [{ actorId: 'actor:0', energy: 0, energyMax: 80 }],
    activeActorId: 'actor:0',
    frameTier: FRAME_TIERS['fps-60'],
    measurementEndFrame: 120,
    effects: {
      'artifact-set:400271:4pc-offfield': {
        id: 'artifact-set:400271:4pc-offfield', target: 'self', stats: { skillDmg: 0.25 },
        trigger: 'always', offFieldOnly: true
      }
    },
    effectTriggers: [{ effectId: 'artifact-set:400271:4pc-offfield', actorId: 'actor:0', on: 'always' }]
  })
  assert.equal(run.status, 'simulated')
  const active = run.effects.find(effect => effect.effectId === 'artifact-set:400271:4pc-offfield')
  assert.ok(active, '开局注册后应出现在生效快照里')
  assert.equal(active.startedAt, 0)
  assert.ok(active.expiresAt >= 120, '持续到窗口结束')
}
