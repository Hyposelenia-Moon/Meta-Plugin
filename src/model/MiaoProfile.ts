/**
 * MiaoProfile — miao 面板薄桥（v3 P2）
 *
 * 职责：把 miao 的"玩家面板"适配成 `modules/grade.ts` 要的 `BuildSnapshot`，
 * 并把「账号从哪来」交给 miao（复用它的米游社绑定，命令里不写 UID）。
 *
 * 为什么是薄桥：miao 的内部结构会变（`models/Player`、`models/Character`、`ArtisMark`），
 * 全部耦合集中在本文件，改版只需改这里；评分器保持纯函数、可离线单测。
 *
 * 读取全部**防御式**：字段缺失/形状变化 → 返回 `ok: false` 或降级（绝不抛到消息层）。
 * 开发工作区没有 bot/miao 时，动态 import 会失败 → 同样走 `ok: false`（套件据此跳过）。
 */
import { ENKA_PROP_CN } from '../components/constants.js'
import { miaoPluginDir } from './MiaoPanel.js'
import type { BuildArtifact, BuildSnapshot } from '../modules/grade.js'
import { applyStatPatch } from '../modules/statPatch.js'

/** Enka/miao 的圣遗物顺序（`EnkaData.artisIdxMap` 与面板渲染都按这个次序） */
const SLOTS = ['生之花', '死之羽', '时之沙', '空之杯', '理之冠']

const UID_RE = /(?:^|\D)([1-9]\d{8})(?:\D|$)/

export interface ProfileResult {
  ok: true
  uid: string
  build: BuildSnapshot
  /** 数据来源与新鲜度说明（页面脚注用） */
  notes: string[]
}

export interface ProfileFailure {
  ok: false
  /** 给用户看的中文原因 */
  error: string
  /** 是不是"已经替我们提示过绑定"（miao 自己会回 #扫码登录 按钮） */
  prompted?: boolean
}

/** miao 动态 import 的 URL 工厂（与 MiaoPanel 同一手法：目录来自 miaoPluginDir） */
function miaoUrl (rel: string): string {
  const dir = miaoPluginDir()
  if (!dir) throw new Error('未找到 miao-plugin 目录')
  const sep = rel.includes('/') ? '/' : '\\'
  return `file:///${dir.replace(/\\/g, '/')}${sep === '/' ? '/' : '/'}${rel.replace(/\\/g, '/')}`
}

/** miao 的模型入口（`models/index.js` 导出 Player / Character / ArtisMark 等） */
async function miaoModels (): Promise<Record<string, any>> {
  const mod = await import(miaoUrl('models/index.js')) as Record<string, any>
  return (mod?.default && typeof mod.default === 'object') ? { ...mod.default, ...mod } : mod
}

/**
 * 解析本次要查的账号
 *
 * 顺序与 miao 一致：**事件里的 uid → 消息里的 10 位 UID → miao 的米游社绑定**。
 * 未绑定时 miao 会自己回 `#扫码登录` 按钮（我们据此返回 `prompted`，不再重复回复）。
 */
export async function resolveUid (e: YunzaiEvent, explicitUid = ''): Promise<{ uid: string, prompted?: boolean, error?: string }> {
  const given = String(explicitUid || '').trim()
  if (UID_RE.test(given)) return { uid: given.match(UID_RE)![1] }

  const fromEvent = String((e as unknown as { uid?: unknown }).uid || '')
  if (UID_RE.test(fromEvent)) return { uid: fromEvent.match(UID_RE)![1] }

  const fromMsg = String(e?.msg || '').match(UID_RE)
  if (fromMsg) return { uid: fromMsg[1] }

  // 交给 miao：它内部会处理"已绑定账号"，未绑定时回 #扫码登录
  try {
    const common = await import(miaoUrl('apps/profile/ProfileCommon.js')) as { getTargetUid?: (ev: unknown) => Promise<string | false> }
    if (typeof common.getTargetUid === 'function') {
      const uid = await common.getTargetUid(e)
      if (uid) return { uid: String(uid) }
      return { uid: '', prompted: (e as unknown as { _replyNeedUid?: boolean })._replyNeedUid === true, error: '没有可用的账号：请先让米游社绑定生效（miao 侧 `#扫码登录`）' }
    }
  } catch (err) {
    return { uid: '', error: `无法读取 miao 的账号绑定：${(err as Error)?.message || err}` }
  }
  return { uid: '', error: '没有可用的账号：请在命令里带上 10 位 UID，或先在 miao 侧绑定米游社' }
}

/** 从 miao 的天赋对象里取等级（兼容 `{level}` / `{original}` / 纯数字三种形状） */
function talentLevel (ds: unknown): number {
  if (typeof ds === 'number' && Number.isFinite(ds)) return ds
  const obj = ds as Record<string, unknown> | null
  for (const key of ['level', 'original', 'value']) {
    const v = Number(obj?.[key])
    if (Number.isFinite(v) && v > 0) return v
  }
  return 0
}

/** 圣遗物 → 契约（主词条取中文名，与攻略同口径） */
function artisOf (profile: Record<string, any>): BuildArtifact[] {
  const list = Array.isArray(profile?.artis) ? profile.artis : []
  return list.slice(0, 5).map((arti: Record<string, any>, idx: number) => {
    const mainKey = String(arti?.main?.key || '')
    return {
      slot: SLOTS[idx] || `部位${idx + 1}`,
      set: String(arti?.set || ''),
      mainName: ENKA_PROP_CN[mainKey] || mainKey,
      level: Number(arti?.level) || 0
    }
  })
}

/**
 * 读取某个角色的面板（没有本地缓存时让 miao 去取一次）
 *
 * @param e         消息事件（传给 miao 的绑定解析）
 * @param charName  角色名（支持别名，用**本插件**的索引解析，再交给 miao 取 id）
 * @param explicitUid 命令里显式写的 UID（可空）
 */
export async function readProfile (e: YunzaiEvent, charName: string, explicitUid = ''): Promise<ProfileResult | ProfileFailure> {
  if (!miaoPluginDir()) {
    return { ok: false, error: '未找到 miao-plugin（必需依赖）：请确认它已安装在 bot 的 plugins 目录' }
  }

  const resolved = await resolveUid(e, explicitUid)
  if (!resolved.uid) return { ok: false, error: resolved.error || '没有可用的账号', prompted: resolved.prompted }

  let models: Record<string, any>
  try {
    models = await miaoModels()
  } catch (err) {
    return { ok: false, error: `加载 miao 模型失败：${(err as Error)?.message || err}` }
  }

  const Player = models.Player
  const Character = models.Character
  if (!Player || !Character) return { ok: false, error: 'miao 模型缺少 Player / Character（版本不兼容？）' }

  // 角色：先用本插件索引解析（含别名），再交给 miao 拿 id
  const { findCharacter } = await import('./CharacterIndex.js')
  const local = findCharacter(charName)
  if (!local) return { ok: false, error: `没有找到角色「${charName}」` }
  const char = Character.get?.(local.name) || Character.get?.(charName)
  if (!char?.id) return { ok: false, error: `miao 里没有角色「${local.name}」` }

  try {
    const player = typeof Player.get === 'function'
      ? Player.get(resolved.uid)
      : Player.create({ uid: resolved.uid })
    if (!player) return { ok: false, error: `无法载入玩家 ${resolved.uid}` }

    let profile = player.getProfile?.(char.id)
    const notes: string[] = []
    if (!profile || profile.hasData === false) {
      notes.push('本地无面板缓存，已让 miao 取一次')
      if (typeof player.refresh === 'function') {
        await player.refresh({ profile: true })
        profile = player.getProfile?.(char.id)
      }
    }
    if (!profile || profile.hasData === false) {
      return { ok: false, error: `没有取到「${local.name}」的面板数据：该角色可能未在米游社公开展示，或取数失败（miao 里可先发一次 #面板 试试）` }
    }

    // 圣遗物评分：走 miao 的规则（评分依赖副词条，展示时只列主词条）
    let artiMark: BuildSnapshot['artiMark'] = null
    try {
      const ArtisMark = models.ArtisMark || (await import(miaoUrl('models/artis/ArtisMark.js'))).default
      const detail = ArtisMark?.getMarkDetail?.(profile, false)
      if (detail && Number.isFinite(Number(detail._mark))) {
        artiMark = { total: Number(detail._mark), markClass: String(detail.markClass || '') }
      }
    } catch { /* 评分失败不影响其它维度 */ }

    const build: BuildSnapshot = {
      charName: local.name,
      level: Number(profile.level) || 0,
      cons: Number(profile.cons) || 0,
      weapon: profile.weapon?.name
        ? { name: String(profile.weapon.name), affix: Number(profile.weapon.affix) || 0, rarity: Number(profile.weapon.rarity) || 0 }
        : null,
      talent: {
        A: talentLevel(profile.talent?.a),
        E: talentLevel(profile.talent?.e),
        Q: talentLevel(profile.talent?.q)
      },
      artis: artisOf(profile),
      artiMark,
      attrs: Object.fromEntries(
        Object.entries(profile.attr || {}).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])
      )
    }

    return { ok: true, uid: resolved.uid, build, notes }
  } catch (err) {
    return { ok: false, error: `读取 miao 面板出错：${(err as Error)?.message || err}` }
  }
}

/* ------------------------------------------------------------------ *
 * 整队读取（v3 P3 `#队伍伤害`）
 * ------------------------------------------------------------------ */

/** 单个队员的配装与关键伤害 */
export interface TeamMemberDamage {
  charName: string
  /** 角色星级（估算金数用） */
  rarity: number
  level: number
  cons: number
  weapon: { name: string, affix: number, rarity: number } | null
  talent: { A: number, E: number, Q: number }
  /** 关键伤害行（title + avg；治疗/护盾也在这里） */
  rows: Array<{ title: string, value: number }>
  /** 伤害规则来源：喵喵 / 组团伤害 / 自定义伤害 */
  ruleBy: string
  artiSets: string[]
  artiMark: { total: number, markClass: string } | null
}

export interface TeamDamageResult {
  ok: true
  uid: string
  members: TeamMemberDamage[]
  notes: string[]
}

/** 把 miao 的伤害行统一成 `{ title, value }`（helper 返回的是 `{ avg }`，防御式取第一个可用数值） */
function damageRowsOf (raw: unknown): Array<{ title: string, value: number }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ title: string, value: number }> = []
  for (const row of raw) {
    const ds = row as Record<string, unknown>
    const value = Number(ds?.avg ?? ds?.dmg ?? ds?.expect ?? ds?.value)
    const title = String(ds?.title ?? '').trim()
    if (!title || !Number.isFinite(value)) continue
    out.push({ title, value })
  }
  return out
}

/**
 * 读取整队的配装与关键伤害
 *
 * v1 口径（与 v3 方案 §5.5 对齐，差异见下）：
 *   - 每人的关键伤害走 miao 的 `avatar.calcDmg({ enemyLv: 103, mode: 'profile' })`，
 *     也就是**与 miao 面板/`#xx伤害` 同一套算法**；
 *   - 页面会标注每人的**伤害规则来源**（喵喵 / 组团伤害 / 自定义伤害）——
 *     "组团伤害"（跨角色 buff 叠加）由 miao 的系统配置 `teamCalc` 决定，本插件**不擅自改用户配置**：
 *     没开时提示"在 miao 侧开启组团伤害可让数值更贴近实战"。
 */
export interface TeamDamageOptions {
  /** 可调节词条：临时改面板属性后重算（不改用户 miao 配置） */
  patch?: { items: Array<{ attrKey: string, delta: number, name: string }>, invalid?: string[] }
}

export async function readTeamDamage (
  e: YunzaiEvent,
  names: string[],
  explicitUid = '',
  opts: TeamDamageOptions = {}
): Promise<TeamDamageResult | ProfileFailure> {
  const patch = opts.patch?.items?.length ? opts.patch : null
  if (!miaoPluginDir()) {
    return { ok: false, error: '未找到 miao-plugin（必需依赖）：请确认它已安装在 bot 的 plugins 目录' }
  }

  const resolved = await resolveUid(e, explicitUid)
  if (!resolved.uid) return { ok: false, error: resolved.error || '没有可用的账号', prompted: resolved.prompted }

  let models: Record<string, any>
  try {
    models = await miaoModels()
  } catch (err) {
    return { ok: false, error: `加载 miao 模型失败：${(err as Error)?.message || err}` }
  }
  const Player = models.Player
  const Character = models.Character
  if (!Player || !Character) return { ok: false, error: 'miao 模型缺少 Player / Character（版本不兼容？）' }

  const { findCharacter } = await import('./CharacterIndex.js')
  const notes: string[] = []
  const members: TeamMemberDamage[] = []

  try {
    const player = typeof Player.get === 'function' ? Player.get(resolved.uid) : Player.create({ uid: resolved.uid })
    if (!player) return { ok: false, error: `无法载入玩家 ${resolved.uid}` }

    for (const raw of names) {
      const local = findCharacter(raw)
      if (!local) return { ok: false, error: `没有找到角色「${raw}」` }
      const char = Character.get?.(local.name) || Character.get?.(raw)
      if (!char?.id) return { ok: false, error: `miao 里没有角色「${local.name}」` }

      let avatar = player.getAvatar?.(char.id, true)
      if (!avatar) return { ok: false, error: `没有取到「${local.name}」的面板数据：该角色可能未在米游社公开展示` }
      if (avatar.isProfile === false || avatar.hasData === false) {
        notes.push(`${local.name}：本地无面板缓存，已让 miao 取一次`)
        if (typeof player.refresh === 'function') {
          await player.refresh({ profile: true })
          avatar = player.getAvatar?.(char.id, true)
        }
      }
      if (!avatar || avatar.hasData === false || avatar.isProfile === false) {
        return { ok: false, error: `没有取到「${local.name}」的面板数据（未公开或取数失败）` }
      }

      // 伤害规则来源（喵喵 / 组团伤害 / 自定义）
      let ruleBy = ''
      try {
        const ProfileDmg = models.ProfileDmg || (await import(miaoUrl('models/ProfileDmg.js'))).default
        const rule = typeof ProfileDmg?.dmgRulePath === 'function' ? ProfileDmg.dmgRulePath(local.name) : null
        ruleBy = String(rule?.createdBy || '')
      } catch { /* 拿不到就不标注 */ }

      let dmgRaw: unknown = []
      if (patch) {
        // 有词条：按 miao `Avatar.calcDmg` 的同一份构造方式重建 ProfileDmg，只把 attr 换掉
        try {
          const ProfileDmg = models.ProfileDmg || (await import(miaoUrl('models/ProfileDmg.js'))).default
          const ds = avatar.getData('id,level,elem,attr,cons,artis:artis.sets,trees,uid') as Record<string, unknown>
          ds.talent = Object.fromEntries(Object.entries((avatar.talent || {}) as Record<string, unknown>)
            .map(([k, v]) => [k, Number((v as Record<string, unknown>)?.level) || 0]))
          ds.weapon = { name: avatar.weapon?.name, affix: avatar.weapon?.affix, level: avatar.weapon?.level }
          ds.attr = applyStatPatch((avatar.attr || {}) as Record<string, number>, patch as never)
          const dmg = new ProfileDmg(ds, 'gs')
          dmgRaw = await dmg.calcData({ enemyLv: 103, mode: 'profile' })
        } catch (err) {
          notes.push(`${local.name}：词条重算失败，已回退到原面板（${(err as Error)?.message || err}）`)
          if (typeof avatar.calcDmg === 'function') dmgRaw = await avatar.calcDmg({ enemyLv: 103, mode: 'profile' })
        }
      } else if (typeof avatar.calcDmg === 'function') {
        dmgRaw = await avatar.calcDmg({ enemyLv: 103, mode: 'profile' })
      }

      let artiMark: TeamMemberDamage['artiMark'] = null
      try {
        const detail = avatar.getArtisMark?.(false)
        if (detail && Number.isFinite(Number(detail._mark))) {
          artiMark = { total: Number(detail._mark), markClass: String(detail.markClass || '') }
        }
      } catch { /* 评分拿不到不影响伤害 */ }

      members.push({
        charName: local.name,
        rarity: Number(char.star ?? char.rarity) || 5,
        level: Number(avatar.level) || 0,
        cons: Number(avatar.cons) || 0,
        weapon: avatar.weapon?.name
          ? { name: String(avatar.weapon.name), affix: Number(avatar.weapon.affix) || 0, rarity: Number(avatar.weapon.rarity) || 0 }
          : null,
        talent: { A: talentLevel(avatar.talent?.a), E: talentLevel(avatar.talent?.e), Q: talentLevel(avatar.talent?.q) },
        rows: damageRowsOf(dmgRaw),
        ruleBy,
        artiSets: [...new Set((Array.isArray(avatar.artis) ? avatar.artis : []).map((a: Record<string, any>) => String(a?.set || '')).filter(Boolean))] as string[],
        artiMark
      })
    }
  } catch (err) {
    return { ok: false, error: `读取 miao 队伍数据出错：${(err as Error)?.message || err}` }
  }

  if (members.some(m => m.ruleBy && m.ruleBy !== '组团伤害')) {
    notes.push('队伍 buff：部分角色用的是 miao 的单人规则；在 miao 侧开启「组团伤害」（系统配置 teamCalc）后数值会更贴近实战')
  }
  if (patch) notes.push('本次伤害按你给的词条临时重算（未改动 miao 面板里的任何数据）')
  return { ok: true, uid: resolved.uid, members, notes }
}