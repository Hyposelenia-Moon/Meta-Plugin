import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { normalizeGuide, listGuidePresets, selectGuidePreset } from './lib/guide-presets.mjs'
import { migrateGuide } from './migrate-guide-presets.mjs'
import { buildCharacter } from './editor.mjs'
import { characterLines } from './build-docx.mjs'
import { renderCharacter } from './build-doc.mjs'
import { characterSections } from './build-html.mjs'
import { parseBlock } from './parse-docx.mjs'
const v2 = () => ({ weapons: [], artifacts: [], talents: [], panels: [], constellations: [], teams: [] })
let checks = 0
const check = (fn) => { fn(); checks++ }
const old = { schema: 2, name: '测试', game: 'gi', source: { guide: '测试来源' }, meta: { 建议等级: '90级' }, v2: v2() }
const doc = normalizeGuide(old)
check(() => assert.equal(doc.presets.length, 1))
check(() => assert.equal(doc.presets[0].id, 'default'))
doc.presets.push({ ...structuredClone(doc.presets[0]), id: 'support', name: '辅助', role: 'support', weights: { artifact: 0, panel: 50, weapon: 25, talent: 25 }, match: { names: ['西风纯辅'], patterns: ['纯辅$'] } })
doc.presets[0].v2.weapons = [{ label: null, tier: 1, sep: ' > ', items: [{ name: '西风剑', ref: 'weapon:西风剑' }] }]
doc.presets[1].v2.panels = [{ k: '暴击率', v: '70%' }]
doc.presets[1].freeModules = ['artifacts']
check(() => assert.equal(doc.presets[1].v2.weapons.length, 0))
check(() => assert.equal(selectGuidePreset(doc, 'support').v2.weapons.length, 0))
check(() => assert.throws(() => selectGuidePreset(doc, 'missing')))
check(() => assert.throws(() => normalizeGuide({ ...doc, presets: [] })))
check(() => assert.throws(() => normalizeGuide({ ...doc, presets: [doc.presets[0], doc.presets[0]] })))
const saved = buildCharacter(doc, old.name, old)
check(() => assert.equal(saved.schema, 3))
check(() => assert.equal(selectGuidePreset(saved, 'support').name, saved.name))
check(() => assert.equal(selectGuidePreset(saved, 'support').presetId, 'support'))
check(() => assert.equal(selectGuidePreset(saved, 'support').presetName, '辅助'))
// 保存按稳定 id 合并：重排后不得借用原下标的另一份内容。
const reordered = buildCharacter({ ...saved, presets: [...saved.presets].reverse().map(p => ({ ...p, v2: {} })) }, saved.name, saved)
check(() => assert.equal(reordered.presets[0].v2.weapons.length, 0))
check(() => assert.equal(reordered.presets[0].v2.panels[0].v, '70%'))
check(() => assert.equal(reordered.presets[1].v2.weapons[0].items[0].name, '西风剑'))
const configured = patch => ({ ...doc, presets: [{ ...doc.presets[0], ...patch }] })
for (const role of ['dps', 'support']) {
  check(() => assert.doesNotThrow(() => buildCharacter(configured({ role, weights: { artifact: 0 } }), old.name)))
  check(() => assert.doesNotThrow(() => buildCharacter(configured({ role, weights: {} }), old.name)))
  check(() => assert.throws(() => buildCharacter(configured({ role, weights: { artifact: 0, panel: 0, weapon: 0, talent: 0 } }), old.name), /权重/))
}
for (const value of [-1, Infinity, '1']) check(() => assert.throws(() => buildCharacter(configured({ weights: { panel: value } }), old.name), /权重/))
for (const pattern of ['[', '\\a', 'a'.repeat(257)]) check(() => assert.throws(() => buildCharacter(configured({ match: { patterns: [pattern] } }), old.name), /正则/))
check(() => assert.doesNotThrow(() => buildCharacter(configured({ match: { patterns: ['a'.repeat(256), '\\p{Letter}+'] } }), old.name)))
check(() => assert.throws(() => buildCharacter({ ...doc, presets: [doc.presets[0], { ...doc.presets[1], name: doc.presets[0].name }] }, old.name), /名称/))
check(() => assert.deepEqual(saved.presets[1].weights, doc.presets[1].weights))
check(() => assert.deepEqual(saved.presets[1].match, doc.presets[1].match))
check(() => assert.throws(() => buildCharacter(old, old.name, saved)))
for (const lines of [characterLines(saved), renderCharacter(saved)]) {
  const parsed = parseBlock(lines.filter(Boolean), {})
  check(() => assert.deepEqual(parsed.presets, saved.presets))
  check(() => assert.deepEqual(parsed.stray, []))
}
check(() => assert.equal(characterSections(selectGuidePreset(saved, 'support')).length, 6))
const fixture = JSON.parse(fs.readFileSync('data/gi/芙宁娜.json', 'utf8'))
const migrated = migrateGuide(fixture).guide
check(() => assert.equal(migrated.presets.length, 2))
check(() => assert.equal(migrated.presets.find(p => p.role === 'support').v2.weapons[0].items[0].name, '西风剑'))
check(() => assert.equal(migrated.presets.find(p => p.role === 'dps').v2.artifacts.filter(r => r.kind === 'main')[0].stats.时之沙[0], '生命值'))
// Browser state tests use a no-op DOM; exercise actual draft switches and serialization.
const noop = () => {}
const stub = () => new Proxy(noop, { get: (_, k) => k === 'length' ? 0 : ['value','textContent','innerHTML'].includes(k) ? '' : k === 'querySelectorAll' ? () => [] : k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false } : stub(), set: () => true, apply: () => stub() })
const ctx = { console, document: stub(), navigator: stub(), location: { search: '', hash: '' }, localStorage: stub(), fetch: async () => ({ ok: true, json: async () => ({}) }), setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop, addEventListener: noop, prompt: () => '改名', alert: noop, confirm: () => false, URL, Blob, Event, JSON, Math, Date, String, Number, Array, Object, Boolean, RegExp, Error, Promise, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN }
ctx.window = ctx; vm.createContext(ctx)
vm.runInContext(fs.readFileSync('resources/editor/app.js', 'utf8'), ctx)
ctx.state.current = saved.name
ctx.state.model = ctx.normalizeData(saved)
ctx.state.model.meta.定位 = '草稿输出'
ctx.switchPreset(1)
ctx.state.model.meta.定位 = '草稿辅助'
ctx.switchPreset(0)
check(() => assert.equal(ctx.state.model.meta.定位, '草稿输出'))
let payload = JSON.parse(JSON.stringify(ctx.buildBody()))
check(() => assert.equal(payload.presets[1].meta.定位, '草稿辅助'))
ctx.handleAction('preset-copy', '', -1, null)
check(() => assert.equal(ctx.state.model._presets.length, 3))
ctx.state.model.meta.定位 = '副本独立'
ctx.switchPreset(0)
check(() => assert.equal(ctx.state.model.meta.定位, '草稿输出'))
ctx.handleAction('preset-delete', '', -1, null)
ctx.handleAction('preset-delete', '', -1, null)
check(() => assert.equal(ctx.handleAction('preset-delete', '', -1, null), false))
check(() => assert.equal(ctx.state.model._presets.length, 1))
console.log(`多预设回归：${checks}/${checks} 全通过`)
