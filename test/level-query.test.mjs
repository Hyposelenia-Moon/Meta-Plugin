/**
 * `#练度查询` 接线套件（v3 P2）
 *
 * 覆盖：路由（新入口命中、旧 `#DPS练度查询` 不受影响）· 配置项（权重/档位/阈值，含覆盖与回落）
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
  ok('`#练度查询 胡桃` 命中新入口', C.matchEntryCommand('#练度查询 胡桃')?.key === 'grade')
  ok('参数进捕获组', C.matchEntryCommand('#练度查询 胡桃')?.match[1] === '胡桃')
  ok('带 UID 也命中', C.matchEntryCommand('#练度查询 胡桃 100000000')?.match[1] === '胡桃 100000000')
  const legacy = ['#DPS练度查询 胡桃', '#DPS练度查询', '#DPS榜', '#DPS状态', '#危战']
  push('旧 `#DPS…` 命令不被新入口吞掉', legacy.filter(t => C.matchEntryCommand(t)?.key === 'grade'), [])
  push('旧 `#DPS练度查询` 仍由旧规则命中', legacy.slice(0, 2).filter(t => C.matchDpsCommand(t)?.key !== 'build'), [])
  ok('新入口不抢旧命令的规则键', C.DPS_RULES.build.test('#DPS练度查询 胡桃') && !C.ENTRY_RULES.grade.test('#DPS练度查询 胡桃'))
  ok('ENTRY_COMMANDS 登记了 grade', C.ENTRY_COMMANDS.some(c => c.rules.includes('grade')))
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
  ok('权重读到了覆盖值', w.panel === 40 && w.talent === 20, JSON.stringify(w))
  ok('权重四项齐全', ['panel', 'weapon', 'artifact', 'talent'].every(k => Number.isFinite(w[k])))
  const t = CFG.getGradePanelTiers()
  ok('面板档阈值读到了覆盖值', t.big === 0.95 && t.normal === 0.5 && t.small === 0.2, JSON.stringify(t))
  const ranks = CFG.getGradeRankThresholds()
  ok('九档阈值读到了覆盖值且顺序不变',
    ranks[0][0] === 'MAX' && ranks[0][1] === 90 && ranks.length === 8, JSON.stringify(ranks))
  ok('默认配置三项齐全', ['gradeWeights', 'gradePanelTiers', 'gradeRankThresholds'].every(k => typeof CFG.defaultConfig[k] === 'string'))

  // 非法配置回落
  fs.writeFileSync(process.env.META_CONFIG_FILE, 'gradeWeights: "???",\ngradePanelTiers: "big:9",\ngradeRankThresholds: "???"\n', 'utf8')
  const w2 = CFG.getGradeWeights()
  ok('非法权重回落默认', w2.panel === 30 && w2.artifact === 35, JSON.stringify(w2))
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
  ok('app 用 ENTRY_RULES.grade 注册规则', src.includes('reg: ENTRY_RULES.grade'))
  ok('app 元数据取自 ENTRY_COMMANDS', src.includes('ENTRY_COMMANDS.find(') && src.includes('META.priorityOffset'))
  ok('app 首个导出是插件类', /^export class \w+ extends plugin/m.test(src))
  ok('app 用评分器与 miao 桥（不自己算）', src.includes("from '../modules/grade.js'") && src.includes("from '../model/MiaoProfile.js'"))
  ok('app 权重/档位/阈值都取自配置', src.includes('getGradeWeights()') && src.includes('getGradePanelTiers()') && src.includes('getGradeRankThresholds()'))

  const tpl = readText(path.join(pluginRoot, 'resources', 'dps', 'grade.html'))
  ok('模板已就位', fs.existsSync(path.join(pluginRoot, 'resources', 'dps', 'grade.html')))
  ok('模板引用公共样式与缩放/版权写法',
    tpl.includes('{{_res_path}}/common/base.css') && tpl.includes('{{_res_path}}/common/components.css') &&
    tpl.includes('{{renderScale}}') && tpl.includes('{{copyright}}'))
  ok('模板用四条细进度条（dims）呈现四维达成度', tpl.includes('{{each dims d}}') && tpl.includes('gd-dim-fill'))
  ok('模板渲染对比表与建议', tpl.includes('{{each missRows r}}') && tpl.includes('{{each suggestions s idx}}'))
}

// ---------- 5. 帮助页收录 ----------
{
  const help = readText(path.join(pluginRoot, 'resources', 'help', 'help-cfg.js'))
  ok('帮助页收录 #练度查询 胡桃', /#练度查询 胡桃/.test(help))
}

const bad = report()
process.exit(bad ? 1 : 0)
