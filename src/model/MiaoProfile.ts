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
import { isQueryNetworkEnabled, QUERY_NETWORK_OFF_HINT } from '../components/config.js'
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
 * 面板 8 行的显示文本 —— **照抄 miao `apps/profile/ProfileDetail.js:216-242`**
 *
 * miao 的面板文本不是"自己格式化一遍"，而是用它自己的 `Format.comma` / `Format.pct`：
 *   - `hp` 取整 + 千分位（分组位数读 miao 配置 `commaGroup`），其余三项保留 1 位小数；
 *   - 百分比四项走 `Format.pct`（1 位小数 + `%`）；`dmg` 在 `phy > dmg` 时改取物理伤害；
 *   - 每行还给 `{key}Base`（白字基础值）与 `{key}Plus`（绿字加成），面板第五列用。
 *
 * 直接调 miao 的 `Format`（而不是在本插件里再实现一份）才能保证**小数点位数、千分位分组、
 * 缺值形态**与面板逐字一致（2026-10-15 用户反馈：面板显示成了 `47268.265412357367` 这种原始浮点）。
 */
async function attrTextOf (profile: Record<string, any>): Promise<Record<string, string>> {
  try {
    const fmt = (await import(miaoUrl('components/Format.js'))).default as Record<string, any>
    const a = (profile.attr || {}) as Record<string, number>
    const base = (profile.base || {}) as Record<string, number>
    const attr: Record<string, string> = {}
    for (const key of ['hp', 'def', 'atk', 'mastery']) {
      const fn = (n: number): string => fmt.comma(n, key === 'hp' ? 0 : 1)
      attr[key] = fn(a[key])
      attr[`${key}Base`] = fn(base[key])
      attr[`${key}Plus`] = fn(a[key] - base[key])
    }
    for (const key of ['cpct', 'cdmg', 'recharge', 'dmg']) {
      // miao：物理伤害高于元素伤害时，`dmg` 这一行显示物理伤害
      const key2 = (key === 'dmg' && Number(a.phy) > Number(a.dmg)) ? 'phy' : key
      attr[key] = fmt.pct(a[key2])
      attr[`${key}Base`] = fmt.pct(base[key2])
      attr[`${key}Plus`] = fmt.pct(a[key2] - base[key2])
    }
    return attr
  } catch {
    return {}
  }
}

/**
 * 解析本次要查的账号
 *
 * 顺序：**事件里的 uid → miao 的米游社绑定**（命令里不再出现 UID，2026-10-14 用户定）。
 * 未绑定时 miao 会自己回 `#扫码登录` 按钮（我们据此返回 `prompted`，不再重复回复）。
 */
export async function resolveUid (e: YunzaiEvent, explicitUid = ''): Promise<{ uid: string, prompted?: boolean, error?: string }> {
  const given = String(explicitUid || '').trim()
  if (UID_RE.test(given)) return { uid: given.match(UID_RE)![1] }

  const fromEvent = String((e as unknown as { uid?: unknown }).uid || '')
  if (UID_RE.test(fromEvent)) return { uid: fromEvent.match(UID_RE)![1] }

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
  return { uid: '', error: '没有可用的账号：请先在 miao 侧绑定米游社（#扫码登录）' }
}

/** `mysArtis`（套装名 + 星级）→ 我们的 artis 形状，用于 `mysPanel` 简版面板 */
function artisFromMysArtis (avatar: Record<string, any> | null): Array<Record<string, any>> {
  const src = avatar?.mysArtis
  if (!src || typeof src !== 'object') return []
  return Object.keys(src).sort().map(k => {
    const a = (src as Record<string, any>)[k] || {}
    return { set: String(a.name || ''), level: Number(a.level) || 0, star: Number(a.star) || 0 }
  }).filter(a => a.set)
}
/** 脚注去重 + 最多 2 条 + 单条截断（miao 刷新失败这类噪音不再刷屏） */
function tidyNotes (notes: string[]): string[] {
  const out: string[] = []
  for (const raw of notes) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const short = text.length > 60 ? text.slice(0, 60) + '…' : text
    if (!out.includes(short)) out.push(short)
    if (out.length >= 2) break
  }
  return out
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

/**
 * 天赋**原始**等级（miao `talent.original`）
 *
 * miao 面板的皇冠判据（`original >= 10`）与 `talent-plus`（`level > original`）都用它；
 * miao 的 `Avatar.talent` 形如 `{level, original}`（`models/character/CharTalent.js:74`），
 * 取不到时才回落到现等级（等于"没有命座加成"，不会误判成加号）。
 */
function originalLevelOf (ds: unknown, level: number): number {
  const v = Number((ds as Record<string, unknown> | null)?.original)
  return (Number.isFinite(v) && v > 0) ? v : level
}

/**
 * miao 原生主词条 key → 中文（`ArtisMark.getKeyTitleMap('gs')`）
 *
 * ⚠ 原生键是 `hp` / `cpct` / `recharge` 这类，**不是 Enka 的 `FIGHT_PROP_*`**；
 *    `ENKA_PROP_CN` 只作兜底（Enka 来源的数据用得上）。
 */
function nativeKeyTitles (models: Record<string, any>): Record<string, string> {
  try {
    const map = models.ArtisMark?.getKeyTitleMap?.('gs')
    return map && typeof map === 'object' ? map as Record<string, string> : {}
  } catch {
    return {}
  }
}

/**
 * 读圣遗物明细：`Avatar.getArtisDetail()` / `artis.getDetail()` 返回**按部位 1..5 索引的对象**
 *
 * ⚠ 不要把 `avatar.artis` 当数组 —— 它是 miao 的 `Artis` 实例，`Array.isArray` 永远为假，
 *    会把完整明细误判成"没有明细"，进而退化成"只有套装名"（2026-10-15 外部复核第 1 项发现）。
 */
export function artisDetailOf (avatar: Record<string, any> | null | undefined): Record<string, any> {
  if (!avatar) return {}
  try {
    const direct = avatar.getArtisDetail?.(false)
    if (direct && typeof direct === 'object' && Object.keys(direct).length) return direct as Record<string, any>
  } catch { /* 换下一种读法 */ }
  try {
    const viaArtis = avatar.artis?.getDetail?.()
    if (viaArtis && typeof viaArtis === 'object') return viaArtis as Record<string, any>
  } catch { /* 没有明细 */ }
  return {}
}

/** miao 原生判定：这份面板的**词条是否完备**（`Artis.hasAttr`） */
export function artisHasAttr (avatar: Record<string, any> | null | undefined): boolean {
  try {
    return avatar?.artis?.hasAttr === true
  } catch {
    return false
  }
}

/** Artis 明细 → 契约行（1..5 部位；主词条取 miao 原生中文名） */
export function artisRowsOf (avatar: Record<string, any> | null | undefined, titles: Record<string, string>): BuildArtifact[] {
  const detail = artisDetailOf(avatar)
  const rows: BuildArtifact[] = []
  for (let idx = 1; idx <= 5; idx++) {
    const ds = (detail[idx] ?? detail[String(idx)]) as Record<string, any> | undefined
    if (!ds || (!ds.set && !ds.name)) continue
    const key = String(ds.main?.key || '')
    rows.push({
      slot: SLOTS[idx - 1] || `部位${idx}`,
      set: String(ds.set || ''),
      mainName: titles[key] || ENKA_PROP_CN[key] || String(ds.main?.title || key || ''),
      level: Number(ds.level) || 0
    })
  }
  return rows
}

/**
 * 只有套装信息时（`mysPanel` 简版）→ 按 `Artis.sets` 的**件数**展开
 *
 * ⚠ `sets` 是 `{ 套装名: 2|4 }`（miao 自己的统计，4 件以上记 4）；`names` 是去重后的套装名，
 *    用它计件会把 2+2 当成 5 件不同套装（2026-10-15 外部复核第 1 项发现）。
 */
export function setRowsOf (avatar: Record<string, any> | null | undefined): BuildArtifact[] {
  try {
    const sets = avatar?.artis?.sets
    if (!sets || typeof sets !== 'object') return []
    const rows: BuildArtifact[] = []
    for (const [set, rawCount] of Object.entries(sets as Record<string, unknown>)) {
      const count = Math.min(Number(rawCount) || 0, 4)
      for (let i = 0; i < count; i++) rows.push({ slot: '套装', set: String(set), mainName: '', level: 0 })
    }
    return rows
  } catch {
    return []
  }
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
    // miao 的刷新/取数流程靠 `player.e` 取数并回消息（miao 自己的命令里 player 就是 `Player.create(e)`）。
    // ⚠ 必须**无条件**覆盖：`Player.create({ uid })` 内部已经执行过 `player.e = e`（`models/Player.js`），
    //   把 e 设成了 `{ uid }` 这个普通对象 —— 它没有 `runtime`，miao `MysApi.init` 的首个判断
    //   `if (!e.runtime) return false` 会立即返回 false，随后 `ProfileReq.requestProfile` 抛
    //   `mys.getCharacter is not a function`（米游社通道必然 1ms 失败）；它也没有 `reply`，
    //   慢请求（>2s）时 miao 的定时器会抛 `this.e.reply is not a function`（2026-10-15 定位）
    if (player) (player as any).e = e
    if (!player) return { ok: false, error: `无法载入玩家 ${resolved.uid}` }

    /**
     * 取一次面板：按"最不容易踩到 miao 排行榜评分"的顺序尝试三条通道
     *
     * 起因：`player.refresh({profile:true})` 会顺带跑排行榜评分，其中 `ProfileRank.js`
     * 对某些数据形状会抛 `Cannot read properties of undefined (reading 'mark')`，
     * 且**崩在保存之前** → 刷新等于白跑。用户已绑米游社 ck 时，
     * `refreshMysDetail(2)`（无视缓存强制刷新米游社明细）能直接拿到完整面板且不走那条评分。
     */
    const notes: string[] = []
    const titles = nativeKeyTitles(models)
    const networkOn = isQueryNetworkEnabled()

    /**
     * 目标角色本人当前的面板状态
     *
     * ⚠ 完整性**只看目标角色**：`player.hasProfile` 是"账号里任意角色有面板"，
     *    拿它当成功条件会让"其他角色有面板 + 米游社这次失败"提前收工，跳过能补齐目标的通道
     *    （2026-10-15 外部复核第 2 项发现）。
     */
    const targetState = (): { avatar: Record<string, any> | null, rows: BuildArtifact[], attrOk: boolean, complete: boolean } => {
      const av = (player.getAvatar?.(char.id) as Record<string, any> | null) ?? null
      const rows = artisRowsOf(av, titles)
      const attrOk = artisHasAttr(av)
      const mainOk = rows.length >= 5 && rows.every(r => !!r.mainName)
      return {
        avatar: av,
        rows,
        attrOk,
        complete: av?.isProfile !== false && rows.length >= 5 && (attrOk || mainOk)
      }
    }

    const fetchPanel = async (reason: string): Promise<void> => {
      // miao 的三条刷新通道；**每试一条就重读目标并检查完整性**，只有拿到完整面板才算成功
      // 与 miao 的「米游社面板更新」同款：`refreshProfile(2, true)`（force=2 + fromMys=true）
      // 是 miao `ProfileList.refreshMys` 走的调用；`refresh({profile:true})` 是它的兜底
      // ⚠ 联网总开关：关闭时**不发任何远程请求**，只用本地缓存（2026-10-15 外部复核第 5 项发现）
      if (!networkOn) {
        notes.push(`${reason} → ${QUERY_NETWORK_OFF_HINT}：只读本地缓存，未发起远程刷新`)
        return
      }
      const channels: Array<[string, () => Promise<unknown>]> = [
        ['米游社更新面板', async () => await (player as any).refreshProfile?.(2, true)],
        ['通用刷新', async () => await (player as any).refresh?.({ profile: true })],
        ['米游社明细', async () => await (player as any).refreshMysDetail?.(2)]
      ]
      for (const [label, run] of channels) {
        try {
          await run()
          const got = player.getProfile?.(char.id)
          if (got) profile = got
          if (targetState().complete) {
            notes.push(`${reason} → 已用 miao「${label}」更新面板`)
            return
          }
          notes.push(`${reason} → miao「${label}」未取到目标角色的完整面板`)
        } catch (err) {
          notes.push(`miao「${label}」失败（${(err as Error)?.message || err}）`)
        }
      }
      notes.push(`${reason} → 三条通道都未取到目标角色的圣遗物明细（可在 miao 侧先发一次「米游社面板更新」）`)
    }
    let profile = player.getProfile?.(char.id)

    if (!profile || profile.hasData === false) {
      await fetchPanel('本地无面板缓存')
      profile = player.getProfile?.(char.id) || profile
    } else if (!targetState().complete) {
      await fetchPanel('本地面板数据不完整')
      profile = player.getProfile?.(char.id) || profile
    }
    if (!profile || profile.hasData === false) {
      return { ok: false, error: `没有取到「${local.name}」的面板数据：该角色可能未在米游社公开展示，或取数失败（miao 里可先发一次 #面板 试试）` }
    }
    // 圣遗物明细与评分都在 avatar 上（profile 上通常没有 artis）
    let avatar: Record<string, any> | null = null
    try {
      // 照抄 miao 自己的读法：`getAvatar(id)`（米游社来源 mys/mysPanel 优先，才有圣遗物明细）；
      // `getAvatar(id, true)` 会给到非米游社来源（缺 artis），只作兜底
      avatar = player.getAvatar?.(char.id) || player.getAvatar?.(char.id, true) || null
      // avatar 上没有圣遗物明细时，说明这份数据是简版（例如只带面板）→ 让 miao 重取一次再读
    } catch { /* 拿不到就回落 profile */ }

    // 圣遗物评分 + 词条当量总和：调**目标对象自己的** miao 访问器（评分依赖副词条；展示时只列主词条）
    let artiMark: BuildSnapshot['artiMark'] = null
    let substatRolls = 0
    /*
     * 属性权重（面板行的 `.weight` 小方块）：miao 把它挂在**带明细**的 `getArtisMark(true)` 上
     * （`ArtisMark.getMarkDetail` 仅在 `withDetail` 时给 `ret.charWeight`），
     * 所以从下面已经取到的那份 detail 里顺带拿走，不再单独读 `getArtisDetail()`（那里没有 charWeight）。
     */
    let charWeight: Record<string, number> = {}
    {
      const hasMain = (c: Record<string, any>): boolean => artisRowsOf(c, titles).some(r => !!r.mainName)
      const candidates = [targetState().avatar, player.getAvatar?.(char.id, true), avatar, profile]
        .filter((c): c is Record<string, any> => !!c && typeof c.getArtisMark === 'function' && hasMain(c))
      for (const candidate of candidates) {
        try {
          /*
           * `Avatar.getArtisMark(withDetail)` → `ArtisMark.getMarkDetail(this, withDetail)`
           *
           * ⚠ 这里要 `withDetail = true`：只有带明细时才能读到每件圣遗物 `attrs[]` 的 `eff`
           *   （miao 面板中间那列「12.9 爆伤 / 4.2 生命 …」就是它），它们的总和才是**词条当量数**；
           *   数 `attrs[]` 的条目数只会得到"每件 4 条 = 20 条"，与 miao 显示对不上（2026-10-15 用户反馈）。
           */
          const detail = candidate.getArtisMark?.(true)
          if (detail && Number.isFinite(Number(detail._mark))) {
            artiMark = { total: Number(detail._mark), markClass: String(detail.markClass || '') }
            /*
             * 只累加**有效词条**：`charWeight` 是 miao 给该角色的每条属性权重（`ArtisMarkCfg.getCfg` 的产物），
             * 权重为 0 的属性（例如胡桃的防御、丝柯克的生命/防御）算"无效词条"，不计入词条数
             * （2026-10-15 用户反馈：原来把无效词条也算进去了）。
             */
            const weights = (detail.charWeight && typeof detail.charWeight === 'object') ? detail.charWeight as Record<string, unknown> : null
            if (weights) charWeight = weights as Record<string, number>
            let sum = 0
            for (const idx of Object.keys(detail.artis || {})) {
              const attrs = detail.artis?.[idx]?.attrs
              if (!Array.isArray(attrs)) continue
              for (const a of attrs) {
                const eff = Number(a?.eff)
                if (!Number.isFinite(eff)) continue
                if (weights && !(Number(weights[String(a?.key ?? '')]) > 0)) continue
                sum += eff
              }
            }
            substatRolls = Number(sum.toFixed(1))
            break
          }
        } catch { /* 换下一个候选 */ }
      }
    }

    const build: BuildSnapshot = {
      charName: local.name,
      level: Number(avatar?.level ?? profile.level) || 0,
      cons: Number(avatar?.cons ?? profile.cons) || 0,
      weapon: profile.weapon?.name
        ? { name: String(profile.weapon.name), affix: Number(profile.weapon.affix) || 0, rarity: Number(profile.weapon.rarity) || 0 }
        : null,
      talent: {
        A: talentLevel(profile.talent?.a),
        E: talentLevel(profile.talent?.e),
        Q: talentLevel(profile.talent?.q)
      },
      /** 原始等级（miao `talent.original`）：皇冠（≥10）与 `talent-plus`（现等级 > 原始等级）的判据 */
      talentOriginal: {
        A: originalLevelOf(profile.talent?.a, talentLevel(profile.talent?.a)),
        E: originalLevelOf(profile.talent?.e, talentLevel(profile.talent?.e)),
        Q: originalLevelOf(profile.talent?.q, talentLevel(profile.talent?.q))
      },
      /** 元素（miao 用它在 `<body>` 上加 `elem-{elem}`，天赋/命座图标圆环按元素取图） */
      elem: String(char.elem || ''),
      /*
       * miao 面板行（`profile-detail.html:50-67`）用的两个原始映射，原样透出给页面：
       *   `attr`       数值文本（`hp` / `hpBase` / `hpPlus` …）→ 面板 `.value` 与 `.value2`
       *   `charWeight` 属性权重 → 面板 `.weight`（miao 的 `artisDetail.charWeight`，与有效词条过滤同源）
       */
      attrText: await attrTextOf(profile),
      charWeight,
      artis: ((): BuildSnapshot['artis'] => {
        const state = targetState()
        const av = (state.avatar || profile) as Record<string, any>
        // ① 完整明细（1..5 部位，含主词条）
        if (state.rows.length) return state.rows as BuildSnapshot['artis']
        // ② 只有套装信息 → 按 `Artis.sets` 的件数展开（**不是**去重后的 `names` 计件）
        const setRows = setRowsOf(av)
        if (setRows.length) return setRows as BuildSnapshot['artis']
        // ③ 最兜底：扫 `mysArtis` 原始数据（套装名 + 星级）
        return artisFromMysArtis(av || null) as BuildSnapshot['artis']
      })(),
      artiMark,
      /**
       * 有效词条数（2026-10-15 用户定：与 miao 面板一致，**无效词条不计**）
       *
       * = 五件圣遗物里，`charWeight[key] > 0` 的那些副词条 `eff`（miao 的"词条当量"）之和；
       * 权重取自 miao 的 `ArtisMark.getMarkDetail(true).charWeight`（按角色/武器给的有效属性表）。
       * 拿不到明细时为 0（页面不显示这一项）。
       */
      substatRolls,
      attrs: Object.fromEntries(
        Object.entries(profile.attr || {}).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])
      )
    }

    return { ok: true, uid: resolved.uid, build, notes: tidyNotes(notes) }
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

/**
 * miao 伤害结果 → 行
 *
 * ⚠ `Avatar.calcDmg({mode:'profile'})` / `ProfileDmg.calcData` 返回的是**对象**
 *   `{ ret, msg, msgList, dmgRet, … }`（`models/ProfileDmg.js`），`ret` 才是行数组，
 *   每行形如 `{ title, avg, … }`。只认数组会把有效伤害全部丢成空 → 参考 DPS 变 0
 *   （2026-10-15 四项目复核 P1）。
 */
export function damageRowsOf (raw: unknown): Array<{ title: string, value: number }> {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { ret?: unknown } | null)?.ret)
      ? (raw as { ret: unknown[] }).ret
      : []
  const out: Array<{ title: string, value: number }> = []
  for (const row of list) {
    const ds = row as Record<string, unknown>
    const value = Number(ds?.avg ?? ds?.dmg ?? ds?.expect ?? ds?.value)
    const title = String(ds?.title ?? '').trim()
    if (!title || !Number.isFinite(value)) continue
    out.push({ title, value })
  }
  return out
}

/**
 * 伤害结果的失败口径（用来区分"没有规则 / 算完没伤害 / 正常"）
 *
 * `no-rule` = miao 里没有该角色的伤害规则（`ret` 不是数组）；`empty` = 有规则但一行都没算出来。
 */
export function damageOutcome (raw: unknown): 'ok' | 'empty' | 'no-rule' {
  if (raw === null || raw === undefined) return 'no-rule'
  if (Array.isArray(raw)) return raw.length ? 'ok' : 'empty'
  if (typeof raw !== 'object') return 'no-rule'
  const ret = (raw as { ret?: unknown }).ret
  if (!Array.isArray(ret)) return 'no-rule'
  return ret.length ? 'ok' : 'empty'
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
    // 同 readProfile：必须**无条件**覆盖 `player.e` —— `Player.create({ uid })` 已把它设成 `{ uid }`
    // 这个普通对象（无 `runtime`/无 `reply`），会让 miao 的米游社通道直接失败（2026-10-15 定位）
    if (player) (player as any).e = e
    if (!player) return { ok: false, error: `无法载入玩家 ${resolved.uid}` }

    for (const raw of names) {
      const local = findCharacter(raw)
      if (!local) return { ok: false, error: `没有找到角色「${raw}」` }
      const char = Character.get?.(local.name) || Character.get?.(raw)
      if (!char?.id) return { ok: false, error: `miao 里没有角色「${local.name}」` }

      let avatar = player.getAvatar?.(char.id, true)
      if (!avatar) return { ok: false, error: `没有取到「${local.name}」的面板数据：该角色可能未在米游社公开展示` }
      if (avatar.isProfile === false || avatar.hasData === false) {
        // 联网总开关同样罩住这条刷新（2026-10-15 外部复核第 5 项发现：练度侧曾绕过开关）
        if (!isQueryNetworkEnabled()) {
          notes.push(`${local.name}：本地无面板缓存，且${QUERY_NETWORK_OFF_HINT} → 未发起远程刷新`)
        } else if (typeof player.refresh === 'function') {
          notes.push(`${local.name}：本地无面板缓存，已让 miao 取一次`)
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

      // 区分"没有伤害规则 / 算完没伤害 / 正常"，别把失败静默成 0 伤害
      const outcome = damageOutcome(dmgRaw)
      if (outcome !== 'ok') {
        notes.push(`${local.name}：${outcome === 'no-rule'
          ? 'miao 里没有该角色的伤害规则'
          : 'miao 计算成功但没有伤害行'}（伤害列留空）`)
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
        // ⚠ 同 readProfile：`avatar.artis` 是 `Artis` 实例，**不是数组**（`Array.isArray` 永远为假，
        //    套装列会一直空）；件数走 `.sets`，明细走 `getArtisDetail()`
        artiSets: [...new Set([
          ...setRowsOf(avatar).map(r => r.set),
          ...artisRowsOf(avatar, {}).map(r => r.set)
        ])].filter(Boolean) as string[],
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