import assert from 'node:assert/strict'
import { mod } from './_helper.mjs'
const { buildTeamRunReport, formatTeamRunReport } = await import(mod('modules/teamSimulation/report.js'))

// 一轮成功编排的最小结果：两角色三段命中，同一效果触发两次，带一段卡肉近似项。
const calculated = {
  status: 'calculated',
  scope: 'team-run-no-reaction',
  simulationReady: false,
  versions: { pack: '6.0-synthetic', panels: '6.0-synthetic' },
  checks: [
    { stage: 'data-pack', status: 'ok', issues: [] },
    { stage: 'versions', status: 'ok', issues: [] },
    { stage: 'rotation', status: 'ok', issues: [] },
    { stage: 'members', status: 'ok', issues: [] },
    { stage: 'timeline', status: 'ok', issues: [] },
    { stage: 'damage', status: 'ok', issues: [] }
  ],
  timeline: {
    status: 'simulated',
    simulationReady: false,
    endFrame: 48,
    timing: { tierId: 'fps-60', timerTickMs: 17, gameMs: 816, realMs: 795.2417 },
    approximateItems: ['hitlag:6:5'],
    triggers: [{ effectId: 'party-atk', stacks: 1 }, { effectId: 'party-atk', stacks: 2 }]
  },
  damage: {
    status: 'calculated',
    total: 12000,
    perActor: { itto: 9000, albedo: 3000 },
    rows: [
      { frame: 6, actorId: 'itto', actionId: 'itto.normal-1', damage: 4000 },
      { frame: 18, actorId: 'itto', actionId: 'itto.normal-1', damage: 5000 },
      { frame: 39, actorId: 'albedo', actionId: 'albedo.skill', damage: 3000 }
    ]
  },
  issues: []
}

const report = buildTeamRunReport(calculated)
assert.equal(report.status, 'calculated')
assert.equal(report.simulationReady, false)
assert.deepEqual(report.versions, { pack: '6.0-synthetic', panels: '6.0-synthetic' })
assert.deepEqual(report.stages.map(stage => stage.stage), ['data-pack', 'versions', 'rotation', 'members', 'timeline', 'damage'])
assert.equal(report.hits, 3)
assert.equal(report.total, 12000)
assert.deepEqual(report.perActor, [{ actorId: 'itto', hits: 2, total: 9000 }, { actorId: 'albedo', hits: 1, total: 3000 }])
assert.deepEqual(report.perAction, [
  { actorId: 'itto', actionId: 'itto.normal-1', hits: 2, total: 9000 },
  { actorId: 'albedo', actionId: 'albedo.skill', hits: 1, total: 3000 }
])
assert.deepEqual(report.triggers, [{ effectId: 'party-atk', count: 2 }])
assert.deepEqual(report.approximateItems, ['hitlag:6:5'])
assert.deepEqual(report.window, { endFrame: 48, tierId: 'fps-60', tickMs: 17, gameMs: 816, realMs: 795.2417 })

// 摘要按行给，角色与动作各一行，近似项与关状态都要露出来，不能只报总数。
const lines = formatTeamRunReport(report)
assert.equal(lines[0], '队伍模拟：calculated（不可用于正式结论）')
assert.ok(lines.includes('关：data-pack=ok · versions=ok · rotation=ok · members=ok · timeline=ok · damage=ok'), lines.join('\n'))
assert.ok(lines.includes('版本：数据包 6.0-synthetic / 面板 6.0-synthetic'), lines.join('\n'))
assert.ok(lines.includes('窗口：48 帧 · fps-60（17ms/帧）· 游戏 816ms · 现实 795.2ms'), lines.join('\n'))
assert.ok(lines.includes('命中：3 段，合计 12000'), lines.join('\n'))
assert.ok(lines.includes('  角色 itto：2 段 9000'), lines.join('\n'))
assert.ok(lines.includes('  动作 albedo / albedo.skill：1 段 3000'), lines.join('\n'))
assert.ok(lines.includes('触发：party-atk×2'), lines.join('\n'))
assert.ok(lines.includes('近似项：hitlag:6:5'), lines.join('\n'))

// 失败的一轮：不给窗口与版本，问题逐条列出，关状态仍要能看出卡在哪一关。
const failed = {
  status: 'invalid',
  checks: [
    { stage: 'data-pack', status: 'ok', issues: [] },
    { stage: 'versions', status: 'invalid', issues: [{ code: 'invalid', path: 'pack.gameVersion', message: '数据包版本 7.1 与面板数据版本 6.0-synthetic 不一致：跨版本混跑没有意义' }] }
  ],
  issues: [{ code: 'invalid', path: 'pack.gameVersion', message: '数据包版本 7.1 与面板数据版本 6.0-synthetic 不一致：跨版本混跑没有意义' }]
}
const bad = buildTeamRunReport(failed)
assert.equal(bad.status, 'invalid')
assert.equal(bad.versions, null)
assert.equal(bad.window, null)
assert.equal(bad.hits, 0)
assert.deepEqual(bad.problems.map(problem => problem.path), ['pack.gameVersion'])
assert.equal(bad.stages[1].issues, 1)
const badLines = formatTeamRunReport(bad)
assert.equal(badLines[0], '队伍模拟：invalid')
assert.ok(!badLines.some(line => line.startsWith('窗口：')), badLines.join('\n'))
assert.ok(badLines.includes('问题：pack.gameVersion [invalid] 数据包版本 7.1 与面板数据版本 6.0-synthetic 不一致：跨版本混跑没有意义'), badLines.join('\n'))
console.log('team-sim-report: passed; projection, per-actor/action aggregation, triggers, approximations and failure layout checked')
