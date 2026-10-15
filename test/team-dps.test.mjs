/**
 * 队伍参考 DPS 与可调节词条套件（v3 P4 / 队伍伤害 v2）
 *
 * 覆盖：轴解析（默认轴 / 手动轴 / 关键词@窗口 / 多段窗口取最大）、队伍 DPS 求和与窗口、
 * 词条解析与套用（含单位口径、下限截断、不改原对象）、以及 app 的参数分离与路由。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('队伍参考 DPS / 词条（v3 P4）')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const C = await load('components/constants.js')
const R = await load('modules/rotation.js')
const SP = await load('modules/statPatch.js')

const members = [
  { charName: '胡桃', rows: [{ title: '半血开E重击', value: 30000 }, { title: '蒸发重击', value: 58000 }, { title: '元素战技', value: 12000 }] },
  { charName: '行秋', rows: [{ title: 'Q雨帘剑', value: 8000 }, { title: 'E剑雨', value: 3000 }] }
]

// ---------- 1. 轴解析 ----------
{
  const def = R.parseAxis('')
  ok('空写法 → 默认轴', def.manual === false && def.window === R.DEFAULT_WINDOW)
  ok('默认轴说明写明了口径', /最高单次/.test(def.label) && /20s/.test(def.label), def.label)

  const one = R.parseAxis('重击×8@21s')
  ok('手动轴：关键词/次数/窗口', one.manual === true && one.segments.length === 1 &&
    one.segments[0].keyword === '重击' && one.segments[0].count === 8 && one.window === 21, JSON.stringify(one.segments))

  const multi = R.parseAxis('重击×8@21s+元素战技×2')
  ok('多段轴解析', multi.segments.length === 2 && multi.segments[1].keyword === '元素战技' && multi.segments[1].count === 2)
  ok('窗口取各段最大值', multi.window === 21)
  ok('容忍 x / X / * 与中文逗号',
    R.parseAxis('重击x3').segments[0].count === 3 &&
    R.parseAxis('重击*3').segments[0].count === 3 &&
    R.parseAxis('重击×3，元素战技×1').segments.length === 2)

  const kwOnly = R.parseAxis('重击@18s')
  ok('只给关键词（可带 @窗口）', kwOnly.segments[0].count === 1 && kwOnly.window === 18, JSON.stringify(kwOnly.segments))
  ok('完全无法解析时回落默认轴', R.parseAxis('+++').manual === false)
}

// ---------- 2. 队伍 DPS ----------
{
  const def = R.teamDps(members, R.defaultAxis())
  // 默认轴：胡桃 58000 + 行秋 8000 = 66000；窗口 20 → 3300
  ok('默认轴取每人最高单次', def.total === 66000, String(def.total))
  ok('默认轴 DPS = 总伤 / 窗口', Math.abs(def.dps - 66000 / 20) < 1e-6, String(def.dps))
  ok('默认轴会提示"仅横向比较"', def.notes.some(n => n.includes('默认轴')), def.notes.join('｜'))
  ok('按队员给出贡献且标注默认轴', def.members.length === 2 && def.members.every(m => m.byDefault))

  const manual = R.teamDps(members, R.parseAxis('重击×8@21s'))
  // 命中"半血开E重击"与"蒸发重击"两行（都含"重击"）→ (30000+58000)*8 = 704000
  ok('手动轴：关键词包含匹配（多行全计入）', manual.total === 704000, String(manual.total))
  ok('手动轴窗口生效', manual.window === 21 && Math.abs(manual.dps - 704000 / 21) < 1e-6, String(manual.dps))
  ok('手动轴不再提示默认轴', !manual.notes.some(n => n.includes('默认轴')))
  ok('命中行明细带次数与小计', manual.members[0].hits.length === 2 && manual.members[0].hits[0].subtotal === 240000, JSON.stringify(manual.members[0].hits))

  const missed = R.teamDps(members, R.parseAxis('不存在的技能×3'))
  ok('关键词全不命中 → 0 伤并提示', missed.total === 0 && missed.notes.some(n => n.includes('一个都没匹配到')), missed.notes.join('｜'))

  ok('空队伍不报错', R.teamDps([], R.defaultAxis()).total === 0)
}

// ---------- 3. 可调节词条 ----------
{
  const p = SP.parseStatPatch('暴击率+20,暴击伤害-40 攻击力=100')
  ok('解析三条不同写法（+/-, 空格分隔）', p.items.length === 3, JSON.stringify(p.items))
  ok('属性键映射正确（暴击率→cpct 等）',
    p.items[0].attrKey === 'cpct' && p.items[1].attrKey === 'cdmg' && p.items[2].attrKey === 'atk' && p.items[1].delta === -40)
  ok('元素伤害加成归一到 dmg', SP.parseStatPatch('火元素伤害加成+15').items[0].attrKey === 'dmg')
  const bad = SP.parseStatPatch('乱写+abc,暴击率+')
  ok('无法识别的片段进 invalid 而不是抛错', bad.items.length === 0 && bad.invalid.length === 2, JSON.stringify(bad.invalid))
  ok('空写法 → 空词条', SP.parseStatPatch('').items.length === 0)
  // 2026-10-14：对齐阿修版 miao 的面板「换/补」语法（符号在前）
  const miao1 = SP.parseStatPatch('+30暴击')
  ok('miao 换补式：+30暴击 → cpct +30', miao1.items.length === 1 && miao1.items[0].attrKey === 'cpct' && miao1.items[0].delta === 30, JSON.stringify(miao1))
  const miao2 = SP.parseStatPatch('-10爆伤 +20精通')
  ok('miao 换补式：多属性空格分隔', miao2.items.length === 2 && miao2.items[0].delta === -10 && miao2.items[1].attrKey === 'mastery', JSON.stringify(miao2))
  ok('按基数百分比的写法进 invalid 并说明', SP.parseStatPatch('+10%大攻击').invalid.length === 1 && /百分比/.test(SP.parseStatPatch('+10%大攻击').invalid[0]))
  ok('早期写法仍兼容（暴击率+20 / 攻击力=100）', SP.parseStatPatch('暴击率+20').items.length === 1 && SP.parseStatPatch('攻击力=100').items[0].attrKey === 'atk')

  const attrs = { cpct: 60, cdmg: 200, hp: 1000, atk: 1200 }
  const applied = SP.applyStatPatch(attrs, SP.parseStatPatch('暴击率+20,暴击伤害-40,生命值-5000'))
  ok('套用增量（百分点与数值同口径）', applied.cpct === 80 && applied.cdmg === 160 && applied.hp === 0)
  ok('下限截到 0（不会出现负属性）', applied.hp === 0)
  ok('不改原对象', attrs.cpct === 60 && attrs.hp === 1000)
  ok('没写的属性保持不变', applied.atk === 1200)
  ok('展示文案', SP.patchLabel(SP.parseStatPatch('暴击率+20,暴击伤害-40')) === '暴击率+20，暴击伤害-40', SP.patchLabel(SP.parseStatPatch('暴击率+20,暴击伤害-40')))

  // 与评分器共用同一张属性名表（避免两处分叉）
  const gradeSrc = readText(path.join(pluginRoot, 'src', 'modules', 'grade.ts'))
  ok('属性名表与 grade.ts 一致（键集合相同）',
    ['生命值', '攻击力', '防御力', '元素精通', '元素充能效率', '暴击率', '暴击伤害', '治疗加成', '物理伤害加成', '元素伤害加成']
      .every(k => gradeSrc.includes(`${k}:`) && Object.keys(SP.PANEL_ATTR_KEY).includes(k)))
}

// ---------- 4. app 参数分离与路由 ----------
{
  const TD = await load('modules/teamDamage.js')
  ok('参数解析在纯模块里（可离线单测）', typeof TD.parseTeamArgs === 'function' && typeof TD.LEGACY_TOKEN_RE === 'object')
  const parsed = TD.parseTeamArgs('胡桃 行秋 夜兰 钟离 100000000 暴击+20 +30爆伤')
  ok('拆出四个角色名', parsed.names.join(',') === '胡桃,行秋,夜兰,钟离', parsed.names.join(','))
  ok('拆出 UID', parsed.uid === '100000000', parsed.uid)
  ok('免前缀词条被拆出来', parsed.patchTokens.join(' ') === '暴击+20 +30爆伤', parsed.patchTokens.join(' '))
  ok('旧写法（轴:/词条:）只进 legacy，不再当参数解析',
    (() => { const l = TD.parseTeamArgs('胡桃 行秋 夜兰 钟离 轴:重击×8 词条:+20暴击'); return l.legacyTokens.length === 2 && l.patchTokens.length === 0 })())
  ok('顿号/逗号分隔也认', TD.parseTeamArgs('胡桃、行秋，夜兰/钟离').names.length === 4)
  const app = readText(path.join(pluginRoot, 'src', 'apps', 'teamDamage.ts'))
  ok('app 产物存在', fs.existsSync(path.join(libDir, 'apps', 'teamDamage.js')))

  // 通过源码函数镜像验证参数分离（app 静态 import 框架 plugin，不能直接 import ts）
  ok('app 从纯模块导入参数解析（解析逻辑不在 app 里）',
    app.includes("parseTeamArgs") && app.includes("from '../modules/teamDamage.js'"))
  ok('app 把词条交给桥临时重算（不改 miao 面板）', app.includes('patch: patch.items.length ? patch : undefined'))
  ok('app 计算参考 DPS 并带轴口径', app.includes('teamDps(') && app.includes('axisLabel'))
  ok('app 用序号轴（配置项 teamDamageAxes），不再用 parseAxis',
    app.includes('axisByNo(') && app.includes('teamDamageAxes') && !app.includes('parseAxis('))

  const ev = C.matchCommand('#队伍伤害2 胡桃 行秋 夜兰 钟离 暴击+20')
  ok('带序号轴/词条的消息仍命中入口', ev?.key === 'teamDamage')
  ok('序号进第 1 组、其余参数进第 2 组',
    ev?.match[1] === '2' && /胡桃 行秋 夜兰 钟离 暴击\+20/.test(ev?.match[2] || ''))

  const help = readText(path.join(pluginRoot, 'resources', 'help', 'help-cfg.js'))
  // 2026-10-15 用户定：帮助页只展示默认轴（`#队伍伤害 四人名`），不暴露序号轴 / 窗口等实现细节
  ok('帮助页展示默认轴写法（不带序号）', /#队伍伤害 四人名/.test(help) && !/#队伍伤害[2-9]/.test(help))
  ok('帮助页收录免前缀词条写法', /\+30暴击/.test(help))
}

const bad = report()
process.exit(bad ? 1 : 0)
