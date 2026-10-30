/** 真实练度 handler 编排回归；仅替换外部取数/渲染边界，不启动 bot、不联网。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { libDir } from './_helper.mjs'
const load = rel => import(pathToFileURL(path.join(libDir, rel)).href)
const { codexStore } = await load('model/CodexStore.js')
const { atlasRes } = await load('model/AtlasRes.js')
const appFile = path.join(libDir, 'apps/grade.js')
let source = fs.readFileSync(appFile, 'utf8')
source = source.replace(/import plugin from ['"][^'"]+['"];?/, 'const plugin = class { constructor() {} };')
source = source.replace(/import \{ readProfile \} from ['"][^'"]+['"];?/, 'const readProfile = (...args) => globalThis.__metaGradeEntry.readProfile(...args);')
source = source.replace(/import \{ respond \} from ['"][^'"]+['"];?/, 'const respond = (...args) => globalThis.__metaGradeEntry.respond(...args);')
source = source.replace(/await import\(['"]\.\.\/modules\/charDpsQuery.js['"]\)/g, '(await Promise.reject(new Error("离线禁用远程查询")))')
source = source.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (_, a, rel, b) => a + pathToFileURL(path.resolve(path.dirname(appFile), rel)).href + b)
source = source.replace(/(import\(['"])(\.[^'"]+)(['"]\))/g, (_, a, rel, b) => a + pathToFileURL(path.resolve(path.dirname(appFile), rel)).href + b)
const { MetaGrade } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const guide = { schema: 3, name: '芙宁娜', presets: [
  { id: 'dps', name: '输出', role: 'dps', meta: { 定位: '输出' }, v2: { weapons: [{ label: '推荐', items: [{ name: '静水流涌之辉' }] }], panels: [{ k: '暴击伤害', v: '200%' }] } },
  { id: 'support', name: '辅助', role: 'support', meta: { 定位: '辅助' }, v2: { weapons: [{ label: '推荐', items: [{ name: '西风剑' }] }], panels: [{ k: '元素充能效率', v: '200%' }] } }
] }
const backup = { listAll: codexStore.listAll, getGuide: codexStore.getGuide, getSignature: codexStore.getSignature, getWeaponTags: codexStore.getWeaponTags, resolveAlias: atlasRes.resolveAlias }
let readCount = 0, rendered, ruleTitle = '芙宁娜-西风纯辅'
let data = guide
codexStore.listAll = () => ['芙宁娜']
codexStore.getGuide = name => { assert.equal(name, '芙宁娜'); return data }
codexStore.getSignature = () => null
codexStore.getWeaponTags = () => ({})
atlasRes.resolveAlias = async () => ['芙宁娜']
globalThis.__metaGradeEntry = {
  readProfile: async (_event, name) => {
    readCount++; assert.equal(name, '芙宁娜')
    return { ok: true, uid: '100000000', notes: [], build: { charName: name, level: 90, cons: 0, artiRuleTitle: ruleTitle,
      charWeight: { cpct: 100, cdmg: 100 }, weapon: { name: '西风剑', affix: 5 }, talent: { A: 1, E: 10, Q: 10 },
      artis: [], artiMark: null, attrs: { recharge: 220, cdmg: 210 } } }
  },
  respond: async (_event, template, result) => { assert.equal(template, 'grade'); rendered = result; return true }
}
const app = new MetaGrade()
const query = async msg => {
  readCount = 0; rendered = null
  const replies = []
  await app.handleGrade({ msg, reply: async text => { replies.push(String(text)); return true } })
  return replies.join('\n')
}
try {
  await query('#练度查询 芙芙')
  assert.equal(readCount, 1)
  assert.equal(rendered.charName, '芙宁娜')
  assert.equal(rendered.presetName, '辅助')
  assert.equal(rendered.presetMatchReason, '芙宁娜-西风纯辅', '02 直接显示实际评分规则名')
  assert.equal(rendered.mx.dims.length, 3)
  assert.equal(rendered.mx.dims.find(d => d.key === 'weapon').state, 'met')
  assert.equal(rendered.mx.dims.find(d => d.key === 'panel').state, 'met')
  await query('#练度查询 芙芙 输出')
  assert.equal(readCount, 1)
  assert.equal(rendered.presetName, '输出')
  assert.equal(rendered.presetMatchReason, '手动指定')
  assert.equal(rendered.mx.dims.length, 4)
  assert.equal(rendered.mx.dims.find(d => d.key === 'weapon').state, 'below', '西风不应命中输出预设武器')
  const unknown = await query('#练度查询 芙芙 不存在')
  assert.equal(rendered, null)
  assert.match(unknown, /可用预设/)
  // 2026-10-30：编辑器复制出的「辅助 副本」带空格，练度入口也要按完整名称选择
  data = { ...guide, presets: [...guide.presets, { ...guide.presets[1], id: 'support-copy', name: '辅助 副本' }] }
  await query('#练度查询 芙芙 辅助 副本')
  assert.equal(readCount, 1)
  assert.equal(rendered.presetName, '辅助 副本')
  assert.equal(rendered.presetMatchReason, '手动指定')
  await query('#练度查询 芙芙 辅助 副本 面板图3')
  assert.equal(rendered.presetName, '辅助 副本')
  ruleTitle = '通用'; data = { ...guide, presets: [guide.presets[0], { ...guide.presets[0], id: 'alt', name: '另一输出' }] }
  const ambiguous = await query('#练度查询 芙芙')
  assert.equal(rendered, null)
  assert.match(ambiguous, /未能唯一匹配/)
  const usage = await query('#练度查询 芙芙 辅助 多余参数')
  assert.equal(readCount, 0)
  assert.match(usage, /用法/)
} finally {
  Object.assign(codexStore, { listAll: backup.listAll, getGuide: backup.getGuide, getSignature: backup.getSignature, getWeaponTags: backup.getWeaponTags })
  atlasRes.resolveAlias = backup.resolveAlias
  delete globalThis.__metaGradeEntry
}
console.log('真实练度入口：别名、miao标题、手动预设、独立目标、歧义与读取次数通过')
