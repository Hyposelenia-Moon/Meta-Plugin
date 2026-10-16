/**
 * 阿卡莎角色榜条目归一化套件（v3 P5）
 *
 * 全部断言都跑在**真实夹具** `test/fixtures/akasha-board.sample.json` 上
 * （2026-10-14 经代理用无头 Edge「导航 + 捕获响应」抓的 3 条真实榜单记录 + textmap + 分类）。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, readText } from './_helper.mjs'

const { push, ok, report } = createChecks('阿卡莎榜条目归一化（v3 P5）')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const AB = await load('modules/akashaBoard.js')

const fixture = JSON.parse(readText(path.join(pluginRoot, 'test', 'fixtures', 'akasha-board.sample.json')))
const textmap = fixture.textmapSample || null
const raw = { data: fixture.rows }

// ---------- 1. textmap ----------
{
  ok('夹具带 textmap（站点翻译表）', !!textmap?.translation && Object.keys(textmap.translation).length > 5)
  ok('翻译按英文小写查表', AB.translate(textmap, 'Varka') === fixture.textmapSample.translation.varka, AB.translate(textmap, 'Varka'))
  ok('翻不到时回落原文（不留空）', AB.translate(textmap, 'Nonexistent Weapon XYZ') === 'Nonexistent Weapon XYZ')
  ok('空值返回空串', AB.translate(textmap, '') === '' && AB.translate(null, 'Varka') === 'Varka')
}

// ---------- 2. 归一化 ----------
const { entries, total } = AB.normalizeBoard(raw, textmap)
{
  ok('归一化出三条', total === 3 && entries.length === 3, String(total))
  ok('名次升序且来自 index', entries.map(e => e.rank).join(',') === '1,2,3', entries.map(e => e.rank).join(','))
  ok('身份字段齐全（uid / 昵称 / 角色名 / 中文名）',
    entries.every(e => /^\d{6,10}$/.test(e.uid) && e.nickname.length > 0 && e.charName.length > 0 && e.charNameCn.length > 0))
  ok('角色中文名走 textmap', entries[0].charNameCn === '法尔伽', entries[0].charNameCn)
  ok('伤害与双爆分是数值', entries.every(e => e.damage > 0 && e.critValue > 0), JSON.stringify(entries.map(e => [Math.round(e.damage), Math.round(e.critValue)])))
  ok('命座是数值（含 0）', entries.every(e => Number.isFinite(e.cons)))
  ok('按伤害降序（站点口径）', entries[0].damage >= entries[1].damage && entries[1].damage >= entries[2].damage)
}

// ---------- 3. 配装 ----------
{
  const e = entries[0]
  ok('武器带中英名', !!e.weapon?.name && !!e.weapon?.nameCn, JSON.stringify(e.weapon))
  ok('武器中文名走 textmap（狼的武功歌）', e.weapon.nameCn === '狼的武功歌', e.weapon.nameCn)
  ok('圣遗物按部位归一（中文部位名）', e.artis.length > 0 && e.artis.every(a => !!a.slotCn), JSON.stringify(e.artis.map(a => a.slotCn)))
  ok('部位顺序固定为 花→羽→沙→杯→冠',
    e.artis.every((a, i) => i === 0 || Object.keys(AB.SLOT_CN).indexOf(e.artis[i - 1].slot) < Object.keys(AB.SLOT_CN).indexOf(a.slot)))
  ok('主词条走 ENKA_PROP_CN（Enka 属性名 → 中文）',
    e.artis.some(a => /暴击|生命值|攻击力|元素|防御力|充能/.test(a.mainCn)), JSON.stringify(e.artis.map(a => a.mainCn)))
  ok('套装带件数且按件数降序', e.sets.length > 0 && e.sets[0].count >= (e.sets[1]?.count ?? 0), JSON.stringify(e.sets.map(s => [s.nameCn, s.count])))
  ok('套装中文名尽力翻译（翻不到回落英文）', e.sets.every(s => !!s.nameCn))
  ok('天赋 A/E/Q 都是数值', ['A', 'E', 'Q'].every(k => Number.isFinite(e.talent[k])), JSON.stringify(e.talent))
  ok('面板数值取自 stats（不是 propMap）', e.stats.length > 0 && e.stats.every(s => Number.isFinite(s.value)), String(e.stats.length))
  const panel = AB.panelSummary(e)
  ok('面板摘要挑出了常用项且带标签', panel.length >= 3 && panel.every(p => !!p.label && !!p.value), JSON.stringify(panel))
}

// ---------- 4. 名次选取与容错 ----------
{
  ok('按名次取第 1 条', AB.pickByRank(entries, 1)?.rank === 1)
  ok('按名次取第 3 条', AB.pickByRank(entries, 3)?.rank === 3)
  ok('名次越界返回 null（不抛错）', AB.pickByRank(entries, 99) === null)
  ok('名次非法回落第 1 条', AB.pickByRank(entries, 0)?.rank === 1 && AB.pickByRank(entries, NaN)?.rank === 1)
  ok('空载荷不报错', AB.normalizeBoard(null, textmap).total === 0 && AB.normalizeBoard({}, textmap).total === 0)
  ok('缺字段的记录被过滤（没有 uid 的不算）', AB.normalizeBoard({ data: [{ index: 1 }, ...fixture.rows] }, textmap).total === 3)
  ok('没有 textmap 也能归一（只是不翻译）',
    AB.normalizeBoard(raw, null).entries[0].charNameCn === fixture.rows[0].name)
  /*
   * 送翻译的词表（2026-10-17）：角色 / 武器 / 套装 / **主词条短语** —— 主词条漏送过一次，
   * 现场是详情页「主词条：时之沙：HP% 空之杯：HP% 理之冠：Crit DMG」。
   */
  const words = AB.textmapWords(entries)
  ok('textmap 取词含角色名 / 武器名 / 套装名 / 主词条短语',
    words.includes(entries[0].charName) && words.includes(entries[0].weapon.name) &&
    words.includes(entries[0].sets[0].name) && words.includes(entries[0].artis[0].mainKey),
    JSON.stringify(words.slice(0, 8)))
  ok('textmap 取词去空且不含 undefined', words.every(w => typeof w === 'string' && w.length > 0))
  push('textmap 取词在空条目上返回空数组', AB.textmapWords([]), [])
  ok('夹具标注了来源与抓取日期', typeof fixture.source === 'string' && /leaderboards/.test(fixture.source) && !!fixture.capturedAt)
}

// ---------- 5. 接线：id 换算 / 路由 / app 与模板 ----------
{
  const fs = await import('node:fs')
  const ABc = await load('model/AkashaBoard.js')
  const C = await load('components/constants.js')

  ok('角色名 → 官方角色 id（走本地 characters.json）', ABc.officialIdOf('法尔伽') === 10000128, String(ABc.officialIdOf('法尔伽')))
  ok('别名也认（神里绫华 / ayaka）', ABc.officialIdOf('ayaka') === 10000002 && ABc.officialIdOf('神里绫华') === 10000002)
  ok('数字 id 直接透传', ABc.officialIdOf(10000128) === 10000128)
  ok('取不到的角色返回 0', ABc.officialIdOf('不存在的角色') === 0)
  ok('题目 id 换算：官方 id × 100（实测 10000128 → 1000012800）', ABc.calculationIdOf(10000128) === '1000012800')
  /*
   * 2026-10-17：榜序号换算（实测口径：默认榜 = id×100，其余 = id×100 + (分类 index − 1)）。
   * 旧实现是字符串拼接，带序号会拼出 11 位；这条门禁守住加法语义。
   */
  ok('榜序号换算：id×100 + (index−1)（钟离三榜实测 1000003000/…001/…002）',
    ABc.calculationIdOf(10000030, 0) === '1000003000' &&
    ABc.calculationIdOf(10000030, 1) === '1000003001' &&
    ABc.calculationIdOf(10000030, 2) === '1000003002')
  ok('榜序号非法值按 0 处理，且不产生 11 位 id',
    ABc.calculationIdOf(10000125, -3) === '1000012500' && ABc.calculationIdOf(10000125, NaN) === '1000012500' &&
    ABc.calculationIdOf(10000125, 3).length === 10)
  ok('分类接口 URL 带角色 id', /characterId=10000125$/.test(ABc.categoriesApiUrl(10000125)))
  ok('榜单接口 URL 与页面 URL 形态正确',
    /calculationId=1000012800/.test(ABc.boardApiUrl('1000012800')) &&
    ABc.boardPageUrl('1000012800') === 'https://akasha.cv/leaderboards/1000012800/')
  ok('textmap URL 会把词小写并去重',
    /words\[\]=varka/.test(ABc.textmapUrl(['Varka', 'varka', 'Crit DMG'])))

  /*
   * 2026-10-16 合并重构（用户定）：`#配装 胡桃 [名次]` **删除、不做别名**，
   * 两个视图都归 `#练度榜 <角色> [名次]` —— 省略名次 = 前 20 名列表，写名次 = 该名次配装详情。
   */
  ok('`#练度榜 胡桃` 命中练度榜入口', C.matchCommand('#练度榜 胡桃')?.key === 'build')
  ok('参数进捕获组（含名次）', C.matchCommand('#练度榜 胡桃 3')?.match[1] === '胡桃 3')
  const legacy = ['#DPS榜', '#练度查询 胡桃', '#队伍伤害 胡桃 行秋 夜兰 钟离', '#危战 矮灵 n7', '#胡桃攻略']
  push('不吞其它入口', legacy.filter(t => C.matchCommand(t)?.key === 'build'), [])
  push('`#配装` 已删除（不再被任何入口认领）',
    ['#配装', '#配装 胡桃', '#配装 胡桃 3'].filter(t => C.matchCommand(t) !== null), [])
  ok('COMMANDS 只登记 build（akashaBuild 条目已删）',
    C.COMMANDS.some(c => c.rules.includes('build')) && !C.COMMANDS.some(c => c.rules.includes('akashaBuild')))
  ok('RULES 不再有 akashaBuild', C.RULES.akashaBuild === undefined)

  const app = readText(path.join(pluginRoot, 'src', 'apps', 'build.ts'))
  ok('app 用 RULES.build 注册', app.includes('reg: RULES.build'))
  ok('app 首个导出是插件类', /^export class \w+ extends plugin/m.test(app))
  ok('app 走取数层与归一化（不自己解析）', app.includes("from '../model/AkashaBoard.js'") && app.includes("from '../modules/akashaBoard.js'"))
  ok('app 对名次越界给可读提示', app.includes('这个榜单只有'))
  ok('app 两个视图各用一张模板', app.includes("respond(e, 'build'") && app.includes("respond(e, 'akasha-build'"))
  /*
   * 中文化门禁（2026-10-17 用户反馈「榜单里的英文要自动翻译、不要机翻」）：
   * 列表行的**武器与套装都必须用站点 textmap 给的官方中文名**（`nameCn`），不得用英文原字段 `name`
   * ——曾经的现场：武器是中文（帷间夜曲）、套装却是英文（Silken Moon's Serenade），只因这行写成了 `s.name`。
   */
  ok('列表行武器用中文名（weapon.nameCn）', /weaponText:[^\n]*weapon\.nameCn/.test(app))
  ok('列表行套装用中文名（nameCn）+ 共享的套装表述规则（setSummary）',
    /setsText:[\s\S]{0,120}nameCn/.test(app) && /setsText:[\s\S]{0,160}setSummary\(/.test(app))
  ok('详情页套装的投影函数与文本回退都取 nameCn',
    app.includes('setSummary') && readText(path.join(pluginRoot, 'src', 'modules', 'formatText.ts')).includes('nameCn'))
  ok('app 产物存在', fs.existsSync(path.join(libDir, 'apps', 'build.js')))
  ok('`#配装` 的 app 与产物都已删除',
    !fs.existsSync(path.join(pluginRoot, 'src', 'apps', 'akashaBuild.ts')) &&
    !fs.existsSync(path.join(libDir, 'apps', 'akashaBuild.js')))
  ok('两张模板都已就位并引用公共样式',
    ['build.html', 'akasha-build.html'].every(f =>
      readText(path.join(pluginRoot, 'resources', 'dps', f)).includes('{{_res_path}}/common/base.css')))
  ok('帮助页收录 `#练度榜 胡桃 3`（写名次=配装详情）',
    /#练度榜 胡桃 3/.test(readText(path.join(pluginRoot, 'resources', 'help', 'help-cfg.js'))))
}

// ---------- 6. 参数解析 `<角色> [名次]`（2026-10-16 合并后的唯一参数面） ----------
{
  const { parseBoardArgs: P } = await load('modules/akashaBoard.js')
  push('只给角色：无名次 → 列表视图', P('胡桃'), { names: ['胡桃'], rank: 1, rankGiven: false, sawNumericOnly: false })
  ok('写了名次 → 详情视图', P('胡桃 3').rankGiven === true && P('胡桃 3').rank === 3)
  ok('名次写法宽松（第2名 / 2位 / #2）', ['胡桃 第2名', '胡桃 2位', '胡桃 #2'].every(t => P(t).rank === 2 && P(t).rankGiven))
  ok('9 位 UID 不算名次：忽略并标记（app 据此静默）',
    P('胡桃 240247315').rank === 1 && !P('胡桃 240247315').rankGiven && P('胡桃 240247315').sawNumericOnly)
  ok('纯数字参数没有角色名', P('240247315').names.length === 0 && P('240247315').sawNumericOnly)
  ok('空参数：既无角色名也非纯数字（app 据此回用法）', P('').names.length === 0 && P('').sawNumericOnly === false)
  ok('超过 50 的名次不算名次（回落列表视图）', P('胡桃 51').rankGiven === false && P('胡桃 51').rank === 1)
}

// ---------- 7. 榜名与口径（2026-10-17：阿卡莎的榜不都是伤害） ----------
{
  /*
   * 现场（真实线上分类接口）：钟离默认榜是 `Shieldbot, Max HP`（数值 = 生命值上限）、
   * 克洛琳德是 `Aggravate Combo, DPS`、申鹤是 `Simulated Buff`、琴/心海是 `… balance formula`。
   * 所以标签必须由榜自己决定 —— 这组就是守着这件事。
   */
  const cats = [
    { index: 1, name: 'Shieldbot, Max HP', short: 'MAX HP', count: 1087667, details: '---' },
    { index: 2, name: 'Nuke Build, Burst Avg DMG', short: 'BURST', count: 1087667, details: '' },
    { index: 3, name: 'Hybrid Build, Burst DMG + HP balance formula', short: 'HYBRID', count: 1087667, details: 'QDMG + (HP-30000) * …' }
  ]
  const def = AB.pickDefaultCategory(cats)
  ok('默认榜 = index 最小的那个（= calculationId 的 id×100）', def?.index === 1 && def.name === 'Shieldbot, Max HP')
  push('无榜 / 脏数据 → null（页面退回"结果"）',
    [AB.pickDefaultCategory([]), AB.pickDefaultCategory(null), AB.pickDefaultCategory([{}])], [null, null, null])

  const label = (n) => AB.metricLabelOf({ index: 1, name: n, short: '', details: '', count: 1 })
  push('口径标签由榜名推（不写死「伤害」）', [
    label('Shieldbot, Max HP'),
    label('Aggravate Combo, DPS'),
    label('Lunar-Charged Team, Avg DMG'),
    label('Solo Combo, Avg. DMG'),
    label('Hybrid Build, Burst DMG + HP balance formula'),
    label('EQ + Heal + ER balance formula'),
    label('Simulated Buff'),
    label('Off-field Bloom Team 2H2D Damage Contribution'),
    label('C6 Lightfall Sword Explosion Crit DMG'),
    label('Swirl DMG'),
    label(''),
    label('Something Else')
  ], ['生命值上限', 'DPS', '平均伤害', '平均伤害', '平衡公式', '平衡公式', '模拟增益', '伤害贡献', '单次伤害', '扩散伤害', '结果', '公式结果'])
  ok('口径标签都 ≤5 个汉字（88px 标签列不折行）',
    ['Shieldbot, Max HP', 'Aggravate Combo, DPS', 'Hybrid Build, Burst DMG + HP balance formula',
      'EQ + Heal + ER balance formula', 'C6 Lightfall Sword Explosion Crit DMG', 'Unknown']
      .every(n => label(n).length <= 5))
}

const bad2 = report()
process.exit(bad2 ? 1 : 0)
