/**
 * 永久数据运行时生成（2026-11-02 用户定：按玩家实际武器现算）。
 *
 * 断言它和离线脚本口径一致，而不是「能生成就行」：
 *   - 香菱 + 西风长枪的白值、突破加成、2 件套覆盖；
 *   - 钟离 + 黑缨枪按现算出的 base 必须与入库文件逐位相同；
 *   - 缓存、错误路径。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir } from './_helper.mjs'

const { ok, report } = createChecks('永久数据 · 运行时生成')
const mod = async (rel) => import(pathToFileURL(path.join(libDir, rel)).href)
const { buildRuntimePermanent } = await mod('model/PermanentSource.js')
const fs = await import('node:fs')

const xiangling = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: '13407', refinement: 1 })
ok('香菱 + 西风长枪能现算', xiangling.ok === true)
if (xiangling.ok) {
  const data = xiangling.data
  ok('白值来自 miao 90 级', data.character.base.hp === 10874.91 && data.character.base.atk === 225.14 && data.character.base.def === 668.87)
  ok('角色/武器 id 正确', data.character.id === '10000023' && data.weapon.id === '13407')
  ok('突破加成写进 a6（精通 96）', data.effects['character:10000023:a6'].modifiers.some(m => m.key === 'mastery' && m.value === 96))
  ok('武器条目存在', data.effects['weapon:13407:r1'] !== undefined)
  ok('2 件套覆盖全部套装', Object.keys(data.effects).filter(id => id.endsWith(':2pc')).length >= 60)
  ok('命座 1–6 都有条目', [1, 2, 3, 4, 5, 6].every(n => data.effects[`constellation:10000023:${n}`] !== undefined))
  const again = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: '13407', refinement: 1 })
  ok('同一组合命中缓存（同一对象）', again.ok && again.data === data)
}

// 与入库的钟离文件对拍：现算结果的白值必须完全一致，效果 id 集合也必须一致。
{
  const file = path.join(libDir, '..', 'data', 'team-sim', 'permanent', '10000030-13303-r1.json')
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  const runtime = buildRuntimePermanent({ characterId: '10000030', name: '钟离', weaponId: '13303', refinement: 1 })
  ok('钟离 + 黑缨枪能现算', runtime.ok === true)
  if (runtime.ok) {
    ok('白值与入库文件逐位相同',
      runtime.data.character.base.hp === saved.character.base.hp &&
      runtime.data.character.base.atk === saved.character.base.atk &&
      runtime.data.character.base.def === saved.character.base.def &&
      runtime.data.weapon.baseAtk === saved.weapon.baseAtk)
    ok('效果 id 集合与入库文件一致',
      JSON.stringify(Object.keys(runtime.data.effects).sort()) === JSON.stringify(Object.keys(saved.effects).sort()))
  }
}

{
  const bad = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: '99999', refinement: 1 })
  ok('未知武器返回可读错误', bad.ok === false && /读不到武器/.test(bad.error))
  const wrong = buildRuntimePermanent({ characterId: '10000030', name: '香菱', weaponId: '13407', refinement: 1 })
  ok('charId 与角色名不符时报错', wrong.ok === false && /charId/.test(wrong.error))
  const refine = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: '13407', refinement: 9 })
  ok('精炼越界报错', refine.ok === false && /精炼/.test(refine.error))
}

report()
