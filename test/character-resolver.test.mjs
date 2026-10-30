/** 角色别名与攻略预设入口契约：离线、可注入候选，不依赖 Atlas 实装。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { libDir, pluginRoot } from './_helper.mjs'

// 临时源码编译验收可覆盖目录，正式套件默认验证 lib。
const root = process.env.META_TEST_LIB_DIR || libDir
const load = file => import(pathToFileURL(path.join(root, file)).href)
const { matchCharacter } = await load('modules/characterResolver.js')
const { parseSuffixQuery } = await load('modules/branches.js')
const { isCodexCommand } = await load('components/constants.js')
const { AtlasRes } = await load('model/AtlasRes.js')
const { CodexStore } = await load('model/CodexStore.js')
const { listGuidePresets, selectGuidePreset } = await load('modules/guidePresets.js')
const sources = (atlas = async () => [], miaoAliases = () => ({})) => ({
  names: ['芙宁娜', '胡桃', '神里绫华', '神里绫人'], atlas, miaoAliases
})
assert.deepEqual(await matchCharacter(' 芙 宁 娜 ', sources(async () => ['胡桃'])), { name: '芙宁娜', candidates: ['芙宁娜'] })
assert.equal((await matchCharacter('芙芙', sources(async () => ['水神', '芙宁娜']))).name, '芙宁娜')
assert.equal((await matchCharacter('芙', sources(async () => ['胡桃']))).name, '胡桃', '精确别名先于唯一包含')
assert.equal((await matchCharacter('芙', sources(async () => [], () => ({ 胡桃: '芙,桃子' })))).name, '胡桃')
assert.deepEqual(await matchCharacter('神里', sources()), { name: null, candidates: ['神里绫华', '神里绫人'] })
assert.deepEqual(await matchCharacter('别名', sources(async () => ['神里绫人', '神里绫华'], () => ({ 胡桃: '别名' }))),
  { name: null, candidates: ['神里绫华', '神里绫人'] }, '多候选不信primary也不回落猜选')
assert.equal((await matchCharacter('芙宁', sources(async () => { throw Error('可选插件失败') }))).name, '芙宁娜')
for (const text of ['.*', '[', '(', '\\', '^胡桃$']) assert.equal((await matchCharacter(text, sources())).name, null)
assert.deepEqual(await new AtlasRes(path.join(pluginRoot, 'test/.test-tmp/absent-atlas')).resolveAlias('芙芙'), [])
const fixtureBase = path.join(pluginRoot, 'test/.test-tmp')
fs.mkdirSync(fixtureBase, { recursive: true })
const atlasFixture = fs.mkdtempSync(path.join(fixtureBase, 'atlas-alias-api-'))
fs.mkdirSync(path.join(atlasFixture, 'modules'))
fs.writeFileSync(path.join(atlasFixture, 'modules/aliasApi.js'), `export function resolveAlias(name, game) {
  if (game !== 'gi') throw Error('游戏必须为gi');
  if (name === '异常') throw Error('失败回落');
  return { key: name, candidates: ['水神', '芙宁娜', '芙宁娜'], primary: '水神' };
}`)
const fixtureAtlas = new AtlasRes(atlasFixture)
assert.deepEqual(await fixtureAtlas.resolveAlias('芙芙'), ['水神', '芙宁娜'])
assert.deepEqual(await fixtureAtlas.resolveAlias('异常'), [])
assert.equal((await matchCharacter('芙芙', sources(name => fixtureAtlas.resolveAlias(name)))).name, '芙宁娜')
for (const text of ['#芙宁娜攻略 辅助', '#芙芙攻略 辅助', '#芙宁娜攻略 不存在', '#芙宁娜指南 辅助']) {
  assert.ok(isCodexCommand(text), text)
  assert.ok(parseSuffixQuery(text), text)
}
assert.deepEqual(parseSuffixQuery('#芙宁娜攻略 辅助 面板图3'), { character: '芙宁娜', setIndex: null, preset: '辅助', panelIndex: 3 })
// 2026-10-30：复制预设的默认名称含空格，后缀规则必须允许名称内部空格
assert.deepEqual(parseSuffixQuery('#芙宁娜攻略 辅助 副本'), { character: '芙宁娜', setIndex: null, preset: '辅助 副本', panelIndex: null })
assert.deepEqual(parseSuffixQuery('#芙宁娜攻略 辅助 副本 面板图3'), { character: '芙宁娜', setIndex: null, preset: '辅助 副本', panelIndex: 3 })
assert.ok(isCodexCommand('#芙宁娜攻略 辅助 副本'))
assert.deepEqual(parseSuffixQuery('#胡桃攻略2 面板图13'), { character: '胡桃', setIndex: 2, panelIndex: 13 })
for (const text of ['芙宁娜攻略 辅助', '#攻略 芙宁娜', '#攻略 武器 护摩之杖', '#设置默认攻略3', '#胡桃攻略 面板图0']) {
  assert.equal(isCodexCommand(text), false, text)
  assert.equal(parseSuffixQuery(text), null, text)
}
const guide = { schema: 3, name: '芙宁娜', presets: [
  { id: 'dps', name: '输出', role: 'dps', meta: { 定位: '输出' }, v2: {} },
  { id: 'support', name: '辅助', role: 'support', meta: { 定位: '辅助' }, v2: {} }
] }
assert.equal(listGuidePresets(guide).length, 2)
assert.equal(selectGuidePreset(guide, '辅助').meta.定位, '辅助')
const store = new CodexStore()
assert.equal(store.isFilled(guide), true)
assert.equal(store.isFilled({ ...guide, presets: [{ id: 'empty', meta: {}, v2: {} }] }), false)
assert.equal(store.isFilled({ schema: 2, meta: { 定位: '主C' }, v2: {} }), true)
// 加载真实 handler，仅将框架基类换为最小假对象；不启动 bot、不渲染、不写数据。
const appFile = path.join(root, 'apps/codex.js')
let appSource = fs.readFileSync(appFile, 'utf8')
appSource = appSource.replace(/import plugin from ['"][^'"]+['"];?/, 'const plugin = class { constructor () {} };')
appSource = appSource.replace(/(from\s+['"])(\.[^'"]+)(['"])/g,
  (_all, before, rel, after) => before + pathToFileURL(path.resolve(path.dirname(appFile), rel)).href + after)
const { MetaCodex } = await import('data:text/javascript;base64,' + Buffer.from(appSource).toString('base64'))
const { codexStore } = await load('model/CodexStore.js')
const { atlasRes } = await load('model/AtlasRes.js')
const app = new MetaCodex()
const original = { listAll: codexStore.listAll, getGuide: codexStore.getGuide, getSignature: codexStore.getSignature,
  getWeaponTags: codexStore.getWeaponTags, resolveAlias: atlasRes.resolveAlias }
let currentGuide = guide
let page = null
codexStore.listAll = () => ['芙宁娜']
codexStore.getGuide = () => currentGuide
codexStore.getSignature = () => null
codexStore.getWeaponTags = () => ({})
atlasRes.resolveAlias = async () => ['芙宁娜']
app.replyPage = async (_e, view, notes) => { page = { view, notes }; return true }
const query = async msg => {
  page = null
  const replies = []
  await app.handleSuffix({ msg, reply: async text => { replies.push(String(text)); return true } })
  return { text: replies.join('\n'), page }
}
try {
  let reply = await query('#芙宁娜攻略')
  assert.equal(reply.page, null)
  assert.match(reply.text, /多个攻略预设/)
  assert.match(reply.text, /#芙宁娜攻略 辅助/)
  reply = await query('#芙芙攻略 辅助')
  assert.ok(reply.page)
  assert.ok(reply.page.notes.includes('预设：辅助'))
  reply = await query('#芙宁娜攻略 不存在')
  assert.equal(reply.page, null)
  assert.match(reply.text, /可选预设：输出（dps）、辅助（support）/)
  currentGuide = { schema: 2, name: '芙宁娜', meta: { 定位: '辅助' }, v2: {} }
  reply = await query('#芙宁娜攻略')
  assert.ok(reply.page, '旧schema2单份直接查看')
  currentGuide = { ...guide, presets: [guide.presets[1]] }
  reply = await query('#芙宁娜攻略')
  assert.ok(reply.page, 'schema3单预设直接查看')
  // 2026-10-30：编辑器复制出的「辅助 副本」必须能按显示名选中（不能用 id 才生效）
  currentGuide = { ...guide, presets: [...guide.presets, { id: 'support-copy', name: '辅助 副本', role: 'support', meta: { 定位: '辅助副本' }, v2: {} }] }
  reply = await query('#芙宁娜攻略 辅助 副本')
  assert.ok(reply.page, '带空格的预设名应可直接指定')
  assert.ok(reply.page.view.sections.length > 0)
  assert.ok(reply.page.notes.includes('预设：辅助 副本'), reply.page.notes.join('|'))
  reply = await query('#芙宁娜攻略 support-copy')
  assert.ok(reply.page, 'id 指定仍可用')
} finally {
  codexStore.listAll = original.listAll
  codexStore.getGuide = original.getGuide
  codexStore.getSignature = original.getSignature
  codexStore.getWeaponTags = original.getWeaponTags
  atlasRes.resolveAlias = original.resolveAlias
}
console.log('角色解析与攻略预设契约通过')
