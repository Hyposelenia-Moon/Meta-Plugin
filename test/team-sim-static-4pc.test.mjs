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
  ok('已建模的绝缘/华馆不再报未建模，其余 4 件套仍未建模（以行者之心 400003 为例）',
    !String(xiangling.data.effects['artifact-set:400184:4pc']?.unmodeled ?? '').includes('未建模') &&
    !String(xiangling.data.effects['artifact-set:400189:4pc']?.unmodeled ?? '').includes('未建模') &&
    /未建模/.test(String(xiangling.data.effects['artifact-set:400003:4pc']?.unmodeled)))
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

if (xiangling.ok) {
  const brave = xiangling.data.effects['artifact-set:400008:4pc']
  ok('勇士之心：对高生命敌人伤害 +30% 进面板（木桩恒成立）',
    brave.modifiers.some(m => m.key === 'dmg' && m.value === 0.3))
  const flower = xiangling.data.effects['artifact-set:400251:4pc']
  ok('花海甘露：战技与爆发各 +10% 进面板，受伤部分写未建模',
    flower.modifiers.some(m => m.key === 'skillDmg' && m.value === 0.1) &&
    flower.modifiers.some(m => m.key === 'burstDmg' && m.value === 0.1) &&
    /受击模型/.test(String(flower.unmodeled)))
  const cinnabar = xiangling.data.effects['artifact-set:400199:4pc']
  ok('辰砂往生录：爆发触发 +8% 攻击写进运行时效果，生命值降低部分写未建模',
    cinnabar.runtimeRequired === true &&
    xiangling.data.runtimeEffects['artifact-set:400199:4pc']?.trigger === 'cast-burst' &&
    xiangling.data.runtimeEffects['artifact-set:400199:4pc']?.stats?.atkPct === 0.08 &&
    /生命值变化/.test(String(cinnabar.unmodeled)))
  const notes = ['400038', '400124', '400311'].map(id => xiangling.data.effects[`artifact-set:${id}:4pc`])
  ok('击杀类与脱战类套装按「不影响输出」记录说明',
    notes.every(e => e !== undefined && e.modifiers.length === 0 && /不影响输出|不触发处理/.test(String(e.note))))
}

report()
