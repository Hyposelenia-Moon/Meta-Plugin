/** 独立攻略预设与 miao 规则匹配契约。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mod } from './_helper.mjs'
const { listGuidePresets, selectGuidePreset, matchGuidePreset, normalizeRuleRole, presetWeights } = await import(mod('modules/guidePresets.js'))
const guide = { schema: 3, name: '芙宁娜', presets: [
  { id: 'damage', name: '输出', role: 'dps', meta: { 定位: '输出' }, v2: { weapons: [{ items: [{ name: '静水流涌之辉' }] }] } },
  { id: 'utility', name: '辅助', role: 'support', match: { patterns: ['西风.*辅'] }, meta: { 定位: '增伤辅助' }, v2: { weapons: [{ items: [{ name: '西风剑' }] }] } }
] }
assert.equal(normalizeRuleRole('芙宁娜-西风纯辅'), 'support')
assert.equal(normalizeRuleRole('生命输出'), 'dps')
assert.equal(matchGuidePreset(guide, { ruleTitle: '芙宁娜-西风纯辅', charWeight: { cpct: 100, cdmg: 100 } }).preset.id, 'utility')
assert.equal(matchGuidePreset(guide, { ruleTitle: '治疗辅助' }).preset.id, 'utility')
assert.equal(matchGuidePreset(guide, { ruleTitle: '芙宁娜-输出' }).preset.id, 'damage')
assert.equal(matchGuidePreset(guide, { requested: '输出', ruleTitle: '辅助' }).preset.id, 'damage')
assert.equal(matchGuidePreset(guide, { requested: '不存在' }).preset, null)
assert.equal(matchGuidePreset(guide, {}).preset, null)
const duplicateRole = { ...guide, presets: [...guide.presets, { ...guide.presets[1], id: 'heal', name: '治疗', match: {} }] }
assert.equal(matchGuidePreset(duplicateRole, { ruleTitle: '辅助' }).preset, null)
const invalidPattern = { ...guide, presets: guide.presets.map(p => ({ ...p, match: { patterns: ['['] } })) }
assert.equal(matchGuidePreset(invalidPattern, { ruleTitle: '通用' }).preset, null)
assert.deepEqual(presetWeights(guide.presets[0]), { artifact: 30, panel: 30, weapon: 20, talent: 20 })
assert.deepEqual(presetWeights(guide.presets[1]), { artifact: 0, panel: 50, weapon: 25, talent: 25 })
assert.deepEqual(presetWeights({ role: 'support', weights: { panel: 60, weapon: 0 } }), { artifact: 0, panel: 60, weapon: 0, talent: 25 })
const selected = selectGuidePreset(guide, 'utility')
assert.equal(selected.v2.weapons[0].items[0].name, '西风剑')
assert.equal(selected.presets, undefined)
selected.v2.weapons[0].items[0].name = '修改投影'
assert.equal(guide.presets[1].v2.weapons[0].items[0].name, '西风剑')
assert.equal(selectGuidePreset(guide, 'damage').v2.weapons[0].items[0].name, '静水流涌之辉')
assert.throws(() => selectGuidePreset(guide, 'invalid'))
const legacy = { name: '钟离', meta: { 定位: '护盾辅助' }, v2: { weapons: [] } }
assert.equal(listGuidePresets(legacy).length, 1)
assert.equal(listGuidePresets(legacy)[0].role, 'support')
assert.equal(matchGuidePreset(legacy).preset.id, 'default')
// 2026-10-30 用户定：单预设也能设为辅助，并可自选是否把圣遗物纳入评分。
const singleSupport = {
  schema: 3, name: '单预设辅助',
  presets: [{
    id: 'only', name: '默认', role: 'support',
    weights: { artifact: 20, panel: 40, weapon: 20, talent: 20 },
    match: { names: ['辅助'] }, meta: {}, v2: {}
  }]
}
assert.equal(listGuidePresets(singleSupport)[0].role, 'support')
assert.deepEqual(presetWeights(listGuidePresets(singleSupport)[0]), { artifact: 20, panel: 40, weapon: 20, talent: 20 })
assert.equal(selectGuidePreset(singleSupport, 'only').presetRole, 'support')
assert.equal(matchGuidePreset(singleSupport, { requested: '默认' }).preset.id, 'only')
// 全库审计：独立预设内不得再出现与 preset.role 同义的武器/圣遗物/面板方向标签。
{
  const roleRe = {
    dps: /^(?:输出|输出向|主[cC]|主[cC]向|站场|站场输出|速切)$/,
    support: /^(?:辅助|辅助向|纯辅|治疗|奶妈|盾辅|护盾|增伤|充能辅)$/
  }
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'gi')
  const bad = []
  let rows = 0
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    for (const preset of doc.presets || []) {
      const re = roleRe[preset.role === 'support' ? 'support' : 'dps']
      for (const key of ['weapons', 'artifacts', 'panels']) {
        for (const row of preset.v2?.[key] || []) {
          rows++
          const label = String(row.label ?? '').trim()
          if (label && re.test(label)) bad.push(`${doc.name}/${preset.name}/${key}: ${label}`)
        }
      }
    }
  }
  assert.deepEqual(bad, [], `独立预设仍在重复方向标签：\n${bad.join('\n')}`)
  assert.ok(rows > 500, `扫描行数异常：${rows}`)
}
console.log('攻略预设：单预设辅助/自选圣遗物及全库方向标签等断言通过')
