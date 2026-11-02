import assert from 'node:assert/strict'
import fs from 'node:fs'

import { mod } from './_helper.mjs'

const S = await import(mod('model/TeamSimStore.js'))

/**
 * 队伍模拟运行期取数的三件纯逻辑：角色 → 键、四份配装 → 合成包、录制 → 轴。
 * 文件系统只读，不需要 bot 环境。
 */
const roster = JSON.parse(fs.readFileSync(new URL('../data/team-sim/roster.json', import.meta.url), 'utf8'))
const entry = over => ({ charId: '1', cn: 'X', element: 'geo', weapon: 'sword', star: 5, keys: ['x'], dir: 'x', status: 'mapped', ...over })
const build = over => ({ characterId: '10000030', name: '钟离', element: 'geo', ...over })

// ---------- 1. 角色 → gcsim 键 ----------
assert.equal(S.resolveKey(entry(), build()).key, 'x')
assert.equal(S.resolveKey(undefined, build()).issue.code, 'missing')
assert.equal(S.resolveKey(entry({ status: 'no-gcsim' }), build()).issue.code, 'unsupported')
assert.equal(S.resolveKey(entry({ status: 'alias', cn: '旅行者' }), build()).issue.code, 'unsupported')
assert.equal(S.resolveKey(entry({ status: 'traveler', charId: '10000005', keys: [] }), build({ element: 'geo' })).key, 'aethergeo')
assert.equal(S.resolveKey(entry({ status: 'traveler', charId: '10000007', keys: [] }), build({ element: 'dendro' })).key, 'luminedendro')
assert.equal(S.resolveKey(entry({ status: 'traveler', charId: '10000005', keys: [] }), build({ element: '' })).issue.code, 'missing')

// ---------- 2. 四份配装 → 一份合成包 ----------
const KEYS = ['zhongli', 'albedo', 'gorou', 'aratakiitto']
const IDS = { zhongli: '10000030', albedo: '10000038', gorou: '10000055', aratakiitto: '10000057' }
const builds = KEYS.map(key => ({ characterId: IDS[key], name: key, element: 'geo' }))
const team = S.loadTeamPack(builds)
assert.equal(team.status, 'ok', JSON.stringify(team.issues))
assert.deepEqual(team.keys, KEYS)
assert.ok(team.pack.actions['zhongli.burst'], '人工核对的爆发动作应当并入')

const stranger = S.loadTeamPack([...builds.slice(0, 3), { characterId: '99999999', name: '不存在', element: 'geo' }])
assert.equal(stranger.status, 'incomplete')
assert.ok(stranger.issues[0].message.includes('不在名录'), JSON.stringify(stranger.issues))

const noGcsim = roster.characters.find(c => c.status === 'no-gcsim')
const blocked = S.loadTeamPack([...builds.slice(0, 3), { characterId: noGcsim.charId, name: noGcsim.cn, element: 'geo' }])
assert.equal(blocked.status, 'unsupported')
assert.ok(blocked.issues[0].message.includes('还没有 gcsim 动作数据'), JSON.stringify(blocked.issues))

// 名录缺失角色必须点名，而不是悄悄按物理倍率算
assert.equal(new Set(team.keys).size, 4)

// ---------- 3. 录制 + 键位表 → 轴 ----------
const recording = {
  schemaVersion: 1,
  frameTierId: 'fps-60',
  keymapVersion: 'test-v1',
  gameVersion: '7.1',
  source: 'test',
  start: { activeActorId: '10000030', actors: [{ actorId: '10000030', energy: 0, energyMax: 40 }] },
  events: [
    { atMs: 0, key: 'e', phase: 'down' },
    { atMs: 1000, key: 'q', phase: 'down' }
  ]
}
const keymap = {
  version: 'test-v1',
  bindings: {
    e: { actorId: '10000030', actionId: 'zhongli.skill' },
    q: { actorId: '10000030', actionId: 'zhongli.burst' }
  }
}
const file = { schemaVersion: 1, id: 'test-rotation', team: ['10000030'], measurementEndFrame: 900, keymap, recording }
const converted = S.toRotation(file, team.pack)
assert.equal(converted.status, 'ok', JSON.stringify(converted.issues))
assert.equal(converted.rotation.steps.length, 2)
assert.equal(converted.rotation.steps[0].actionId, 'zhongli.skill')
assert.equal(converted.rotation.steps[1].actionId, 'zhongli.burst')
assert.ok(converted.rotation.steps[1].atFrame > converted.rotation.steps[0].atFrame)
assert.equal(converted.rotation.measurementEndFrame, 900)

const wrongKeymap = S.toRotation({ ...file, keymap: { ...keymap, version: 'test-v2' } }, team.pack)
assert.equal(wrongKeymap.status, 'invalid')
assert.ok(wrongKeymap.issues[0].message.includes('不一致'), JSON.stringify(wrongKeymap.issues))

const badBinding = S.toRotation({ ...file, keymap: { ...keymap, bindings: { e: { actorId: '10000030', actionId: 'zhongli.normal-99' } } } }, team.pack)
assert.notEqual(badBinding.status, 'ok', '键位指向不存在的动作必须拒绝')

// 窗口必须覆盖最后一步，否则最后一段不会结算
const shortWindow = S.toRotation({ ...file, measurementEndFrame: 1 }, team.pack)
assert.equal(shortWindow.status, 'invalid')

// ---------- 4. 没有轴 / 没有永久数据时如实报缺 ----------
// 2026-11-02：纯岩四人已有示例轴（geo-four.json），这里换一支没有轴的队伍验证「如实报缺」
const none = S.findRotation(['10000035', '10000036', '10000037', '10000039'])
assert.equal(none.rotationFile, undefined)
assert.deepEqual(none.nearby, [])
assert.ok(S.listRotationFiles().every(name => name.endsWith('.json')))

// 没有同队轴时，要能指出「最接近的现有轴」——差哪个人一目了然。
const near = S.findRotation(['10000032', '10000023', '10000025', '10000089'])
assert.equal(near.rotationFile, undefined)
assert.ok(near.nearby.length >= 1, JSON.stringify(near.nearby))
assert.ok(near.nearby[0].shared.length >= 3, JSON.stringify(near.nearby[0]))
assert.ok(near.nearby.every(item => item.shared.length >= 2))
const exactTeam = JSON.parse(fs.readFileSync(S.listRotationFiles().find(file => file.endsWith('demo-skill-sequence.json')) ?? '', 'utf8'))
assert.ok(exactTeam.team)
const exact = S.findRotation(exactTeam.team)
assert.ok(exact.rotationFile)
assert.deepEqual(exact.nearby, [], '命中同队轴时不再给候选')

// 永久数据：钟离的黑缨枪有入库文件；没有文件的组合（七七 + 祭礼剑）按玩家配装现算。
// 2026-11-02 用户定：不再要求先跑离线生成器，任意角色 + 武器都能现算。
const runtime = S.loadPermanentData({ characterId: '10000035', name: '七七', weapon: { id: '11401', refinement: 1 } })
assert.ok(runtime.data, JSON.stringify(runtime.issue))
assert.equal(runtime.data.bundleId, 'permanent-7.1')
assert.equal(runtime.data.weapon.id, '11401')

const already = S.loadPermanentData({ characterId: IDS.zhongli, name: '钟离', weapon: { id: '13303', refinement: 1 } })
assert.ok(already.data, JSON.stringify(already.issue))
assert.equal(already.data.bundleId, 'permanent-7.1')

console.log(JSON.stringify({ keys: team.keys, actions: Object.keys(team.pack.actions).length }))
