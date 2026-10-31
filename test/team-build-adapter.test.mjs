/** P0配装适配行为：公开字段合成夹具、一次单位转换、缺项拒绝与本地四人桥。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { mod, libDir } from './_helper.mjs'
import { miaoAvatarFixture } from './fixtures/team-sim/miao-builds.mjs'
const { adaptMiaoAvatar } = await import(mod('model/TeamBuildAdapter.js'))
const sourceInfo = { provider: 'miao-public-shape-synthetic', providerVersion: null, sourceTime: null }
for (let i = 0; i < 4; i++) {
  const avatar = miaoAvatarFixture(i)
  const result = adaptMiaoAvatar(avatar, sourceInfo)
  assert.equal(result.status, 'raw-complete', JSON.stringify(result))
  assert.equal(result.simulationReady, false)
  assert.equal(result.build.talents.skill, 9, '必须读取original而非命座加成后12')
  assert.equal(result.build.artifacts[0].main.value, 4780)
  assert.equal(result.build.artifacts[0].sub[0].value, .07)
  assert.equal(result.build.artifacts[1].sub[0].key, 'hpPct')
  assert.ok(Math.abs(result.build.artifacts[1].sub[0].value - .058) < 1e-12)
  assert.equal(result.build.artifacts[2].main.key, 'atkPct')
  assert.equal(result.build.artifacts[2].main.value, .466)
  assert.equal(result.build.artifacts[3].main.key, 'geo')
  assert.deepEqual(result.build.artifacts.map(x => x.slot), ['flower', 'plume', 'sands', 'goblet', 'circlet'])
  assert.deepEqual(result.build.artifacts.map(x => x.sub.length), [4, 4, 4, 4, 4], '五星满级必须4条副词条')
  result.build.artifacts[0].main.value = 1
  assert.equal(avatar.fixtureRows[0].main.value, 4780, '返回值不得共享原始配装对象')
}
const rejects = mutate => { const a = miaoAvatarFixture(); mutate(a); const r = adaptMiaoAvatar(a, sourceInfo); assert.notEqual(r.status, 'raw-complete'); assert.ok(r.issues.length); return r }
rejects(a => { delete a.talent.e.original })
rejects(a => { delete a.weapon.promote })
rejects(a => { delete a.fixtureRows[0].mainId })
rejects(a => { a.fixtureRows[0].main.id = 999 })
rejects(a => { a.fixtureRows[0].attrIds.push(99999) })
rejects(a => { a.fixtureRows[0].attrs[0].key = 'unknown' })
rejects(a => { a.fixtureRows[0].attrs[0].key = '__proto__' })
rejects(a => { a.fixtureRows[0].attrs[0].value = '7.0%' })
rejects(a => { a.fixtureRows[0].main.value = NaN })
rejects(a => { a.fixtureRows.pop() })
rejects(a => { a.game = 'sr' })
rejects(a => { a.artis.forEach = () => { throw Error('broken') } })
assert.notEqual(adaptMiaoAvatar(null, sourceInfo).status, 'raw-complete')

// 独立复核报告的四个假阳性：修复后必须拒绝，且不再依赖"恰好走通"的巧合
rejects(a => { a.fixtureRows[0].mainId = null; a.fixtureRows[0].main.id = null })
rejects(a => { a.fixtureRows[4].attrIds = []; a.fixtureRows[4].attrs = [] })
rejects(a => { a.fixtureRows[0].main.key = 'cdmg'; a.fixtureRows[0].main.value = 62.2 })
rejects(a => { a.char.id = 99999 })
// 部位与主词条类型必须匹配：固定值/百分比混用、串位一律拒绝
rejects(a => { a.fixtureRows[0].main.key = 'hp' })
rejects(a => { a.fixtureRows[2].main.key = 'hpPlus' })
rejects(a => { a.fixtureRows[3].main.key = 'cpct' })
rejects(a => { a.fixtureRows[4].main.key = 'phy' })
// 副词条条数：不能为空；五星满级恒为4条
rejects(a => { a.fixtureRows[4].attrs = [a.fixtureRows[4].attrs[0]]; a.fixtureRows[4].attrIds = [17, 17, 17] })
rejects(a => { a.fixtureRows[4].attrs = a.fixtureRows[4].attrs.slice(0, 3); a.fixtureRows[4].attrIds = [17, 17, 17, 18, 18, 19, 19] })

// 只替换模型/账号I/O边界，真实readTeamBuilds编排读取同一个Player，禁止刷新/伤害结算。
const file = path.join(libDir, 'model/TeamBuildAdapter.js')
let source = fs.readFileSync(file, 'utf8')
source = source.replace(/import \{ loadMiaoModels, resolveUid \} from ['"][^'"]+['"];?/, 'const {loadMiaoModels, resolveUid} = globalThis.__metaP0;')
source = source.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (_, before, rel, after) => before + pathToFileURL(path.resolve(path.dirname(file), rel)).href + after)
let playerCalls = 0, getCalls = 0
const avatars = Array.from({ length: 4 }, (_, i) => miaoAvatarFixture(i))
const player = { getAvatar(id, create) { getCalls++; assert.equal(create, false); return avatars.find(a => a.id === id) }, refresh() { throw Error('禁止联网') } }
const models = {
  Player: { create(uid, game) { playerCalls++; assert.equal(uid, '123456789'); assert.equal(game, 'gs'); return player } },
  Character: { get(name) { const a = avatars.find(a => a.name === name); return a?.char } }
}
globalThis.__metaP0 = { loadMiaoModels: async () => models, resolveUid: async () => ({ uid: '123456789' }) }
try {
  const { readTeamBuilds } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
  const names = avatars.map(a => a.name)
  const r = await readTeamBuilds({}, names)
  assert.equal(r.status, 'raw-complete', JSON.stringify(r))
  assert.equal(r.members.length, 4)
  assert.equal(playerCalls, 1)
  assert.equal(getCalls, 4)
  assert.equal(r.simulationReady, false)
  assert.equal(player.e, undefined, '不改Player事件上下文')
  const duplicate = await readTeamBuilds({}, [names[0], names[0], names[2], names[3]])
  assert.equal(duplicate.status, 'invalid')
  const missing = await readTeamBuilds({}, [names[0], '不存在', names[2], names[3]])
  assert.equal(missing.status, 'incomplete')
  assert.equal((await readTeamBuilds({}, names.slice(0, 3))).status, 'incomplete')
  models.Player.create = () => { throw Error('cache failure') }
  assert.equal((await readTeamBuilds({}, names)).status, 'incomplete')
} finally { delete globalThis.__metaP0 }
console.log('team-build-adapter: 四角色公开字段形状、严格缺项、单位及只读四人编排通过（无实测账号）')
