/**
 * 4 件套静态效果（2026-11-02 切片 1）：角斗士 / 乐团。
 *
 * 断言三件事：
 *   1. 武器类型满足时效果真的进了 PermanentData（普攻/重击伤害加成键）；
 *   2. 武器类型不满足时不加面板，但在 unmodeled 里写明原因（报告才能如实披露）；
 *   3. 其余 4 件套仍保持「未建模」。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir } from './_helper.mjs'

const { ok, report } = createChecks('永久数据 · 4 件套静态效果')
const { buildRuntimePermanent } = await import(pathToFileURL(path.join(libDir, 'model/PermanentSource.js')).href)

const xiangling = buildRuntimePermanent({ characterId: '10000023', name: '香菱', weaponId: '13407', refinement: 1 })
ok('香菱（长柄）+ 西风长枪能现算', xiangling.ok === true)
if (xiangling.ok) {
  const glad = xiangling.data.effects['artifact-set:400089:4pc']
  ok('角斗士 4 件套命中长柄：普攻伤害 +35% 进面板',
    glad.status === 'verified-static' && glad.modifiers.some(m => m.key === 'normalDmg' && m.value === 0.35) && !glad.unmodeled)
  const troupe = xiangling.data.effects['artifact-set:400099:4pc']
  ok('乐团 4 件套对长柄不生效：不加面板且写未建模原因',
    troupe.modifiers.length === 0 && /不满足触发条件/.test(String(troupe.unmodeled)))
  ok('其它 4 件套仍是未建模（以绝缘为例）',
    /未建模/.test(String(xiangling.data.effects['artifact-set:400184:4pc']?.unmodeled)))
}

const klee = buildRuntimePermanent({ characterId: '10000029', name: '可莉', weaponId: '14514', refinement: 1 })
ok('可莉（法器）+ 万世流涌大典能现算', klee.ok === true)
if (klee.ok) {
  const glad = klee.data.effects['artifact-set:400089:4pc']
  ok('角斗士 4 件套对法器不生效：不加面板且写未建模原因',
    glad.modifiers.length === 0 && /不满足触发条件/.test(String(glad.unmodeled)))
  const troupe = klee.data.effects['artifact-set:400099:4pc']
  ok('乐团 4 件套命中法器：重击伤害 +35% 进面板',
    troupe.modifiers.some(m => m.key === 'chargedDmg' && m.value === 0.35) && !troupe.unmodeled)
}

report()
