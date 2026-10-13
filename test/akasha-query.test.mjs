/**
 * akasha 解析与视图（练度查询的数据层）
 *
 * 用脱敏 fixture 钉住：账号画像字段、名次 → top%、赛道（COMBO 等）、角色中文名走本插件的角色表、
 * 武器/套装名走 textmap、多赛道取最好名次、筛选与截断、缺失字段不崩。
 */
import { checker, installFrameworkStubs, loadFixture, mod, requireDeps, tempDataDir } from './_helper.mjs'
import path from 'node:path'

installFrameworkStubs()
requireDeps('yaml')

process.env.META_DATA_DIR = tempDataDir('akasha-query-data')
process.env.META_CONFIG_FILE = path.join(tempDataDir('akasha-query-config'), 'config.yaml')

const {
  readAccount,
  readAkashaChar,
  buildAkashaView,
  filterAkashaChars,
  collectNameWords,
  topPercentText,
  bigNumText
} = await import(mod('modules/akashaQuery.js'))
const { akashaText } = await import(mod('modules/formatText.js'))
const { findCharacter } = await import(mod('model/CharacterIndex.js'))

const { check, finish } = checker()

const account = loadFixture('akasha.account.sample.json').data.account
const calculations = loadFixture('akasha.calc.sample.json').data

// ---- 账号画像 ----
const p = readAccount(account)
check('昵称与 UID', p.nickname === '测试玩家' && p.uid === '100000000', `${p.nickname}/${p.uid}`)
check('冒险等阶取整（akasha 是 60.0000006639 这种浮点）', p.level === 60, String(p.level))
check('成就数与公开角色数', p.achievements === 1791 && p.owned === 6, `${p.achievements}/${p.owned}`)
check('深境螺旋读取', p.abyss.floor === 12 && p.abyss.chamber === 3 && p.abyss.stars === 36, JSON.stringify(p.abyss))
check('幻想真境剧诗读取', p.theater.stars === 12, JSON.stringify(p.theater))
check('幽境危战（akasha 排序用的就是它）', p.stygian.score === 6702 && p.stygian.seconds === 298, JSON.stringify(p.stygian))
check('缺失 playerInfo 不崩', readAccount({}).level === 0 && readAccount({}).uid === '')

// ---- 名次 / top% ----
check('top% 文本：1% 以内保留一位', topPercentText(8205, 1035102) === 'top 0.79%', topPercentText(8205, 1035102))
check('top% 文本：10% 以上取整', topPercentText(68274, 173119) === 'top 39%', topPercentText(68274, 173119))
check('top% 文本：无数据给 -', topPercentText(0, 0) === '-' && topPercentText(undefined, 5) === '-')
check('伤害数量级文本', bigNumText(1158161) === '115.8 万' && bigNumText(230000000) === '2.30 亿')

// ---- 单角色 ----
const translations = {
  'ballad of the fjords': '峡湾长歌',
  'gladiator\'s finale': '角斗士的终幕礼',
  'marechaussee hunter': '逐影猎人'
}
const hutao = readAkashaChar(calculations[0], translations)
check('角色 id → 本插件角色表的中文名（akasha 只给英文 Hu Tao）', hutao.id === '10000046' && hutao.name === '胡桃', `${hutao.id}/${hutao.name}`)
check('英文名保留备用', hutao.nameEn === 'Hu Tao', hutao.nameEn)
check('元素/稀有度来自本插件角色表', hutao.element === 'Pyro' && hutao.rarity === 5, `${hutao.element}/${hutao.rarity}`)
check('命座读取（fixture 里这只胡桃是 1 命）', hutao.constellation === 1, String(hutao.constellation))
check('主赛道：short/名次/top%/伤害', hutao.best?.short === 'COMBO' && hutao.best.ranking === 8205 && hutao.best.outOf === 1035102 && hutao.best.topText === 'top 0.79%' && Math.round(hutao.best.result) === 1158161, JSON.stringify({ short: hutao.best?.short, r: hutao.best?.ranking, d: Math.round(hutao.best?.result || 0) }))
check('武器名走 textmap 中文化', hutao.weapon.name === '峡湾长歌', hutao.weapon.name)
check('武器精炼与稀有度', hutao.weapon.refinement === 5 && hutao.weapon.rarity === 4, `${hutao.weapon.refinement}/${hutao.weapon.rarity}`)
check('套装按件数降序且已中文化', hutao.sets[0].name === '逐影猎人' && hutao.sets[0].count === 4 && hutao.sets[1].count === 1, JSON.stringify(hutao.sets.map(s => `${s.name}×${s.count}`)))

// 没有翻译时保留英文（不崩、不瞎猜）
const noTrans = readAkashaChar(calculations[0], {})
check('拿不到翻译时保留英文原名', noTrans.weapon.name === 'Ballad of the Fjords' && noTrans.sets[0].name === 'Gladiator\'s Finale' || noTrans.sets.some(s => /Gladiator|Marechaussee/.test(s.name)), noTrans.weapon.name)

// 缺字段 / 空对象
const empty = readAkashaChar({})
check('空角色数据不崩', empty.best === null && empty.sets.length === 0 && empty.weapon.refinement === 1, JSON.stringify(empty.weapon))

// ---- 多赛道取名次最好的一条 ----
const multi = readAkashaChar({
  characterId: 10000046,
  constellation: 0,
  calculations: {
    a: { short: 'vape', result: 1000, ranking: 500, outOf: 10000, weapon: { name: 'W1' } },
    b: { short: 'combo', result: 900, ranking: 20, outOf: 10000, weapon: { name: 'W2' } }
  }
})
check('多条赛道时取 top% 最好的那条', multi.best.short === 'COMBO' && multi.best.weapon.name === 'W2', JSON.stringify(multi.best))
check('所有赛道都保留在 variants 里', multi.variants.length === 2)

// ---- 视图组装 / 排序 / 截断 ----
const view = buildAkashaView({ uid: '100000000', account, calculations }, { translations })
check('视图含账号与角色', view.player.nickname === '测试玩家' && view.chars.length === 2, `${view.chars.length} 个角色`)
check('按 top% 升序（名次好的在前）', view.chars[0].id === '10000046', view.chars.map(c => c.id).join(','))
check('总数为收录角色数（截断前）', view.total === 2)
const capped = buildAkashaView({ account, calculations }, { max: 1 })
check('max 截断生效', capped.chars.length === 1 && capped.total === 2)

// ---- 角色筛选（与榜单同一套角色表 + 别名） ----
check('按正式名筛选', filterAkashaChars(view.chars, [findCharacter('胡桃')]).length === 1)
check('按别名筛选（桃）', filterAkashaChars(view.chars, [findCharacter('桃')]).map(c => c.name).join(',') === '胡桃')
check('筛不到时返回空', filterAkashaChars(view.chars, [findCharacter('夜兰')]).length === 0)
check('不传筛选词时原样返回', filterAkashaChars(view.chars, []).length === 2)

// ---- 需要中文化的词 ----
const words = collectNameWords(calculations)
check('收集武器与套装名', words.includes('Ballad of the Fjords') && words.some(w => /Gladiator|Marechaussee/.test(w)), words.join(' | '))
check('去重', new Set(words).size === words.length)

// ---- 文本回退 ----
const text = akashaText(view)
check('文本含账号与 UID', text.includes('测试玩家') && text.includes('UID 100000000'))
check('文本含名次与 top%', text.includes('COMBO') && text.includes('top 0.79%') && text.includes('8205/1035102'))
check('文本含武器与套装', text.includes('峡湾长歌') && text.includes('逐影猎人×4'))
check('文本标注数据源与口径差异', text.includes('akasha.cv') && text.includes('与本站 DPS 榜不同'))
check('空结果有兜底文案', akashaText({ player: readAccount({}), chars: [], total: 0 }).includes('没有该 UID 的角色练度记录'))

finish()
