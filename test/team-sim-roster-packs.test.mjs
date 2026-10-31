import assert from 'node:assert/strict'
import fs from 'node:fs'

import { mod } from './_helper.mjs'

const { validateDataPack } = await import(mod('modules/teamSimulation/dataPack.js'))

const roster = JSON.parse(fs.readFileSync(new URL('../data/team-sim/roster.json', import.meta.url), 'utf8'))
const packsDir = new URL('../data/team-sim/packs/', import.meta.url)
const packFiles = fs.readdirSync(packsDir).filter(name => name.endsWith('.json'))

// 名录自身要自洽：数量、状态、charId 与键都不能重复。
const STATUSES = ['mapped', 'traveler', 'alias', 'no-gcsim']
assert.equal(roster.schemaVersion, 1)
assert.equal(roster.gameVersion, '7.1')
assert.ok(roster.source.includes('names.dm.json') || roster.source.includes('character.dm.go'))
assert.equal(roster.characters.length, 127)
assert.equal(roster.counts.characters, roster.characters.length)
for (const character of roster.characters) {
  assert.ok(STATUSES.includes(character.status), `未知状态 ${character.status}`)
  assert.ok(character.charId && character.cn, '每个角色都要有 charId 与中文名')
}
const ids = roster.characters.map(character => character.charId)
assert.equal(new Set(ids).size, ids.length, 'charId 不能重复')
const keys = roster.characters.flatMap(character => character.keys)
assert.equal(new Set(keys).size, keys.length, '英文键不能重复')

// 旅行者按 charId 拆成七个元素键，其余状态不为 mapped 的不能带键。
const traveler = roster.characters.filter(character => character.status === 'traveler')
assert.equal(traveler.length, 2)
for (const character of traveler) assert.equal(character.keys.length, 7, `${character.cn} 应该有七个元素键`)
for (const character of roster.characters.filter(character => character.status === 'no-gcsim')) assert.equal(character.keys.length, 0)

// 除凝光外，每个 mapped 角色都要有数据包：凝光的普攻按左右手状态交替、天赋也只给单行「普通攻击伤害」，
// 不在自动生成的范围内，必须显式列在例外里，不能悄悄消失。
const mapped = roster.characters.filter(character => character.status === 'mapped')
const packKeys = new Set(packFiles.map(name => name.replace(/\.json$/, '')))
const missing = mapped.filter(character => !packKeys.has(character.keys[0])).map(character => character.keys[0])
assert.deepEqual(missing, ['ningguang'])
assert.equal(packFiles.length, mapped.length - 1)

// 每个包都要通过内核的数据包校验，且动作 id 认得出所属角色。
const allActions = new Map()
let multiHitActions = 0
for (const name of packFiles) {
  const pack = JSON.parse(fs.readFileSync(new URL(name, packsDir), 'utf8'))
  const check = validateDataPack(pack)
  assert.deepEqual(check.issues, [], `${name} 校验未通过：${JSON.stringify(check.issues)}`)
  assert.equal(pack.gameVersion, roster.gameVersion)
  const key = name.replace(/\.json$/, '')
  for (const action of Object.values(pack.actions)) {
    assert.ok(action.id.startsWith(`${key}.normal-`), `${name} 的动作 ${action.id} 与角色不对应`)
    assert.equal(allActions.has(action.id), false, `动作 id 重复：${action.id}`)
    allActions.set(action.id, action)
    assert.ok(action.hits.length >= 1)
    assert.ok(action.hits.at(-1).atFrame < action.timing.frames, `${action.id} 命中帧必须早于动作结束`)
    for (let i = 1; i < action.hits.length; i++) assert.ok(action.hits[i].atFrame >= action.hits[i - 1].atFrame, `${action.id} 命中帧必须递增`)
    if (action.hits.length > 1) multiHitActions++
  }
}
assert.ok(multiHitActions >= 20, `多段命中动作只有 ${multiHitActions} 个，像是整段解析失效`)

// 数值抽查：荒泷一斗 N1 取 miao 天赋 10 级（156.62%），命中帧与收尾帧取自 gcsim。
const itto = JSON.parse(fs.readFileSync(new URL('aratakiitto.json', packsDir), 'utf8'))
assert.equal(itto.actions['aratakiitto.normal-1'].hits[0].motionValue, 1.5662)
assert.equal(itto.actions['aratakiitto.normal-1'].hits[0].atFrame, 23)
assert.equal(itto.actions['aratakiitto.normal-1'].timing.frames, 41)
assert.equal(itto.actions['aratakiitto.normal-4'].timing.frames, 83)
assert.equal(itto.actions['aratakiitto.normal-1'].element, 'physical')

// 法器角色的普攻天生带元素，单手剑/双手剑/长柄/弓的附魔态一律按物理落包。
const catalyst = JSON.parse(fs.readFileSync(new URL('nahida.json', packsDir), 'utf8'))
assert.equal(catalyst.actions['nahida.normal-1'].element, 'dendro')
const infused = JSON.parse(fs.readFileSync(new URL('raidenshogun.json', packsDir), 'utf8'))
assert.equal(infused.actions['raidenshogun.normal-1'].element, 'physical')

// 同段多命中：整段合计（香菱 N4 111.52%、N3 103.02%）按 miao「N段伤害2」还原成逐帧倍率，
// 与 gcsim 数据表里的单帧值（27.88%、51.51%）一致；不同值的多段（胡桃 N5）按原样逐帧展开。
const xiangling = JSON.parse(fs.readFileSync(new URL('xiangling.json', packsDir), 'utf8'))
const n3 = xiangling.actions['xiangling.normal-3'].hits
const n4 = xiangling.actions['xiangling.normal-4'].hits
assert.deepEqual(n3.map((h) => h.motionValue), [0.5151, 0.5151])
assert.deepEqual(n4.map((h) => h.motionValue), [0.2788, 0.2788, 0.2788, 0.2788])
assert.deepEqual(n4.map((h) => h.atFrame), [5, 15, 24, 29])
const hutao = JSON.parse(fs.readFileSync(new URL('hutao.json', packsDir), 'utf8'))
const hutaoN5 = hutao.actions['hutao.normal-5'].hits
assert.deepEqual(hutaoN5.map((h) => h.motionValue), [0.5936, 0.628])
