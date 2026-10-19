/**
 * 显示归一套件（阶段 1.2b）
 *
 * 插件侧不重复实现归一，只把维护者区的单一真相（`scripts/lib/guide-model.mjs` +
 * `guide-display.mjs`）包成窄接口。所以这里要断言的是**契约**：
 *   - 六模块标题与顺序固定；
 *   - 档位词只有 推荐 / 可选 / 过渡（`tierLabelClass` 给出对应类名）；
 *   - 武器分隔符是 `＞`（半角 `>` 与 `/` 一律不残留）；
 *   - 武器行同级不超过 4 把；
 *   - 专武标色：严格专武 `sig`、实际专属 `sigAlt`；活动武器标签追加在 `note`；
 *   - 不传 opts 时就没有标色/标签（证明 opts 真的生效）；
 *   - 空模块 `empty`、空档角色 `hasContent === false`、分支取用。
 *
 * 说明：`2X + 2Y` 简写当前数据里 **0 命中**（规则的实现与用例在维护者区的
 * `display-selftest.mjs`，那里有等价候选断言 9/9），本套件不重复造数据去测它。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, dataDir, libDir } from './_helper.mjs'

const { push, ok, report } = createChecks('显示归一（subViews）')

const subViewsFile = path.join(libDir, 'modules', 'subViews.js')
const storeFile = path.join(libDir, 'model', 'CodexStore.js')
ok('lib/modules/subViews.js 存在', fs.existsSync(subViewsFile))
ok('lib/model/CodexStore.js 存在', fs.existsSync(storeFile))
if (!fs.existsSync(subViewsFile) || !fs.existsSync(storeFile)) {
  report()
  process.exit(1)
}

const { buildCodexView, pickSection, narrowToSubView, isSubViewTitle, SUB_VIEW_TITLES } = await import(pathToFileURL(subViewsFile).href)
const { CodexStore } = await import(pathToFileURL(storeFile).href)

const store = new CodexStore()
const signatureOf = (n) => store.getSignature(n)
const weaponTags = store.getWeaponTags()

// ---------- 单角色：胡桃 ----------
const view = buildCodexView(store.getGuide('胡桃'), { signature: signatureOf('胡桃'), weaponTags })
ok('胡桃 视图非空', !!view)
push('模块标题与顺序', view.sections.map(s => s.title), [...SUB_VIEW_TITLES])
ok('胡桃 hasContent', view.hasContent === true)
ok('hints.empty === 暂无', view.hints.empty === '暂无')
ok('hints.refine 含「精5」', view.hints.refine.includes('精5'))

const w = pickSection(view, '武器')
ok('pickSection("武器") 命中', !!w)
push('武器首行档位词', w.rows[0].label, '推荐')
ok('武器首行档位类名 label-推荐', w.rows[0].labelClass === 'label-推荐')
ok('专武标色：护摩之杖 sig === true', w.rows[0].items.some(it => it.text === '护摩之杖' && it.sig === true))
push('武器分隔符用全角 ＞', w.rows[0].items[0].sepAfter, '＞')

// opts 不传 → 不应有任何标色 / 活动标签
const bare = buildCodexView(store.getGuide('胡桃'), {})
const bareW = pickSection(bare, '武器')
ok('不传 signature → 无 sig 标色', !bareW.rows.some(r => (r.items ?? []).some(it => it.sig)))
ok('不传 weaponTags → 无活动标签', !bareW.rows.some(r => (r.items ?? []).some(it => String(it.note ?? '').includes('活动'))))

// ---------- 全库契约 ----------
const names = store.listCharacters()
ok('收录角色 ≥ 100', names.length >= 100)

const tagList = new Set((weaponTags.活动 ?? []).map(String))
let maxItems = 0
let rawSep = []
let rawGt = []
let slashInText = []
let sigCount = 0
let sigAltCount = 0
let actCount = 0
let actNotInTable = []
let shapeBad = []
let titleBad = []
let emptySectionChars = []
const sampled = names.slice(0, 20)

for (const name of names) {
  const v = buildCodexView(store.getGuide(name), { signature: signatureOf(name), weaponTags })
  if (!v) { shapeBad.push(`${name}: 视图为空`); continue }
  if (v.sections.length !== 6) shapeBad.push(`${name}: 模块数 ${v.sections.length}`)
  if (sampled.includes(name)) {
    for (const s of v.sections) {
      if (!SUB_VIEW_TITLES.includes(s.title)) titleBad.push(`${name}/${s.title}`)
      if (!Array.isArray(s.rows) && !Array.isArray(s.teams)) shapeBad.push(`${name}/${s.title}: 既无 rows 也无 teams`)
      if (s.empty) emptySectionChars.push(name)
    }
  }
  const section = v.sections.find(s => s.title === '武器')
  for (const row of section?.rows ?? []) {
    maxItems = Math.max(maxItems, (row.items ?? []).length)
    for (const [i, it] of (row.items ?? []).entries()) {
      const sep = String(it.sepAfter ?? '')
      if (i < (row.items ?? []).length - 1 && (sep === '>' || sep === '/')) rawSep.push(`${name}: ${sep}`)
      if (/[>]/.test(String(it.text ?? ''))) rawGt.push(`${name}: ${it.text}`)
      if (String(it.text ?? '').includes('/')) slashInText.push(`${name}: ${it.text}`)
      if (it.sig) sigCount++
      if (it.sigAlt) sigAltCount++
      if (String(it.note ?? '').includes('活动')) {
        actCount++
        if (!tagList.has(String(it.text ?? ''))) actNotInTable.push(`${name}: ${it.text}`)
      }
    }
  }
}

push('武器行同级最多 4 把', maxItems, 4)
push('没有半角 > 作分隔符', rawSep, [])
push('武器文本无半角 >', rawGt, [])
push('武器文本无 /（等价候选走 =）', slashInText, [])
ok('严格专武标色命中 ≥ 50', sigCount >= 50)
ok('实际专属标色命中 ≥ 1', sigAltCount >= 1)
ok('活动标签命中 ≥ 10', actCount >= 10)
push('活动标签的武器都在 _weapon-tags.json 里', actNotInTable, [])
push('抽样 20 角色：模块标题合法', titleBad, [])
push('抽样 20 角色：模块形状正常', shapeBad, [])
ok('存在空模块角色（empty 标记可用）', emptySectionChars.length > 0)

// ---------- 空档角色与边界（2026-10-18 复审：不再拿真实角色当空档） ----------
// 真实角色随时可能补数据（米提亚已补），空档语义必须用**构造的空档 guide** 验证，别绑定具体名字。
const empty = buildCodexView({ schema: 'codex/v2', name: '空档测试角色', game: 'gs', meta: {}, sections: [] }, { signature: null, weaponTags })
ok('空档 guide 视图存在（点名查询可回「待补充」）', !!empty)
ok('空档 guide hasContent === false', empty.hasContent === false)
push('buildCodexView(null) → null', buildCodexView(null), null)

// ---------- 分支取用 ----------
push('isSubViewTitle("武器")', isSubViewTitle('武器'), true)
push('isSubViewTitle("不存在的模块")', isSubViewTitle('不存在的模块'), false)
push('pickSection 非法词 → null', pickSection(view, '不存在的模块'), null)
const narrowed = narrowToSubView(view, '面板')
push('narrowToSubView 只留一个模块', narrowed.sections.map(s => s.title), ['面板'])
push('narrowToSubView 保留页头信息', narrowed.name, '胡桃')
push('narrowToSubView 非法词 → null', narrowToSubView(view, 'XX'), null)

// ---------- 数据根仍指向仓库 data/gi ----------
ok('数据根存在', fs.existsSync(path.join(dataDir, 'gi', '_order.json')))

const bad = report()
process.exit(bad ? 1 : 0)
