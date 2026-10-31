/** 05参考项与实际维度标题契约；不依赖bot、不修改编译产物。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const js = ts.transpileModule(fs.readFileSync(path.join(root, 'src/components/presentation.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const P = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const row = (group, target, id = `panel:${group}:recharge`) => ({ id, group, name: '元素充能效率', target, actual: '160%', verdict: 'info' })
const source = [row('输出向', '180%（二命）'), row('辅助向', '200%（二命）'), row('输出向', '180%（二命）'), row('输出向', '180%（满命）'), { id: 'cons:key', group: '命座', name: '关键命座', target: 'C2', actual: 'C0', verdict: 'info' }]
const references = P.buildEvidence(source).references
const groups = P.buildReferenceGroups(references)
assert.deepEqual(groups.map(g => g.label), ['面板', ''])
assert.equal(groups[1].rows[0].name, '关键命座', '命座不再单列分类，只保留「关键命座」行')
assert.equal(groups[1].rows[0].tone, 'warn')
assert.equal(groups[0].rows.length, 3, '只去除同方向同条件同目标的重复行')
assert.deepEqual(groups[0].rows[0].tags, ['输出向', '二命'])
assert.equal(groups[0].rows[0].target, '180%')
assert.equal(groups[0].rows[1].target, '200%', '同名不同方向不同目标不合并')
assert.deepEqual(groups[0].rows[2].tags, ['输出向', '满命'])
assert.equal(references[0].target, '180%（二命）', '保留原参考数据与稳定键，不改文本消费者')
for (const [keys, title] of [[['artifact','panel','weapon','talent'], '四维达成'], [['panel','weapon','talent'], '三维达成']]) {
  const dims = keys.map(key => ({ key, label: key, state: 'met', ratio: 1, weight: 1 / keys.length, detail: '' }))
  const mx = P.buildPresentation({ result: { assessable: true, dims, rows: source, suggestionRows: [] } })
  assert.equal(mx.dimensionsTitle, title)
  assert.deepEqual(mx.dims.map(d => d.key), keys)
}
const tpl = fs.readFileSync(path.join(root, 'resources/dps/grade.html'), 'utf8')
assert.ok(tpl.includes('{{mx.dimensionsTitle}}'))
// 04 无逐项证据时：维度 below 不能写成"均已满足"，模板必须使用 belowDimsText 守卫。
const below = P.buildPresentation({ result: { assessable: true, dims: [{ key: 'artifact', label: '圣遗物', state: 'below', ratio: .85, weight: 1, detail: '' }], rows: [], suggestionRows: [] } })
assert.deepEqual(below.belowDims, ['圣遗物'])
assert.match(below.belowDimsText, /未达标.*圣遗物/)
assert.equal(P.buildPresentation({ result: { assessable: true, dims: [{ key: 'weapon', label: '武器', state: 'met', ratio: 1, weight: 1, detail: '' }], rows: [], suggestionRows: [] } }).belowDimsText, '')
assert.ok(/mx\.belowDimsText[^}]*\}\}[\s\S]*均已满足/.test(tpl), '04 空态先判 belowDimsText')
for (const key of ['presetName', 'presetMatchReason', 'presetWeightText', 'mx.improvements', 'mx.consNote']) assert.ok(tpl.includes(key))
assert.ok(!tpl.includes('mx.references') && !tpl.includes('参考项'), '05 参考项整块移除')
assert.ok(!tpl.includes('grid-template-columns: 132px'))

// 04+06 合并：建议优先，证据当前→目标作为小字；未知数据进入待补区。
const merged = P.buildPresentation({ result: { assessable: false, dims: [{ key: 'weapon', label: '武器', state: 'unknown', ratio: null, weight: 1, detail: '未取到武器' }], rows: [
  { id: 'talent:Q', group: '天赋', name: 'Q', actual: '2', target: '10', verdict: 'warn', state: 'below', scored: true },
  { id: 'weapon:choice', group: '武器', name: '裁叶萃光', actual: '裁叶萃光', target: '雾切之回光', verdict: 'off', state: 'unknown', scored: true },
  { id: 'cons:key', group: '命座', name: '关键命座', actual: 'C2', target: '6', verdict: 'info' }
], suggestionRows: [{ id: 'talent', text: '天赋：Q 2→10', evidenceIds: ['talent:Q'], priority: 1, priorityBasis: 'cost-step' }] } })
assert.equal(merged.improvements.length, 1)
assert.deepEqual(merged.improvements[0].evidence[0], { group: '天赋', name: 'Q', actual: '2', target: '10', deltaText: '差 8' })
assert.equal(merged.improvements[0].note, '', '天赋正文已含 2→10，小字不再重复')
assert.equal(merged.improvements[0].evidence[0].eid, undefined, '合并版不再展示 E 编号')
// 面板正文已含当前→目标时，小字只补差值，不重复属性名/目标。
const panelNote = P.buildPresentation({ result: { assessable: true, dims: [], rows: [
  { id: 'panel:参考:cpct', group: '参考', name: '暴击率', actual: '72.0%', target: '80~90%', verdict: 'warn', state: 'below', scored: true }
], suggestionRows: [{ id: 'panel', text: '面板：暴击率 72.0%→80~90%', evidenceIds: ['panel:参考:cpct'], priority: 1, priorityBasis: 'cost-step' }] } })
assert.equal(panelNote.improvements[0].note, '差 8')
assert.ok(!panelNote.improvements[0].note.includes('暴击率') && !panelNote.improvements[0].note.includes('80'))
// 套装/词条/武器正文只有目标，小字保留当前值。
const setNote = P.buildPresentation({ result: { assessable: true, dims: [], rows: [
  { id: 'artifact:set', group: '综合', name: '套装', actual: '角斗士×5', target: '如雷的盛怒', verdict: 'warn', state: 'below', scored: true }
], suggestionRows: [{ id: 'artifact:set', text: '圣遗物：凑攻略推荐套装（如雷的盛怒）', evidenceIds: ['artifact:set'], priority: 1, priorityBasis: 'cost-step' }] } })
assert.equal(setNote.improvements[0].note, '当前：角斗士×5')
assert.equal(merged.pending.length, 1, '未绑定建议的数据缺失进入待补区')
assert.equal(merged.pending[0].name, '裁叶萃光')
assert.deepEqual(merged.consNote, { name: '关键命座', actual: 'C2', target: '6' })
assert.equal(merged.sectionIndex.suggestions, '03')
assert.equal(merged.sectionIndex.refDps, '04')

// 未达标命座并入新 03；达标命座不再提示。
const consBelow = P.buildPresentation({ result: { assessable: true, dims: [], rows: [
  { id: 'cons:key', group: '命座', name: '关键命座', actual: 'C1', target: '2 / 6', verdict: 'info' }
], suggestionRows: [] } })
assert.equal(consBelow.references.length, 1)
assert.deepEqual(consBelow.consNote, { name: '关键命座', actual: 'C1', target: '2 / 6' })
assert.equal(consBelow.sectionIndex.suggestions, '03')
const consMet = P.buildPresentation({ result: { assessable: true, dims: [], rows: [
  { id: 'cons:key', group: '命座', name: '关键命座', actual: 'C6', target: '2 / 6', verdict: 'info' }
], suggestionRows: [] } })
assert.equal(consMet.consNote, null, '命座已达标时不再提示')
console.log('presentation-reference: 全部契约通过（四维标题/01+02/04+06合并/05移除/命座并入）')
