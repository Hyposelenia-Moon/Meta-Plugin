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
assert.deepEqual(groups.map(g => g.label), ['面板', '命座'])
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
for (const key of ['presetName', 'presetMatchReason', 'presetWeightText', 'mx.referenceGroups']) assert.ok(tpl.includes(key))
assert.ok(!tpl.includes('grid-template-columns: 132px'))
console.log('presentation-reference: 全部契约通过（分类/三列/方向/条件/去重/四维与辅助三维）')
