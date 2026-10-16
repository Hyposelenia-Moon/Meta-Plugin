/**
 * 阿卡莎取值单位与请求参数（2026-10-15 四项目复核 P2）—— **行为层**
 *
 * 复核点：
 *  1. akasha `stats` 的比例键是 0~1（样本：`critRate 0.7933` / `critDamage 2.5784` / `energyRecharge 1`），
 *     而 miao 的 `Format.pct()` 只拼 `%` 不乘 100 → 会显示成 `0.8%`；
 *  2. 面板适配要把总值与基础值**分槽**（`atk` = 总攻击 2383.8，`atkBase` = 基础攻击 960.9），别拿 base 顶替总攻击；
 *  3. 批量翻译 URL 的重复参数必须都叫 `words[]`（原实现第二个起变成 `?words[]`，只能取到第一个词）；
 *  4. 配了代理就不能复用渲染后端那个"代理不可知"的浏览器。
 *
 * 夹具：`test/fixtures/akasha-board.sample.json`（真实抓取的 3 条榜单记录）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot } from './_helper.mjs'

const { ok, report } = createChecks('阿卡莎单位与请求参数（行为）')

const load = async (rel) => await import(pathToFileURL(path.join(libDir, ...rel.split('/'))).href)
const AB = await load('modules/akashaBoard.js')
const BoardModel = await load('model/AkashaBoard.js')
const MiaoPanel = await load('model/MiaoPanel.js')
const Browser = await load('model/AkashaBrowser.js')

const fixture = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'test', 'fixtures', 'akasha-board.sample.json'), 'utf8'))
const rawStats = fixture.rows[0].stats

// ---------- ① 比例键 ×100、平铺键千分位 ----------
{
  ok('① 比例键识别（含 `_` 变体与元素伤害加成）',
    AB.isAkashaRatioKey('critRate') && AB.isAkashaRatioKey('critRate_') && AB.isAkashaRatioKey('pyroDamageBonus') &&
    !AB.isAkashaRatioKey('maxHp') && !AB.isAkashaRatioKey('baseAtk'))
  ok('① 样本比例值换算成百分数（0.7933 → 79.3%）', AB.formatAkashaValue('critRate', 0.7933000120326369) === '79.3%')
  ok('① 超过 1 的比例照常换算（2.5784 → 257.8%）', AB.formatAkashaValue('critDamage', 2.578399993385324) === '257.8%')
  ok('① 1 → 100.0%（充能）', AB.formatAkashaValue('energyRecharge', 1) === '100.0%')
  ok('① 平铺值取整并加千分位（2383.79 → 2,384）', AB.formatAkashaValue('atk', 2383.7934078751755) === '2,384')
  ok('① 非法值给 `-`', AB.formatAkashaValue('atk', 'x') === '-')
}

// ---------- ② panelSummary 用真实样本出正确单位 ----------
{
  const { entries } = AB.normalizeBoard({ data: fixture.rows }, fixture.textmapSample || null)
  const summary = AB.panelSummary(entries[0])
  const at = (label) => summary.find(s => s.label === label)?.value
  ok('② 暴击率 = 79.3%', at('暴击率') === '79.3%', String(at('暴击率')))
  ok('② 暴击伤害 = 257.8%', at('暴击伤害') === '257.8%', String(at('暴击伤害')))
  // 标签逐字照抄 miao 属性表（`recharge: '元素充能'`）——6 字的旧标签会在 88px 标签列里折行
  ok('② 元素充能 = 100.0%', at('元素充能') === '100.0%', String(at('元素充能')))
  ok('② 攻击力用**总攻击**（约 2384，不是基础 961）', at('攻击力') === '2,384', String(at('攻击力')))
  ok('② 生命值用 maxHp（约 17,662）', at('生命值') === '17,662', String(at('生命值')))
}

// ---------- ③ MiaoPanel.akashaAttr：分槽 + 单位 ----------
{
  const fmt = {
    comma: (n, fix = 0) => Number(n).toFixed(fix),
    pct: (n, fix = 1) => `${Number(n).toFixed(fix)}%`
  }
  const attr = MiaoPanel.akashaAttr(rawStats, fmt)
  ok('③ 总攻击进 `atk`（2383.8），基础攻击进 `atkBase`（960.9）',
    attr.atk === '2383.8' && attr.atkBase === '960.9', JSON.stringify({ atk: attr.atk, atkBase: attr.atkBase }))
  ok('③ 总生命进 `hp`（maxHp，不再漏掉）', attr.hp === '17662.2', String(attr.hp))
  ok('③ 防御是平铺值（814.0，不带 %）', attr.def === '814.0', String(attr.def))
  ok('③ 比例键带 %（暴击率 79.3 / 暴击伤害 257.8 / 充能 100.0）',
    attr.cpct === '79.3%' && attr.cdmg === '257.8%' && attr.recharge === '100.0%',
    JSON.stringify({ cpct: attr.cpct, cdmg: attr.cdmg, recharge: attr.recharge }))
  ok('③ 元素精通是平铺值', attr.mastery === '35.0', String(attr.mastery))
  // 框架提供 `Format.percent` 时优先用它（它自带 ×100）
  const fmt2 = { comma: fmt.comma, pct: () => '不该走到这里', percent: (n) => `${(Number(n) * 100).toFixed(1)}%` }
  ok('③ 有 `Format.percent` 时优先使用', MiaoPanel.akashaAttr(rawStats, fmt2).cpct === '79.3%')
}

// ---------- ④ 批量翻译 URL 的重复参数 ----------
{
  const url = BoardModel.textmapUrl(['Varka', 'Skirk', 'Varka'])
  const parsed = new URL(url)
  const words = parsed.searchParams.getAll('words[]')
  ok('④ 三个词去重后剩两个，全部出现在 `words[]` 上', words.length === 2 && words.join(',') === 'varka,skirk', JSON.stringify(words))
  ok('④ URL 里不再出现第二个 `?`', !url.slice(url.indexOf('?') + 1).includes('?'), url)
  ok('④ 空输入不产生尾随 `?`', !BoardModel.textmapUrl([]).includes('?'))
}

// ---------- ⑤ 渲染后端浏览器的复用规则 ----------
{
  ok('⑤ 没配代理 → 可复用', Browser.canReuseRendererBrowser(true, '') === true)
  ok('⑤ 配了代理 → 不复用（它的代理不可知）', Browser.canReuseRendererBrowser(true, 'http://127.0.0.1:7890') === false)
  ok('⑤ 没有后端浏览器 → 谈不上复用', Browser.canReuseRendererBrowser(false, '') === false && Browser.canReuseRendererBrowser(false, 'http://x') === false)
}

const bad = report()
process.exit(bad ? 1 : 0)
