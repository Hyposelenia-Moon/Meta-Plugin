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
  ok('夹具标注了来源与抓取日期', typeof fixture.source === 'string' && /leaderboards/.test(fixture.source) && !!fixture.capturedAt)
}

const bad = report()
process.exit(bad ? 1 : 0)
