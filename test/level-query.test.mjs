/**
 * `#练度查询` 接线套件（v3 P2）
 *
 * 覆盖：路由（新入口命中、旧 `#练度榜` 不受影响）· 配置项（权重/档位/阈值，含覆盖与回落）
 * · miao 薄桥（开发工作区无 miao → 必须给出可读的失败原因，而不是抛异常）· app 与模板接线。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, ensureTmp, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('#练度查询（v3 P2）')

// ⚠ `ensureTmp()` 忽略参数（所有套件共用 test/.test-tmp）→ 数据与配置都放进自己的子目录
const base = path.join(ensureTmp(), 'level-query')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(base, { recursive: true })
process.env.META_DATA_DIR = path.join(base, 'data')
process.env.META_CONFIG_FILE = path.join(base, 'config.yaml')
fs.mkdirSync(process.env.META_DATA_DIR, { recursive: true })

const C = await import(pathToFileURL(path.join(libDir, 'components', 'constants.js')).href)
const CFG = await import(pathToFileURL(path.join(libDir, 'components', 'config.js')).href)

// ---------- 1. 路由 ----------
{
  ok('`#练度查询 胡桃` 命中新入口', C.matchCommand('#练度查询 胡桃')?.key === 'grade')
  ok('参数进捕获组', C.matchCommand('#练度查询 胡桃')?.match[1] === '胡桃')
  // 2026-10-15 用户定：UID 形态属遗留问题，已移除（路由仍命中，由 app 层给改用提示）
  ok('带 UID 仍能命中规则（由 app 层拒绝并提示）',
    C.matchCommand('#练度查询 胡桃 100000000')?.key === 'grade')
  ok('app 明确拒绝 UID 形态并指向 #练度榜', (() => {
    const src = readText(path.join(pluginRoot, 'src', 'apps', 'grade.ts'))
    return /\^\\d\{9\}\$/.test(src) && src.includes('#练度榜') && src.includes('不写 UID')
  })())
  const legacy = ['#练度榜 胡桃', '#练度榜', '#DPS榜', '#meta状态', '#危战']
  push('旧 `#DPS…` 命令不被新入口吞掉', legacy.filter(t => C.matchCommand(t)?.key === 'grade'), [])
  push('旧 `#练度榜` 仍由旧规则命中', legacy.slice(0, 2).filter(t => C.matchCommand(t)?.key !== 'build'), [])
  ok('新入口不抢旧命令的规则键', C.RULES.build.test('#练度榜 胡桃') && !C.RULES.grade.test('#练度榜 胡桃'))
  ok('COMMANDS 登记了 grade', C.COMMANDS.some(c => c.rules.includes('grade')))
}

// ---------- 2. 配置项 ----------
{
  fs.writeFileSync(process.env.META_CONFIG_FILE, [
    'networkEnabled: false',
    'gradeWeights: "panel:40,weapon:10,artifact:30,talent:20"',
    'gradePanelTiers: "big:0.95,normal:0.5,small:0.2"',
    'gradeRankThresholds: "MAX:90,ACE:80,SSS:70,SS:60,S:50,A:40,B:30,C:20"'
  ].join('\n') + '\n', 'utf8')

  const w = CFG.getGradeWeights()
  // 2026-10-15：面板与圣遗物合并为 comprehensive；**旧配置自动相加兼容**（40 + 30 = 70）
  ok('旧写法（panel+artifact）自动折进 comprehensive', w.comprehensive === 70 && w.weapon === 10 && w.talent === 20, JSON.stringify(w))
  ok('权重三项齐全（综合 / 武器 / 天赋）', ['comprehensive', 'weapon', 'talent'].every(k => Number.isFinite(w[k])))
  fs.writeFileSync(process.env.META_CONFIG_FILE, 'gradeWeights: "comprehensive:80,weapon:10,talent:10"\n', 'utf8')
  const wNew = CFG.getGradeWeights()
  ok('新写法直接生效', wNew.comprehensive === 80 && wNew.weapon === 10 && wNew.talent === 10, JSON.stringify(wNew))
  fs.writeFileSync(process.env.META_CONFIG_FILE, [
    'networkEnabled: false',
    'gradeWeights: "panel:40,weapon:10,artifact:30,talent:20"',
    'gradePanelTiers: "big:0.95,normal:0.5,small:0.2"',
    'gradeRankThresholds: "MAX:90,ACE:80,SSS:70,SS:60,S:50,A:40,B:30,C:20"'
  ].join('\n') + '\n', 'utf8')
  const t = CFG.getGradePanelTiers()
  ok('面板档阈值读到了覆盖值', t.big === 0.95 && t.normal === 0.5 && t.small === 0.2, JSON.stringify(t))
  const ranks = CFG.getGradeRankThresholds()
  ok('九档阈值读到了覆盖值且顺序不变',
    ranks[0][0] === 'MAX' && ranks[0][1] === 90 && ranks.length === 8, JSON.stringify(ranks))
  ok('默认配置三项齐全', ['gradeWeights', 'gradePanelTiers', 'gradeRankThresholds'].every(k => typeof CFG.defaultConfig[k] === 'string'))

  // 非法配置回落
  fs.writeFileSync(process.env.META_CONFIG_FILE, 'gradeWeights: "???",\ngradePanelTiers: "big:9",\ngradeRankThresholds: "???"\n', 'utf8')
  const wBad = CFG.getGradeWeights()
  ok('非法权重回落默认', wBad.comprehensive === 65 && wBad.weapon === 20 && wBad.talent === 15, JSON.stringify(wBad))
  const t2 = CFG.getGradePanelTiers()
  ok('越界面板阈值回落默认', t2.big === 0.9, JSON.stringify(t2))
  ok('非法九档阈值回落默认', CFG.getGradeRankThresholds()[0][1] === 95)
}

// ---------- 3. miao 薄桥：无 miao 时必须可读失败 ----------
{
  const MP = await import(pathToFileURL(path.join(libDir, 'model', 'MiaoProfile.js')).href)
  const fakeEvent = { msg: '#练度查询 胡桃', reply: async () => {} }
  const r = await MP.readProfile(fakeEvent, '胡桃')
  ok('无 miao 时返回 ok:false', r.ok === false)
  ok('失败原因是中文可读文案', typeof r.error === 'string' && r.error.length > 0 && /miao|未找到/.test(r.error), r.error)
  const resolved = await MP.resolveUid({ msg: '#练度查询 胡桃 100000001', reply: async () => {} })
  // 2026-10-14 用户定：练度查询不带 UID（一律走 miao 绑定）→ 消息里的数字不再被当成账号
  ok('消息里的 UID 不再被采纳（走绑定）', resolved.uid === '' && !!resolved.error, JSON.stringify(resolved))
}

// ---------- 4. app 与模板 ----------
{
  const src = readText(path.join(pluginRoot, 'src', 'apps', 'grade.ts'))
  ok('app 用 RULES.grade 注册规则', src.includes('reg: RULES.grade'))
  ok('app 元数据取自 COMMANDS', src.includes('COMMANDS.find(') && src.includes('META.priorityOffset'))
  ok('app 首个导出是插件类', /^export class \w+ extends plugin/m.test(src))
  ok('app 用评分器与 miao 桥（不自己算）', src.includes("from '../modules/grade.js'") && src.includes("from '../model/MiaoProfile.js'"))
  ok('app 权重/档位/阈值都取自配置', src.includes('getGradeWeights()') && src.includes('getGradePanelTiers()') && src.includes('getGradeRankThresholds()'))

  const tpl = readText(path.join(pluginRoot, 'resources', 'dps', 'grade.html'))
  ok('模板已就位', fs.existsSync(path.join(pluginRoot, 'resources', 'dps', 'grade.html')))
  ok('模板引用公共样式（含数据区共享组件）与缩放/版权写法',
    tpl.includes('{{_res_path}}/common/base.css') && tpl.includes('{{_res_path}}/common/components.css') &&
    tpl.includes('{{_res_path}}/common/meta-ui.css') &&
    tpl.includes('{{renderScale}}') && tpl.includes('{{copyright}}'))
  /*
   * 2026-10-15 UI 重构（档案批注）：数据区换成 `.mx-*` 组件 —— 三维达成度走 `mx.dims`（未知/不计分不画条），
   * 差距证据与建议走 `mx.evidence` / `mx.suggestions`（带证据号）；**立绘行 `.gd-basic` 必须一字不动**。
   */
  ok('模板用 mx.dims 呈现三维达成度（四态 + 不画零长度条）',
    tpl.includes('{{each mx.dims d}}') && tpl.includes('mx-meter__fill') && tpl.includes('mx-meter--'))
  ok('模板渲染差距证据与建议（带证据号）',
    tpl.includes('{{each mx.evidence r}}') && tpl.includes('{{each mx.suggestions s}}') && tpl.includes('mx-evidence-ref'))
  const css = readText(path.join(pluginRoot, 'resources', 'common', 'meta-ui.css')).replace(/\/\*[\s\S]*?\*\//g, '')
  ok('冻结立绘行仍在且共享样式不碰它',
    tpl.includes('class="gd-basic"') && tpl.includes('gd-main-pic') && !/\.gd-/.test(css))
  ok('参考项与计分项分开（参考不计分）', tpl.includes('mx.references') && tpl.includes('面板与命座只作参考，不计分'))
  /* 用户 2026-10-15 定：圣遗物行「套装名独占一行、评分与词条次行右对齐」——换组件后仍要守住 */
  ok('圣遗物行：套装名与评分/词条分行、次行右对齐',
    tpl.includes('mx-equipment') && tpl.includes('mx-meta-line') &&
    /\.mx-meta-line \{[^}]*text-align: right/.test(css) && /\.mx-meta-line \{[^}]*white-space: nowrap/.test(css))
}

// ---------- 5. 帮助页收录 ----------
{
  const help = readText(path.join(pluginRoot, 'resources', 'help', 'help-cfg.js'))
  ok('帮助页收录 #练度查询 胡桃', /#练度查询 胡桃/.test(help))
}

const bad = report()
process.exit(bad ? 1 : 0)
