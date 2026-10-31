import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mod } from './_helper.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(import.meta.url)('typescript')
async function load() {
  if (process.env.META_TEAM_SIM_SOURCE_TEST !== '1') return import(mod('modules/teamSimulation/types.js'))
  const source = fs.readFileSync(path.join(root, 'src/modules/teamSimulation/types.ts'), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}
const { legacyEstimate, SCHEMA_VERSION } = await load()

assert.equal(SCHEMA_VERSION, 1)

// 旧关键词轴结果只能标记为 legacy-estimate：既不能冒充 raw-complete，也不能带 simulationReady:true。
const rows = [{ title: '队伍总伤害', value: 123456 }, { title: '每秒伤害', value: 9876.5 }]
const legacy = legacyEstimate({ rows, notes: ['关键词轴估算，未建模反应与循环'], gameVersion: '7.1', source: 'legacy-keyword-axes' })
assert.equal(legacy.status, 'legacy-estimate')
assert.equal(legacy.mode, 'legacy')
assert.equal(legacy.simulationReady, false)
assert.equal(legacy.gameVersion, '7.1')
assert.equal(legacy.source, 'legacy-keyword-axes')
assert.deepEqual(legacy.rows, rows)
assert.deepEqual(legacy.notes, ['关键词轴估算，未建模反应与循环'])

// 缺省：版本未知必须是 null，备注默认为空数组，而不是省略字段。
const minimal = legacyEstimate({ rows: [{ title: '单人伤害', value: 1 }], source: 'legacy-keyword-axes' })
assert.equal(minimal.gameVersion, null)
assert.deepEqual(minimal.notes, [])

// 入参被外部修改后不能反过来改变已产出的结果，也不能共用同一个数组引用。
const mutableRows = [{ title: '可变行', value: 1 }]
const mutableNotes = ['原备注']
const frozen = legacyEstimate({ rows: mutableRows, notes: mutableNotes, source: 'legacy-keyword-axes' })
mutableRows[0].value = 2
mutableNotes.push('后续追加')
assert.equal(frozen.rows[0].value, 1)
assert.deepEqual(frozen.notes, ['原备注'])

console.log('team-sim-legacy: passed; legacy estimate is explicitly tagged and never claims simulationReady')
