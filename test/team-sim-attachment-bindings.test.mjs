import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, 'data', 'team-sim')
const packDir = path.join(dataDir, 'packs')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const bindings = readJson(path.join(dataDir, 'attachment-bindings.json'))

test('附着绑定：文件里每条动作都能在动作包里找到，且整段命中都带同一份 attachment', () => {
  const ids = Object.keys(bindings.bindings)
  assert.ok(ids.length > 0, '绑定表不该是空的')
  for (const [actionId, entry] of Object.entries(bindings.bindings)) {
    const key = actionId.split('.')[0]
    const pack = readJson(path.join(packDir, `${key}.json`))
    const action = pack.actions[actionId]
    assert.ok(action, `${actionId} 不在 ${key} 的动作包里`)
    for (const hit of action.hits) {
      assert.deepEqual(hit.attachment, { ...(entry.gauge !== undefined ? { gauge: entry.gauge } : {}), icd: entry.icd }, `${actionId} 的命中没有附带绑定里的 attachment`)
    }
  }
})

test('附着绑定：影响面只限绑定表里的动作，其余命中保持「没有声明」', () => {
  const bound = new Set(Object.keys(bindings.bindings))
  let attached = 0
  let unexpected = []
  for (const file of fs.readdirSync(packDir).filter(name => name.endsWith('.json'))) {
    const pack = readJson(path.join(packDir, file))
    for (const action of Object.values(pack.actions)) {
      for (const hit of action.hits) {
        if (!hit.attachment) continue
        attached++
        if (!bound.has(action.id)) unexpected.push(action.id)
      }
    }
  }
  const expected = Object.keys(bindings.bindings).reduce((sum, actionId) => {
    const key = actionId.split('.')[0]
    const pack = readJson(path.join(packDir, `${key}.json`))
    return sum + pack.actions[actionId].hits.length
  }, 0)
  assert.equal(attached, expected, '带附着的命中数必须等于绑定动作的命中数之和')
  assert.deepEqual(unexpected, [], '绑定表之外的动作不该突然带附着')
})

test('附着绑定：绑定表纪律——只收有倍率参数名、附着量可换算的候选', () => {
  for (const [actionId, entry] of Object.entries(bindings.bindings)) {
    assert.ok(Number.isFinite(entry.gauge), `${actionId} 的附着量必须是数字`)
    assert.ok(entry.icd === 'independent' || entry.icd === 'standard', `${actionId} 的 ICD 规则必须是 independent/standard`)
    assert.ok(typeof entry.evidence === 'string' && entry.evidence.includes('未经人工核对'), `${actionId} 必须标明证据来源与「未经人工核对」`)
  }
})
