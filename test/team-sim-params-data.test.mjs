import assert from 'node:assert/strict'
import fs from 'node:fs'

// 图鉴数值参数（经站点作者授权的导出）只做对照依据，不参与运行时结算。
// 这份测试守住两件事：schema 不自相矛盾；关键套装的数值与我们已经写死的实现一致。

const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'))

const artifact = read('data/team-sim/artifact-params.json')
const weapon = read('data/team-sim/weapon-params.json')

assert.equal(artifact.schemaVersion, 1)
assert.equal(weapon.schemaVersion, 1)
assert.ok(artifact.source.includes('gensri'))
assert.ok(weapon.source.includes('gensri'))

// ---- 圣遗物 ----
assert.ok(artifact.sets.length >= 60, `套装数量异常：${artifact.sets.length}`)
const setIds = artifact.sets.map((set) => set.id)
assert.equal(new Set(setIds).size, setIds.length, '套装 id 不能重复')

const withFour = artifact.sets.filter((set) => set.fourPiece)
assert.ok(withFour.length >= 60, `4 件套数量异常：${withFour.length}`)
for (const set of withFour) {
  assert.ok(set.name, `${set.id} 缺套装名`)
  assert.ok(set.fourPiece.desc.length > 0, `${set.id} 4 件套缺描述`)
  assert.ok(Array.isArray(set.fourPiece.params), `${set.id} params 必须是数组`)
  for (const value of set.fourPiece.params) {
    assert.ok(Number.isFinite(value), `${set.id} params 含非有限数`)
  }
}

const byName = new Map(artifact.sets.map((set) => [set.name, set]))
const paramsOf = (name) => byName.get(name)?.fourPiece?.params ?? []

// 与已建模实现逐条对齐的数值（这些值在 src/model/PermanentSource.ts 里写死）。
assert.deepEqual(paramsOf('角斗士的终幕礼').slice(0, 1), [0.35])
assert.deepEqual(paramsOf('流浪大地的乐团').slice(0, 1), [0.35])
assert.deepEqual(paramsOf('武人').slice(0, 3), [8, 1, 0.25])
assert.deepEqual(paramsOf('教官').slice(0, 2), [8, 120])
assert.deepEqual(paramsOf('昔日宗室之仪').slice(0, 2), [0.2, 12])
assert.deepEqual(paramsOf('流放者').slice(0, 2), [2, 6])
assert.deepEqual(paramsOf('学士').slice(0, 1), [3])
assert.deepEqual(paramsOf('绝缘之旗印').slice(0, 2), [0.25, 0.75])
assert.deepEqual(paramsOf('华馆梦醒形骸记').slice(0, 6), [0.3, 3, 0.06, 0.06, 6, 0])
// 千岩：20% 攻击力、30% 护盾强效（护盾强效不影响伤害，未建模）。
assert.deepEqual(paramsOf('千岩牢固').slice(0, 2), [0.2, 0.3])
// 辰砂：16 秒、8% 攻击力（顺序是「时长、数值」，不同套装参数顺序不统一）。
assert.deepEqual(paramsOf('辰砂往生录').slice(0, 2), [16, 0.08])

// ---- 武器 ----
assert.ok(weapon.weapons.length >= 240, `武器数量异常：${weapon.weapons.length}`)
const weaponIds = weapon.weapons.map((item) => item.id)
assert.equal(new Set(weaponIds).size, weaponIds.length, '武器 id 不能重复')

let withPassive = 0
for (const item of weapon.weapons) {
  assert.ok(item.name, `${item.id} 缺武器名`)
  assert.ok(['sword', 'claymore', 'polearm', 'bow', 'catalyst'].includes(item.type), `${item.name} 类型异常：${item.type}`)
  assert.ok(Number.isFinite(item.baseAttack), `${item.name} 白值异常`)
  if (!item.passive) continue
  withPassive++
  assert.ok(item.passive.refinements.length >= 1 && item.passive.refinements.length <= 5, `${item.name} 精炼档数异常：${item.passive.refinements.length}`)
  assert.equal(item.passive.refinements[0].level, 1, `${item.name} 第一档不是精炼 1`)
  for (const [index, refinement] of item.passive.refinements.entries()) {
    assert.equal(refinement.level, index + 1, `${item.name} 精炼等级不连续`)
    assert.ok(refinement.desc.length > 0, `${item.name} 精炼描述为空`)
    assert.ok(refinement.params.every((value) => Number.isFinite(value)), `${item.name} params 含非有限数`)
  }
}
assert.ok(withPassive >= 200, `带被动的武器太少：${withPassive}`)

// 雾切精 1 的三个乘区参数（12% 全元素、8/16/28% 巴印层数）。
const mist = weapon.weapons.find((item) => item.name === '雾切之回光')
assert.ok(mist, '缺雾切之回光')
assert.deepEqual(mist.passive.refinements[0].params.slice(0, 4), [0.12, 0.08, 0.16, 0.28])
