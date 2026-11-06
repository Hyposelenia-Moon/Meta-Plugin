/**
 * 附着与产球元数据（2026-11-06）：`data/team-sim/attachment.json`。
 *
 * 这份数据只做记录与披露，不参与结算（内核不模拟元素附着，反应由数据包声明）；
 * 产球概率已人工核对后写进 curated 的 `chance`，这里锁定原始条目的可追溯性。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const data = JSON.parse(readFileSync(join(root, 'data/team-sim/attachment.json'), 'utf8'))

assert.equal(data.schemaVersion, 1)
assert.match(data.source, /db\.gensri\.wiki/)
assert.match(data.note, /不参与结算/)
assert.ok(data.counts.characters >= 115, `角色数偏少：${data.counts.characters}`)
assert.ok(data.counts.attacks >= 1000, `攻击条目偏少：${data.counts.attacks}`)
assert.ok(data.counts.energy >= 170, `产球条目偏少：${data.counts.energy}`)

// 阿贝多：技能命中盒是 1U / Independent，产球 67%，两头都要能查到。
const albedo = data.characters['10000038']
assert.ok(albedo, '缺阿贝多')
assert.equal(albedo.cn, '阿贝多')
const skillAttack = albedo.attacks.find((item) => item.name === 'SkillObj_FuriousMonolith')
assert.ok(skillAttack, '缺阿贝多的技能命中盒')
assert.equal(skillAttack.gauge, '1U')
assert.equal(skillAttack.icdRule, 'Independent')
assert.equal(skillAttack.element, 'Rock')
assert.equal(albedo.energy[0].chance, '67%')
assert.equal(albedo.energy[0].particles, '1')

// 香菱：锅巴产球在原始数据里就是 1 颗 / 100%。
const xiangling = data.characters['10000023']
assert.ok(xiangling, '缺香菱')
assert.ok(xiangling.energy.some((item) => item.particles === '1' && item.chance === '100%'))

// 抓取失败的角色不在文件里（妮露/赛诺：站点 502 / terminated）。
assert.equal(data.characters['10000070'], undefined)
assert.equal(data.characters['10000071'], undefined)

console.log(`附着元数据：${data.counts.characters} 角色 / ${data.counts.attacks} 条攻击 / ${data.counts.energy} 条产球`)
