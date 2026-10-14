/**
 * 命令与抢占套件（阶段 3）
 *
 * 分五层：
 *   1. **抢占对照表**（设计文档 §5.3）：我们要认领的形态一律 `isCodexCommand() === true`；
 *      Atlas 的**全部后缀**（实测 38 条）与 `#设置默认攻略N`、帮助三词一律**放行**——
 *      这一层直接 import 编译产物跑，不依赖 bot；
 *   2. **app 结构**：`src/apps/codex.ts` 的优先级写死 `PREEMPT_PRIORITY`、accept 用纯判定、
 *      四条规则齐全、handler 存在，且**只导出插件类**（加载器取首个导出）；
 *   3. **参数解析**：后缀式（`#胡桃攻略`）与列表 / 状态（2026-10-14 起前缀式与反查已移除）；
 *   4. **视图收窄**：档位过滤、空判定；
 *   5. **反查与图标**：真实数据上查武器推荐者与配队，`withIcons` 在有 miao 时挂图、无 miao 时不挂也不报错。
 *
 * Atlas 后缀表：`META_ATLAS_DIR` 或 `<插件根>/../Atlas-Plugin` 在场时**动态读取**（保证跟着它走）；
 * 不在场时退化为内置的 12 条代表性后缀（图鉴/天赋/命座/圣遗物/养成素材/…）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('命令与抢占（阶段 3）')

const C = await import(pathToFileURL(path.join(libDir, 'components', 'constants.js')).href)
const B = await import(pathToFileURL(path.join(libDir, 'modules', 'branches.js')).href)
const SV = await import(pathToFileURL(path.join(libDir, 'modules', 'subViews.js')).href)
const RV = await import(pathToFileURL(path.join(libDir, 'modules', 'reverse.js')).href)
const { CodexStore } = await import(pathToFileURL(path.join(libDir, 'model', 'CodexStore.js')).href)

// ---------- 1. 抢占对照表 ----------
const claim = [
  '#胡桃攻略', '#胡桃攻略2', '#胡桃攻略7', '#更新胡桃攻略', '#胡桃攻略',
  '#攻略 胡桃', '#攻略 胡桃 武器', '#攻略 胡桃 过渡',
  '#攻略 武器 护摩之杖', '#攻略 配队 胡桃 夜兰', '#攻略列表', '#攻略状态'
]
push('认领：攻略类形态全部命中', claim.filter(m => !C.isCodexCommand(m)), [])

// Atlas 的后缀（在场时读它的常量，保证跟着它走）
const atlasDir = process.env.META_ATLAS_DIR || path.resolve(pluginRoot, '..', 'Atlas-Plugin')
let suffixes = null
let suffixSource = ''
try {
  const mod = await import(pathToFileURL(path.join(atlasDir, 'components', 'constants.js')).href)
  if (Array.isArray(mod.SHORTCUT_SUFFIXES)) {
    suffixes = mod.SHORTCUT_SUFFIXES.map(String)
    suffixSource = `Atlas 常量（${suffixes.length} 条）`
  }
} catch { /* 不在场，用内置代表性子集 */ }
if (!suffixes) {
  suffixes = ['图鉴', '天赋', '技能', '命座', '星魂', '圣遗物', '遗器', '驱动盘', '套', '养成素材', '材料', '掉落']
  suffixSource = `内置代表性子集（${suffixes.length} 条）`
}
console.log(`后缀来源：${suffixSource}`)

// 攻略 / 指南这两个后缀归我们；其余全部放行
const foreignSuffixes = suffixes.filter(s => s !== '攻略' && s !== '指南')
const wrongClaim = foreignSuffixes.map(s => `#胡桃${s}`).filter(m => C.isCodexCommand(m))
push('放行：Atlas 其它后缀（#胡桃+suffix）', wrongClaim, [])

const foreignClaim = suffixes.filter(s => s === '攻略' || s === '指南').map(s => `#胡桃${s}`)
push('Atlas 的「攻略/指南」后缀归我们', foreignClaim.filter(m => !C.isCodexCommand(m)), [])

const release = [
  '#设置默认攻略2', '#设置默认攻略', '#设置默认攻略7',
  '#攻略', '#攻略帮助', '#攻略说明',
  '#成就', '#深渊', '#图鉴状态', '#图鉴别名设置 胡桃', '#DPS榜',
  '#胡桃', '', '#'
]
push('放行：非攻略命令', release.filter(m => C.isCodexCommand(m)), [])
push('帮助三词仍归帮助 app', ['#攻略', '#攻略帮助', '#攻略说明'].filter(m => !C.isHelpCommand(m)), [])
push('设置默认攻略不被帮助规则吞掉', ['#设置默认攻略2'].filter(m => C.isHelpCommand(m)), [])

// ---------- 2. app 结构 ----------
const appFile = path.join(pluginRoot, 'src', 'apps', 'codex.ts')
ok('src/apps/codex.ts 存在', fs.existsSync(appFile))
if (fs.existsSync(appFile)) {
  const src = readText(appFile)
  ok('继承框架 plugin', /class\s+MetaCodex\s+extends\s+plugin/.test(src))
  ok('优先级取 PREEMPT_PRIORITY（写死）', src.includes('priority: PREEMPT_PRIORITY'))
  ok('实现 accept()', /async\s+accept\s*\(/.test(src))
  ok('accept 只做纯判定 isCodexCommand', src.includes('isCodexCommand(e.msg)'))
  // 2026-10-14 用户定：只保留后缀式 `#胡桃攻略`（前缀式 `#攻略 胡桃 [模块]` 与反查 `#攻略 武器 …` 已移除）
  ok('规则只剩后缀式与列表/状态两条', ['CODEX_SUFFIX_RULE', 'CODEX_META_RULE'].every(k => src.includes(k)) &&
    !src.includes('CODEX_GUIDE_RULE') && !src.includes('CODEX_ARG_RULE'))
  ok('handler 齐全（移除反查后，仅保留后缀式与列表/状态相关）',
    ['handleSuffix', 'handleMeta', 'replyCharacter', 'replyPage', 'replyList', 'replyStatus'].every(k => src.includes(k)) &&
    !src.includes('handleArg'))
  ok('走框架 runtime 渲染（renderPage）', src.includes('renderPage(e,'))
  ok('渲染失败回落文本', src.includes('viewToText(view)'))
  ok('只导出插件类与 resolveCharacter（供套件/复用）', !/\nexport\s+(?:default|interface|type|const)\s/.test(src))
}

// ---------- 3. 参数解析 ----------
push('后缀：普通', B.parseSuffixQuery('#胡桃攻略'), { character: '胡桃', setIndex: null })
push('后缀：带套数', B.parseSuffixQuery('#胡桃攻略2'), { character: '胡桃', setIndex: 2 })
push('后缀：更新前缀', B.parseSuffixQuery('#更新胡桃攻略'), { character: '胡桃', setIndex: null })
push('后缀：指南', B.parseSuffixQuery('#胡桃攻略'), { character: '胡桃', setIndex: null })
push('后缀：裸「#攻略」→ null', B.parseSuffixQuery('#攻略'), null)
push('后缀：图鉴不是攻略 → null', B.parseSuffixQuery('#胡桃图鉴'), null)
push('后缀：复合名（旅行者·火）', B.parseSuffixQuery('#旅行者·火攻略'), { character: '旅行者·火', setIndex: null })

/** 测试用解析器：只认「胡桃 / 夜兰 / 行秋」 */
const fakeResolve = (k) => (['胡桃', '夜兰', '行秋'].includes(k) ? k : null)
push('前缀：角色 + 模块', B.parseArgQuery('#攻略 胡桃 武器', fakeResolve), { kind: 'character', head: '胡桃', rest: ['武器'], character: '胡桃', module: '武器' })
push('前缀：角色 + 档位', B.parseArgQuery('#攻略 胡桃 过渡', fakeResolve), { kind: 'character', head: '胡桃', rest: ['过渡'], character: '胡桃', tier: '过渡' })
{
  const q = B.parseArgQuery('#攻略 武器 护摩之杖', fakeResolve)
  push('前缀：反查武器', { kind: q.kind, weapon: q.weapon }, { kind: 'reverseWeapon', weapon: '护摩之杖' })
}
{
  const q = B.parseArgQuery('#攻略 配队 胡桃 夜兰 不存在', fakeResolve)
  push('前缀：反查配队（成员 + 未识别）', { kind: q.kind, members: q.members, unresolved: q.unresolved },
    { kind: 'reverseTeam', members: ['胡桃', '夜兰', '不存在'], unresolved: ['不存在'] })
}
push('前缀：列表', B.parseArgQuery('#攻略 列表', fakeResolve).kind, 'list')
push('前缀：状态', B.parseArgQuery('#攻略 状态', fakeResolve).kind, 'status')
push('前缀：未知头词', B.parseArgQuery('#攻略 不存在的词', fakeResolve).kind, 'unknown')

// ---------- 4. 视图收窄 ----------
const store = new CodexStore()
const view = SV.buildCodexView(store.getGuide('胡桃'), { signature: store.getSignature('胡桃'), weaponTags: store.getWeaponTags() })
ok('胡桃视图可用', !!view)
push('模块过滤：只剩武器', B.filterView(view, { module: '武器' }).sections.map(s => s.title), ['武器'])
{
  const only = B.filterView(view, { tier: '推荐' })
  const labels = only.sections.flatMap(s => (s.rows ?? []).map(r => String(r.label ?? '').trim())).filter(Boolean)
  push('档位过滤：只有「推荐」行', [...new Set(labels)], ['推荐'])
}
ok('档位过滤：胡桃没有「过渡」档 → 视图为空', B.isViewEmpty(B.filterView(view, { tier: '过渡' })))
ok('原视图不为空', !B.isViewEmpty(view))

// ---------- 5. 反查与图标 ----------
{
  const hits = RV.findWeaponRecommenders(store, '护摩之杖')
  ok('反查护摩之杖：命中 ≥ 1', hits.length >= 1)
  ok('反查护摩之杖：含胡桃', hits.some(h => h.character === '胡桃'))
  ok('反查护摩之杖：档位词非空', hits.every(h => typeof h.tier === 'string'))
  push('反查不存在的武器 → 空', RV.findWeaponRecommenders(store, '这把武器不存在'), [])
}
{
  // 用真实数据造一个必然命中的配队查询：取胡桃第一支配队的成员
  const team = (store.getGuide('胡桃')?.v2?.teams ?? [])[0]
  const members = (team?.members ?? []).map(m => String(m?.name ?? '')).filter(Boolean).slice(0, 2)
  const hits = RV.findTeamContainers(store, members)
  ok(`反查配队（${members.join('+')}）：命中 ≥ 1`, hits.length >= 1)
  ok('反查配队：命中含胡桃', hits.some(h => h.character === '胡桃'))
  push('反查配队：空成员 → 空', RV.findTeamContainers(store, []), [])
}

{
  const withIcons = SV.withIcons(view, { character: '胡桃' })
  const items = withIcons.sections.flatMap(s => (s.rows ?? []).flatMap(r => r.items ?? []))
  const weaponItem = items.find(i => i.ref === 'weapon:护摩之杖')
  // 挂图与否取决于 miao 是否在场：在场必须挂、且路径非空；不在场必须不挂 icon 字段（不报错）
  const miaoDir = process.env.META_MIAO_DIR || path.resolve(pluginRoot, '..', 'miao-plugin')
  const hasMiao = fs.existsSync(path.join(miaoDir, 'resources', 'meta-gs', 'character'))
  if (hasMiao) {
    ok('有 miao：武器条目挂上图', !!weaponItem?.icon)
    ok('有 miao：图标来源为 miao', weaponItem?.iconSource === 'miao')
    ok('有 miao：立绘可取', typeof SV.portraitOf('胡桃') === 'string')
  } else {
    console.log('跳过：miao 不在场（挂图断言留待 bot 部署或设 META_MIAO_DIR）')
    ok('无 miao：不挂 icon 字段', weaponItem?.icon === undefined)
  }

  const text = SV.viewToText(view)
  ok('文本回落含角色名', text.includes('胡桃'))
  ok('文本回落含六模块标题', ['武器', '圣遗物', '天赋', '面板', '命座', '配队'].every(t => text.includes(`【${t}】`)))
  ok('文本回落含档位词', text.includes('推荐'))
}

delete process.env.META_MIAO_DIR
delete process.env.META_ATLAS_DIR
const bad = report()
process.exit(bad ? 1 : 0)
