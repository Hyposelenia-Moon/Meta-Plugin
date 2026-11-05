/**
 * 泛化命中触发的 4 件套（2026-11-04 第一轮第一批）：武人、沙上楼阁、回声之林、水仙之梦。
 *
 * 1) 永久数据：runtimeEffects 的 trigger / 数值 / 时长；
 * 2) 时间轴：技能起手、重击命中、任意命中各自激活；
 * 3) 泛化后旧的 geo-hit / skill-hit 不受影响（由既有套件覆盖）。
 */
import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'

const { FRAME_TIERS, simulateTimeline } = await import(mod('modules/teamSimulation/timeline.js'))
const { buildRuntimePermanent } = await import(mod('model/PermanentSource.js'))

const specOf = (charId, name, weaponId, effectId) => {
  const runtime = buildRuntimePermanent({ characterId: charId, name, weaponId, refinement: 1 })
  assert.equal(runtime.ok, true, `${name} 应能生成永久数据`)
  const spec = runtime.data.runtimeEffects?.[effectId]
  assert.ok(spec, `${name} 的 ${effectId} 应出现在 runtimeEffects`)
  return { spec, audit: runtime.data.effects[effectId] }
}

// ---------- 1. 永久数据 ----------
{
  const { spec, audit } = specOf('10000023', '香菱', '13407', 'artifact-set:400028:4pc')
  assert.equal(spec.trigger, 'cast-skill')
  assert.equal(spec.stats.normalDmg, 0.25)
  assert.equal(spec.stats.chargedDmg, 0.25)
  assert.equal(spec.durationFrames, 480)
  assert.equal(audit.status, 'verified-static')
}

{
  const { spec, audit } = specOf('10000023', '香菱', '13407', 'artifact-set:400221:4pc')
  assert.equal(spec.trigger, 'charged-hit')
  assert.equal(spec.stats.normalDmg, 0.4)
  assert.equal(spec.stats.chargedDmg, 0.4)
  assert.equal(spec.stats.plungeDmg, 0.4)
  assert.equal(spec.durationFrames, 900)
  assert.equal(audit.unmodeled === undefined, false, '普攻提速没进帧表，必须披露')
}

{
  const { spec } = specOf('10000030', '钟离', '13303', 'artifact-set:400291:4pc')
  assert.equal(spec.trigger, 'cast-skill')
  assert.equal(spec.stats.geo, 0.2)
  assert.equal(spec.durationFrames, 600)
}

{
  const { spec } = specOf('10000023', '香菱', '13407', 'artifact-set:400241:4pc')
  assert.equal(spec.trigger, 'hit')
  assert.equal(spec.stacking, 'stack')
  assert.equal(spec.maxStacks, 3)
  assert.equal(spec.stats.atkPct, 0.07)
}

{
  const { spec, audit } = specOf('10000023', '香菱', '13407', 'artifact-set:400341:4pc')
  assert.equal(spec.trigger, 'plunge-hit')
  assert.deepEqual(spec.extraTriggers, ['charged-hit', 'skill-hit'])
  assert.equal(spec.stats.plungeDmg, 0.15)
  assert.equal(spec.maxStacks, 5)
  assert.equal(spec.icdFrames, 60)
  assert.deepEqual(spec.stacksPerTrigger, { 'plunge-hit': 1, 'charged-hit': 2, 'skill-hit': 2 })
  assert.equal(audit.status, 'verified-static')
  assert.ok(audit.unmodeled, '每层独立计时按整池刷新近似，必须披露')
}

{
  const { spec, audit } = specOf('10000023', '香菱', '13407', 'artifact-set:400391:4pc')
  assert.equal(spec.trigger, 'hit')
  assert.equal(spec.stats.atkPct, 0.25)
  assert.equal(spec.durationFrames, 360)
  assert.ok(audit.unmodeled, '魔女课业升级未建模，必须披露')
}

{
  const { spec, audit } = specOf('10000023', '香菱', '13407', 'artifact-set:400179:4pc')
  assert.equal(spec.trigger, 'cast-skill')
  assert.equal(spec.stats.normalDmg, 0.5)
  assert.equal(spec.durationFrames, 600)
  assert.equal(spec.energyCost, 15, '追忆之注连施放战技要扣 15 点能量')
  assert.ok(audit.unmodeled, '持续期间不再触发未建模，必须披露')
}

// ---------- 1b2. 追忆之注连：能量不足时不触发 ----------
{
  const effects = {
    'artifact-set:400179:4pc': {
      id: 'artifact-set:400179:4pc', target: 'self',
      stats: { normalDmg: 0.5, chargedDmg: 0.5, plungeDmg: 0.5 },
      durationFrames: 600, trigger: 'cast-skill', stacking: 'refresh', energyCost: 15
    }
  }
  const actions = {
    'a0.skill': {
      id: 'a0.skill', actorId: 'actor:0', kind: 'skill',
      timing: { type: 'frames', frames: 40 },
      hits: [{ atFrame: 10, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: true }]
    }
  }
  const runWith = (energy) => simulateTimeline({
    scheduler: 'fixed',
    steps: [{ id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'a0.skill', atFrame: 0 }],
    actions,
    actors: [{ actorId: 'actor:0', energy, energyMax: 80 }],
    activeActorId: 'actor:0',
    frameTier: FRAME_TIERS['fps-60'],
    measurementEndFrame: 150,
    effects,
    effectTriggers: [{ effectId: 'artifact-set:400179:4pc', actorId: 'actor:0', on: 'cast-skill' }]
  })
  const rich = runWith(20)
  assert.equal(rich.status, 'simulated', JSON.stringify(rich.issues))
  assert.equal(rich.triggers.length, 1, '能量足够时触发')
  assert.equal(rich.actors.find(a => a.actorId === 'actor:0').energy, 5, '扣掉 15 点能量')
  const poor = runWith(10)
  assert.equal(poor.triggers.length, 0, '能量不足时不能触发')
  const skipped = poor.events.find(e => e.detail?.skipped === 'energy')
  assert.ok(skipped, '要留下 skipped: energy 记录')
  assert.equal(poor.actors.find(a => a.actorId === 'actor:0').energy, 10, '能量不足时不扣')
}

// ---------- 1c. 苍白之火与黄金剧团 ----------
{
  const { spec, audit } = specOf('10000023', '香菱', '13407', 'artifact-set:400174:4pc')
  assert.equal(spec.trigger, 'skill-hit')
  assert.equal(spec.stats.atkPct, 0.09)
  assert.equal(spec.maxStacks, 2)
  assert.equal(spec.icdFrames, 18)
  assert.ok(audit.unmodeled, '满层时 2 件套翻倍未建模，必须披露')
}

{
  const runtime = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: '13407', refinement: 1 })
  assert.equal(runtime.ok, true)
  const audit = runtime.data.effects['artifact-set:400271:4pc']
  assert.ok(audit, '黄金剧团 4 件套应有审计条目')
  assert.equal(audit.status, 'verified-static')
  assert.deepEqual(audit.modifiers, [{ key: 'skillDmg', value: 0.25 }])
  assert.equal(audit.runtimeRequired, true, '后台 +25% 走运行时效果')
  assert.equal(audit.unmodeled, undefined, '后台 +25% 已建模（见 team-sim-offfield-4pc）')
}

// ---------- 1d. 无伤害影响类：只登记不计算，不写 unmodeled ----------
for (const [setId, keyword] of [['400013', '抗性'], ['400018', '抗性'], ['400047', '恢复'], ['400052', '摩拉'], ['400062', '恢复'], ['400084', '治疗']]) {
  const runtime = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: '13407', refinement: 1 })
  assert.equal(runtime.ok, true)
  const audit = runtime.data.effects[`artifact-set:${setId}:4pc`]
  assert.ok(audit, `${setId} 应有审计条目`)
  assert.equal(audit.status, 'verified-static')
  assert.deepEqual(audit.modifiers, [])
  assert.equal(audit.unmodeled, undefined, '已判定无伤害影响，不能写 unmodeled')
  assert.ok(String(audit.note ?? '').includes(keyword), `${setId} 的 note 要说明为什么不影响输出`)
}

// ---------- 1b. 长夜之誓：按来源给层数、共用 1 秒冷却 ----------
{
  const effects = {
    'artifact-set:400341:4pc': {
      id: 'artifact-set:400341:4pc', target: 'self',
      stats: { plungeDmg: 0.15 }, durationFrames: 360,
      trigger: 'plunge-hit', extraTriggers: ['charged-hit', 'skill-hit'],
      stacking: 'stack', maxStacks: 5, icdFrames: 60,
      stacksPerTrigger: { 'plunge-hit': 1, 'charged-hit': 2, 'skill-hit': 2 }
    }
  }
  const mk = (id, kind, atFrame) => ({
    id, actorId: 'actor:0', kind,
    timing: { type: 'frames', frames: 30 },
    hits: [{ atFrame, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: true }]
  })
  const actions = {
    'a0.charged': mk('a0.charged', 'charged', 6),
    'a0.skill': mk('a0.skill', 'skill', 6),
    'a0.plunge': mk('a0.plunge', 'plunge', 6)
  }
  const run = simulateTimeline({
    scheduler: 'fixed',
    steps: [
      { id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'a0.charged', atFrame: 0 },
      { id: 's2', kind: 'action', actorId: 'actor:0', actionId: 'a0.skill', atFrame: 30 },
      { id: 's3', kind: 'action', actorId: 'actor:0', actionId: 'a0.plunge', atFrame: 80 }
    ],
    actions,
    actors: [{ actorId: 'actor:0', energy: 0, energyMax: 60 }],
    activeActorId: 'actor:0',
    frameTier: FRAME_TIERS['fps-60'],
    measurementEndFrame: 300,
    effects,
    effectTriggers: [
      { effectId: 'artifact-set:400341:4pc', actorId: 'actor:0', on: 'charged-hit' },
      { effectId: 'artifact-set:400341:4pc', actorId: 'actor:0', on: 'skill-hit' },
      { effectId: 'artifact-set:400341:4pc', actorId: 'actor:0', on: 'plunge-hit' }
    ]
  })
  assert.equal(run.status, 'simulated', JSON.stringify(run.issues))
  const fired = run.triggers.filter(t => t.effectId === 'artifact-set:400341:4pc')
  assert.deepEqual(fired.map(t => [t.frame, t.stacks]), [[6, 2], [86, 3]], '重击 +2、战技在冷却内不再叠、下落 +1')
}

// ---------- 1e. 流放者：爆发后按间隔给队友回能 ----------
{
  const effects = {
    'artifact-set:400043:4pc': {
      id: 'artifact-set:400043:4pc', target: 'team',
      durationFrames: 480, trigger: 'cast-burst', stacking: 'refresh',
      energyRestore: { amount: 2, target: 'team', excludeSelf: true, everyFrames: 120, times: 3 }
    }
  }
  const actions = {
    'a0.burst': {
      id: 'a0.burst', actorId: 'actor:0', kind: 'burst',
      timing: { type: 'frames', frames: 60 },
      hits: [{ atFrame: 20, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: true }]
    }
  }
  const run = simulateTimeline({
    scheduler: 'fixed',
    steps: [{ id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'a0.burst', atFrame: 0 }],
    actions,
    actors: [{ actorId: 'actor:0', energy: 0, energyMax: 80 }, { actorId: 'actor:1', energy: 0, energyMax: 80 }],
    activeActorId: 'actor:0',
    frameTier: FRAME_TIERS['fps-60'],
    measurementEndFrame: 500,
    effects,
    effectTriggers: [{ effectId: 'artifact-set:400043:4pc', actorId: 'actor:0', on: 'cast-burst' }]
  })
  assert.equal(run.status, 'simulated', JSON.stringify(run.issues))
  const restored = run.events.filter(e => e.kind === 'energy-restore')
  assert.deepEqual(restored.map(e => e.frame), [120, 240, 360], '每 2 秒回一次，共 3 次')
  assert.equal(restored.every(e => e.detail.gain['actor:0'] === undefined), true, '不给自己回能')
  assert.equal(run.actors.find(a => a.actorId === 'actor:1').energy, 6)
  assert.equal(run.actors.find(a => a.actorId === 'actor:0').energy, 0)
}

// ---------- 1f. 学士：产球回能受 3 秒 ICD 限制 ----------
{
  const effects = {
    'artifact-set:400058:4pc': {
      id: 'artifact-set:400058:4pc', target: 'team',
      durationFrames: 180, trigger: 'particle', stacking: 'refresh', icdFrames: 180,
      energyRestore: { amount: 3, target: 'team' }
    }
  }
  const actions = {
    'a0.skill': {
      id: 'a0.skill', actorId: 'actor:0', kind: 'skill',
      timing: { type: 'frames', frames: 400 },
      hits: [{ atFrame: 10, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: true }],
      particles: [
        { atFrame: 20, count: 1, element: 'hydro', travelFrames: 0 },
        { atFrame: 120, count: 1, element: 'hydro', travelFrames: 0 }
      ]
    }
  }
  const run = simulateTimeline({
    scheduler: 'fixed',
    steps: [{ id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'a0.skill', atFrame: 0 }],
    actions,
    actors: [{ actorId: 'actor:0', energy: 0, energyMax: 80 }, { actorId: 'actor:1', energy: 0, energyMax: 80 }],
    activeActorId: 'actor:0',
    frameTier: FRAME_TIERS['fps-60'],
    measurementEndFrame: 400,
    effects,
    effectTriggers: [{ effectId: 'artifact-set:400058:4pc', actorId: 'actor:0', on: 'particle' }]
  })
  assert.equal(run.status, 'simulated', JSON.stringify(run.issues))
  const restored = run.events.filter(e => e.kind === 'energy-restore')
  assert.deepEqual(restored.map(e => e.frame), [20], '第二次产球在 3 秒 ICD 内，不再回能')
  assert.equal(restored[0].detail.gain['actor:1'], 3)
  // 产球是全队共享的：actor:1 先吃到两颗微粒的 2 点，再加学士的 3 点。
  assert.equal(run.actors.find(a => a.actorId === 'actor:1').energy, 5)
}

// ---------- 2. 时间轴：重击命中触发沙上楼阁 ----------
{
  const effects = {
    'artifact-set:400221:4pc': {
      id: 'artifact-set:400221:4pc', target: 'self',
      stats: { normalDmg: 0.4, chargedDmg: 0.4, plungeDmg: 0.4 },
      durationFrames: 900, trigger: 'charged-hit', stacking: 'refresh'
    }
  }
  const actions = {
    'a0.charged': {
      id: 'a0.charged', actorId: 'actor:0', kind: 'charged',
      timing: { type: 'frames', frames: 60 },
      hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: true }]
    },
    'a0.normal-1': {
      id: 'a0.normal-1', actorId: 'actor:0', kind: 'normal',
      timing: { type: 'frames', frames: 40 },
      hits: [{ atFrame: 30, motionValue: 1, scaling: 'atk', element: 'physical', canCrit: true }]
    }
  }
  const run = simulateTimeline({
    scheduler: 'fixed',
    steps: [
      { id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'a0.charged', atFrame: 0 },
      { id: 's2', kind: 'action', actorId: 'actor:0', actionId: 'a0.normal-1', atFrame: 60 }
    ],
    actions,
    actors: [{ actorId: 'actor:0', energy: 0, energyMax: 60 }],
    activeActorId: 'actor:0',
    frameTier: FRAME_TIERS['fps-60'],
    measurementEndFrame: 200,
    effects,
    effectTriggers: [{ effectId: 'artifact-set:400221:4pc', actorId: 'actor:0', on: 'charged-hit' }]
  })
  assert.equal(run.status, 'simulated', JSON.stringify(run.issues))
  const fired = run.triggers.filter(t => t.effectId === 'artifact-set:400221:4pc')
  assert.deepEqual(fired.map(t => t.frame), [6], '只有重击命中触发，普攻命中不再触发')
  const event = run.events.find(e => e.detail?.effectId === 'artifact-set:400221:4pc')
  assert.equal(event?.detail?.source, 'charged-hit')
}

// ---------- 3. 任意命中触发（水仙之梦） ----------
{
  const effects = {
    'artifact-set:400241:4pc': {
      id: 'artifact-set:400241:4pc', target: 'self',
      stats: { atkPct: 0.07, hydro: 0.04 },
      durationFrames: 480, trigger: 'hit', stacking: 'stack', maxStacks: 3, icdFrames: 1
    }
  }
  const actions = {
    'a0.skill': {
      id: 'a0.skill', actorId: 'actor:0', kind: 'skill',
      timing: { type: 'frames', frames: 30 },
      hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: true }]
    },
    'a0.normal-1': {
      id: 'a0.normal-1', actorId: 'actor:0', kind: 'normal',
      timing: { type: 'frames', frames: 40 },
      hits: [{ atFrame: 6, motionValue: 1, scaling: 'atk', element: 'hydro', canCrit: true }]
    }
  }
  const run = simulateTimeline({
    scheduler: 'fixed',
    steps: [
      { id: 's1', kind: 'action', actorId: 'actor:0', actionId: 'a0.skill', atFrame: 0 },
      { id: 's2', kind: 'action', actorId: 'actor:0', actionId: 'a0.normal-1', atFrame: 60 }
    ],
    actions,
    actors: [{ actorId: 'actor:0', energy: 0, energyMax: 60 }],
    activeActorId: 'actor:0',
    frameTier: FRAME_TIERS['fps-60'],
    measurementEndFrame: 200,
    effects,
    effectTriggers: [{ effectId: 'artifact-set:400241:4pc', actorId: 'actor:0', on: 'hit' }]
  })
  assert.equal(run.status, 'simulated', JSON.stringify(run.issues))
  const fired = run.triggers.filter(t => t.effectId === 'artifact-set:400241:4pc')
  assert.deepEqual(fired.map(t => t.stacks), [1, 2], '技能与普攻命中各叠一层')
}
