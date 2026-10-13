/**
 * 角色索引：别名检索、立绘 id 映射、首领与版本表
 *
 * 覆盖点是「群友怎么叫，索引就得认」——站点角色表带别名（火神=玛薇卡、龟=神里绫华、爷=旅行者），
 * 榜单成员名混用别名是常态，索引认不出就会漏筛。
 */
import { checker, installFrameworkStubs, mod } from './_helper.mjs'

installFrameworkStubs()

const {
  findCharacter,
  searchCharacters,
  characterById,
  avatarIdOf,
  memberIs,
  elementCn,
  findBoss,
  bossById,
  bossesOfVer,
  versions,
  characters,
  bosses,
  resetCache
} = await import(mod('model/CharacterIndex.js'))

const { check, finish } = checker()

// ---- 角色表规模与结构 ----
const chars = characters()
check('角色表已加载', chars.length > 100, `${chars.length} 条`)
check('角色表字段完整', chars.every(c => c.name && c.character_id && c.element))
check('character_id 唯一', new Set(chars.map(c => c.character_id)).size === chars.length)

// ---- 别名检索 ----
check('官方名命中', findCharacter('胡桃')?.name === '胡桃')
check('别名命中（火神 → 玛薇卡）', findCharacter('火神')?.name === '玛薇卡')
check('别名命中（龟 → 神里绫华）', findCharacter('龟')?.name === '神里绫华')
check('别名命中（爷 → 旅行者）', findCharacter('爷')?.name === '旅行者')
check('英文别名命中（hutao → 胡桃）', findCharacter('hutao')?.name === '胡桃')
check('大小写不敏感（HUTAO）', findCharacter('HUTAO')?.name === '胡桃')
check('未知角色返回 null', findCharacter('不存在的角色') === null)
check('空关键词返回 null', findCharacter('') === null)

const cands = searchCharacters('神里', 5)
check('模糊检索给候选', cands.length >= 1 && cands.every(c => c.name.includes('神里')), cands.map(c => c.name).join('/'))

// ---- 立绘 id ----
check('avatarIdOf 官方名', avatarIdOf('胡桃') === '10000046')
check('avatarIdOf 别名', avatarIdOf('龟') === '10000002')
check('avatarIdOf 未知为空串', avatarIdOf('不存在的角色') === '')

// ---- 成员名匹配 ----
const traveler = findCharacter('旅行者')
const hutao = findCharacter('胡桃')
check('memberIs 认正式名', memberIs('旅行者', traveler))
check('memberIs 认别名', memberIs('爷', traveler))
check('memberIs 不误判', !memberIs('胡桃', traveler) && memberIs('胡桃', hutao))

// ---- 元素 ----
check('元素英文转中文', elementCn('Pyro') === '火' && elementCn('Anemo') === '风')
check('未知元素原样返回', elementCn('Unknown') === 'Unknown')

// ---- 首领与版本 ----
const bossList = bosses()
check('首领表已加载', bossList.length >= 30, `${bossList.length} 条`)
check('首领字段完整', bossList.every(b => b.id && b.name && b.ver))
check('bossById 命中', bossById(711)?.name === '矮灵雕刻师')
check('bossById 未命中为 null', bossById(999999) === null)
check('findBoss 精确命中', findBoss('矮灵雕刻师')?.id === 711)
check('findBoss 部分命中', findBoss('矮灵')?.id === 711)
check('findBoss 未命中为 null', findBoss('不存在首领') === null)

const vers = versions()
check('版本降序排列', vers[0] === '7.1' && vers[vers.length - 1] === '5.7', vers.join(','))
check('每期三个首领', bossesOfVer('7.1').length === 3, bossesOfVer('7.1').map(b => b.name).join('/'))
check('未知版本无首领', bossesOfVer('1.0').length === 0)

// ---- 缓存可重置（站点改版后重新读表的路径） ----
resetCache()
check('resetCache 后仍可重新加载', characters().length === chars.length)

finish()
