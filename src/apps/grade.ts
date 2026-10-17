/**
 * `#练度查询 胡桃` —— 提升指南（v3 P2）
 *
 * 排版（2026-10-14 用户定稿）：三屏式 —— **结论 → 差在哪 → 怎么做**；
 * 权重与口径收进脚注，不再用四条进度条占版面；页头不显示 UID（账号走 miao 绑定）。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getGradePanelTiers, getGradeRankThresholds, getGradeWeights, getPluginConfig, getProxy } from '../components/config.js'
import { COPYRIGHT, COMMANDS, RULES } from '../components/constants.js'
import { botRoot } from '../dir.js'
import fs from 'node:fs'
import path from 'node:path'
import { buildPresentation, deltaTextOf, setSummary } from '../components/presentation.js'
import { extractTargets, gradeBuild } from '../modules/grade.js'
import { heroImageOf } from '../model/ProfileImgRes.js'
import type { CompareRow, GradeResult } from '../modules/grade.js'
import { readProfile } from '../model/MiaoProfile.js'
import { respond } from '../modules/respond.js'

// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js'
import { moduleGateReply } from '../modules/moduleGate.js'

/** 本 app 的命令元数据（见 components/constants.ts 的 COMMANDS） */
const META = COMMANDS.find(c => c.rules.includes('grade'))!

/**
 * 攻略目标版本（页面「计分口径」用）
 *
 * 取 `CodexStore.getSignature()` 里可复现的那几个字段拼成短标识；取不到就留空
 * → 页面写"版本未提供"（绝不编造日期或版本号）。
 */
function targetVersionOf (signature: Record<string, unknown> | null): string {
  if (!signature) return ''
  const parts = ['v', 'rev', 'hash', 'updatedAt', 'updated', 'mtime']
    .map(k => (signature[k] === undefined || signature[k] === null ? '' : String(signature[k])))
    .filter(Boolean)
  return parts.join('·')
}

/** 维度徽标：达标 / 百分比 / 不计分 / 未知（四态，2026-10-15 UI 契约） */
function badgeOf (label: string, ratio: number | null): { label: string, value: string, kind: string } {
  if (ratio === null) return { label, value: '不计分', kind: 'off' }
  const pct = Math.round(ratio * 100)
  return { label, value: pct >= 100 ? '达标' : `${pct}%`, kind: pct >= 100 ? 'ok' : pct >= 60 ? 'warn' : 'off' }
}

/** 文本回退（同样三屏式：结论 → 差在哪 → 怎么做）；四态与图片同源 */
export function gradeText (result: GradeResult, missRows: CompareRow[], okLine: string): string {
  const dimText = (d: GradeResult['dims'][number]): string => {
    if (d.state === 'unknown') return `${d.label} 未知`
    if (d.state === 'unscored') return `${d.label} 不计分`
    return `${d.label} ${Math.round((d.ratio || 0) * 100)}%`
  }
  const lines = [
    result.assessable
      ? `【${result.charName}】练度 ${result.rank}（${result.total} 分）`
      : `【${result.charName}】练度：无法评估（关键数据未取到）`,
    result.dims.map(dimText).join('｜'),
    '',
    '差在哪：'
  ]
  if (missRows.length) for (const r of missRows) lines.push(`  ${r.group} ${r.name}　${r.actual} → ${r.target}（${deltaTextOf(r)}）`)
  else lines.push('  全部达标')
  if (okLine) lines.push(`  已达标：${okLine}`)
  lines.push('', '怎么做：')
  result.suggestions.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`))
  if (result.notes.length) lines.push('', ...result.notes.map(n => `注：${n}`))
  return lines.join('\n')
}

export class MetaGrade extends plugin {
  constructor () {
    super({
      name: META.name,
      dsc: META.dsc,
      event: 'message',
      priority: getPluginConfig()?.priority
        ? Number(getPluginConfig().priority) + META.priorityOffset
        : 8000 + META.priorityOffset,
      rule: [
        { reg: RULES.grade, fnc: 'handleGrade', permission: META.permission }
      ]
    })
  }

  /** `#练度查询 胡桃 [面板图N]`（角色名必填；账号走 miao 的米游社绑定，UID 形态已移除） */
  async handleGrade (e: YunzaiEvent): Promise<boolean> {
    if (await moduleGateReply('grade', e)) return true
    const match = String(e.msg).match(RULES.grade) || []
    let raw = String(match[1] || '').replace(/\s+/g, ' ').trim()
    if (!raw) {
      await e.reply('[Meta] 用法：#练度查询 胡桃 [面板图N]（角色名走 miao 的米游社绑定，不写 UID）')
      return true
    }

    /*
     * `面板图N` —— **照抄 miao**（`apps/profile/ProfileDetail.js:26-35`）：
     * 它和角色名一样是空格分隔的独立 token，先摘出来（图库里的第 N 张，`N` 就是文件名里的 `_序号_`），
     * 后续的角色名判定就不受它影响。
     */
    let panelImgIdx = 0
    const imgRet = /(?:^|\s)面板图(\d+)(?:\s|$)/.exec(raw)
    if (imgRet) {
      const n = parseInt(imgRet[1], 10)
      if (n > 0) panelImgIdx = n
      raw = raw.replace(/\s*面板图\d+\s*/g, ' ').replace(/\s+/g, ' ').trim()
    }
    if (!raw) {
      await e.reply('[Meta] 用法：#练度查询 胡桃 [面板图N]（角色名走 miao 的米游社绑定，不写 UID）')
      return true
    }

    /*
     * 2026-10-15 用户定：本命令**只接角色名**，UID 形态属遗留问题、已移除。
     * 这里给一句改用提示（而不是把「胡桃 100000000」当角色名去查，回一句"没有找到角色"）。
     */
    const tokens = raw.split(' ').filter(Boolean)
    const uidToken = tokens.find(t => /^\d{9}$/.test(t))
    if (uidToken) {
      const name = tokens.filter(t => t !== uidToken).join(' ')
      await e.reply(
        `[Meta] #练度查询 只接角色名（账号走 miao 的米游社绑定，不写 UID）`
        + `${name ? `\n例：#练度查询 ${name}` : ''}`
      )
      return true
    }
    if (tokens.length > 1) {
      await e.reply(`[Meta] #练度查询 一次只接一个角色名（收到「${raw}」）\n例：#练度查询 ${tokens[0]}`)
      return true
    }

    const charName = tokens[0]

    const { codexStore } = await import('../model/CodexStore.js')
    const { buildCodexView } = await import('../modules/subViews.js')
    const guide = codexStore.getGuide(charName)
    if (!guide) {
      const { findCharacter, searchCharacters } = await import('../model/CharacterIndex.js')
      const hit = findCharacter(charName)
      const tips = (hit ? searchCharacters(hit.name, 5) : searchCharacters(charName, 5)).map(c => c.name)
      await e.reply(`[Meta] 没有找到角色「${charName}」` + (tips.length ? `\n你是不是想找：${tips.join('、')}` : ''))
      return true
    }

    const view = buildCodexView(guide, {
      signature: codexStore.getSignature(guide?.name || charName),
      weaponTags: codexStore.getWeaponTags()
    }) as unknown as Parameters<typeof extractTargets>[0]
    const targets = extractTargets(view, guide?.name || charName, guide as unknown as Parameters<typeof extractTargets>[2])

    const profile = await readProfile(e, targets.charName || charName)
    if (!profile.ok) {
      if (!profile.prompted) await e.reply(`[Meta] ${profile.error}`)
      return true
    }

    const weights = getGradeWeights()
    const result = gradeBuild(targets, profile.build, {
      weights: weights as never,
      panelTiers: getGradePanelTiers(),
      rankThresholds: getGradeRankThresholds()
    })

    /*
     * 面板行（2026-10-15 用户定：**只给 miao 面板里有的东西** —— 属性名 + 实际数值；
     * 达标程度 / 攻略目标这些是本插件自己的判断，面板区**不加**（用户明确要求，见"不要乱加"））
     */
    const PCT_KEYS = new Set(['cpct', 'cdmg', 'recharge', 'dmg', 'heal', 'phy'])
    const panelRows = ([
      ['hp', '生命值'], ['atk', '攻击力'], ['def', '防御力'], ['mastery', '元素精通'],
      ['cpct', '暴击率'], ['cdmg', '暴击伤害'], ['recharge', '元素充能'], ['dmg', '伤害加成']
    ] as Array<[string, string]>).map(([key, name]) => {
      const actual = Number(profile.build.attrs?.[key])
      const has = Number.isFinite(actual)
      // 优先用 miao 面板的同源文本（`attr[key]` / `attr[keyBase]` / `attr[keyPlus]`），缺失才自行格式化
      const text = profile.build.attrText || {}
      const weight = Number(profile.build.charWeight?.[key]) || 0
      return {
        key,
        name,
        value: text[key] || (has ? (PCT_KEYS.has(key) ? `${actual.toFixed(1)}%` : Math.round(actual).toLocaleString('en-US')) : '—'),
        base: text[`${key}Base`] || '',
        plus: text[`${key}Plus`] || '',
        weight,
        gold: weight >= 80
      }
    })

    /*
     * 命座图标行（miao 同款，2026-10-15 用户定）：贴立绘左下角，1..6 逐个显示，已解锁点亮、未解锁变暗。
     * 图标用 miao 的角色命座图（`meta-gs/character/{角色}/icons/cons-N.webp`）——**只引用不复制**；
     * 找不到该角色的图标时退化成圆点 + 序号（不报错）。
     */
    const MIAO_RES = '../../../../../plugins/miao-plugin/resources'
    const charDir = targets.charName || charName
    const cons = Number(profile.build.cons) || 0
    const consIcons = [1, 2, 3, 4, 5, 6].map(n => {
      const rel = `${MIAO_RES}/meta-gs/character/${charDir}/icons/cons-${n}.webp`
      const abs = path.join(botRoot, 'plugins', 'miao-plugin', 'resources', 'meta-gs', 'character', charDir, 'icons', `cons-${n}.webp`)
      return { n, icon: fs.existsSync(abs) ? rel : '', on: n <= cons }
    })

    /*
     * 天赋图标 —— **照抄 miao `models/character/CharImg.js:getImgs()` 的逻辑**：
     *
     *   imgs[t] = talentCons[t] > 0 ? imgs[`cons${talentCons[t]}`] : `${nPath}icons/talent-${t}.webp`
     *
     * 即：该天赋**被命座加成**（C3/C5 之类，`talentCons[t]` 给出对应命座号）时，miao 显示的是
     * **那个命座的图标**；否则才用天赋图标 `icons/talent-{a,e,q}.webp`。
     * `talentCons` 与 `nPath` 都从 miao 的角色数据 `meta-gs/character/{角色}/data.json` 读（只读）。
     * 文件名不存在时不渲染图标（只有等级数字 + 皇冠），避免出现空圈。
     */
    const miaoCharDir = path.join(botRoot, 'plugins', 'miao-plugin', 'resources', 'meta-gs', 'character', charDir)
    const miaoCharData = ((): { cons: Record<string, number>, weapon: string } => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(miaoCharDir, 'data.json'), 'utf8')) as { talentCons?: Record<string, number>, weapon?: string }
        return {
          cons: (raw.talentCons && typeof raw.talentCons === 'object') ? raw.talentCons : {},
          weapon: String(raw.weapon || '')
        }
      } catch { return { cons: {}, weapon: '' } }
    })()
    // 普攻图标取共享的武器类型图（miao 的 `imgs.a = /common/item/atk-${weaponType}.webp`）
    const ATK_TYPES = new Set(['sword', 'claymore', 'polearm', 'bow', 'catalyst'])
    const weaponSlug = ATK_TYPES.has(miaoCharData.weapon) ? miaoCharData.weapon : ''
    const talentIcons = ([['a', 'A', '普攻'], ['e', 'E', '战技'], ['q', 'Q', '爆发']] as Array<[string, 'A' | 'E' | 'Q', string]>)
      .map(([key, field, name]) => {
        const consNo = Number(miaoCharData.cons[key]) || 0
        // miao：普攻固定用武器类型图；e/q 被命座加成时用该命座的图，否则用天赋图
        const rel = key === 'a'
          ? (weaponSlug ? `${MIAO_RES}/common/item/atk-${weaponSlug}.webp` : '')
          : `${MIAO_RES}/meta-gs/character/${charDir}/icons/${consNo > 0 ? `cons-${consNo}` : `talent-${key}`}.webp`
        const abs = key === 'a'
          ? (weaponSlug ? path.join(botRoot, 'plugins', 'miao-plugin', 'resources', 'common', 'item', `atk-${weaponSlug}.webp`) : '')
          : path.join(miaoCharDir, 'icons', `${consNo > 0 ? `cons-${consNo}` : `talent-${key}`}.webp`)
        const level = Number(profile.build.talent?.[field]) || 0
        /*
         * 皇冠与 `talent-plus` 的判据**照抄 miao**（`profile-detail.html:31-32`）：
         *   `talent.level > talent.original` → `talent-plus`（被命座加成 → 深底金字）
         *   `talent.original >= 10`        → `talent-crown`（皇冠贴着图标圆环顶边）
         * `original` 取 miao 自己的值（拿不到时回落成"现等级 − 命座加成"这一 miao 的口径）。
         */
        const original = ((): number => {
          const fromMiao = Number(profile.build.talentOriginal?.[field])
          if (Number.isFinite(fromMiao) && fromMiao > 0) return fromMiao
          return consNo > 0 ? Math.max(0, level - 3) : level
        })()
        return {
          name,
          level,
          icon: (abs && fs.existsSync(abs)) ? rel : '',
          crown: original >= 10,
          plus: level > original
        }
      })

    // 当前配装明细（2026-10-15 用户定：武器 → 套装 + 评分/词条；天赋已移入立绘详情区，不列单件与伤害）
    const setCounts = new Map<string, number>()
    for (const a of profile.build.artis || []) setCounts.set(a.set, (setCounts.get(a.set) || 0) + 1)

    /*
     * 套装表述（用户定，规则见 `components/presentation.ts` 的 `setSummary`）：
     * 只写 **4 件套 / 2+2 / 2 件套**，不列散件；凑不出套装加成就写「散件」。
     */
    const setSummaryText = setSummary(
      [...setCounts.entries()].map(([name, count]) => ({ name, count }))
    )

    // 圣遗物行右侧：先 miao 圣遗物评分（总分保留 1 位小数 + 档位），再「词条数：N」（与 miao 面板同一口径）
    const artiMarkText = profile.build.artiMark
      ? `评分 ${Number(profile.build.artiMark.total).toFixed(1)} ${profile.build.artiMark.markClass}`
      : ''
    const rollsText = profile.build.substatRolls ? `词条数：${profile.build.substatRolls}` : ''

    const buildInfo = {
      level: `Lv.${profile.build.level}　${profile.build.cons}命`,
      levelText: String(profile.build.level || 0),
      consN: Number(profile.build.cons) || 0,
      weapon: profile.build.weapon
        ? `${profile.build.weapon.name}${profile.build.weapon.affix ? ` 精${profile.build.weapon.affix}` : ''}${profile.build.weapon.rarity ? `　${profile.build.weapon.rarity}★` : ''}`
        : '—',
      artis: setSummaryText,
      artiMark: artiMarkText,
      artiMarkClass: String(profile.build.artiMark?.markClass || '').toUpperCase(),
      rolls: rollsText
    }

    // 角色立绘（**图库 → miao 自带立绘**，顺序照抄 miao；降级不报错）
    /*
     * 彩蛋立绘判据 —— **照抄 miao**（`models/avatar/ProfileAvatar.js:68-77`）：
     * 满命（C6）/ 圣遗物评分 ACE·MAX / 三个天赋原始等级 101010，命中其一就走 `super-character` 层。
     */
    const talentTriple = (['A', 'E', 'Q'] as const)
      .map(k => Number(profile.build.talentOriginal?.[k]) || 0).join('')
    const isSuper = Number(profile.build.cons) === 6
      || ['ACE', 'MAX'].includes(String(profile.build.artiMark?.markClass || '').toUpperCase())
      || talentTriple === '101010'
    const hero = heroImageOf(charDir, { isSuper, index: panelImgIdx })

    /*
     * 参考 DPS（2026-10-15 用户定；2026-10-17 分档改为低金每 4 金一档 + `29-48 金`合并档）：
     * 以**当前金数所在的那一档**为起点、往后取 3 档（`≤4 金` → `5-8 金` → `9-12 金` …，到合并档就自然收敛）。
     *
     * "当前金数" = 该角色自身投入：角色 1 金 + 命座每级 1 金 + 5★ 武器 1 金（练度页只面对单个角色，
     * 拿不到整队金数）。每档取"含该角色"的**最高伤害**那条记录；榜单缓存不可用（未联网/无缓存）时这一块不渲染。
     */
    const ownCost = 1 + (Number(profile.build.cons) || 0) + (Number(profile.build.weapon?.rarity) >= 5 ? 1 : 0)
    const refDps: Array<{ label: string, damageText: string, teamText: string, video: string, chars: Array<{ name: string, avatar: string, constellation: number }> }> = []
    try {
      const { costBucketOf, costRangeOf, queryCharDps } = await import('../modules/charDpsQuery.js')
      const res = await queryCharDps(targets.charName || charName, {}, { proxy: getProxy(), downloadAvatars: true })
      if (res.ok) {
        const base = costBucketOf(ownCost)
        /*
         * 2026-10-17：高档位现在是「29-48 金」合并档 → `base+1 / base+2` 会指到同一个区间，
         * 用 `seen` 去重，避免同一档在参考区重复出现两次。
         */
        const seen = new Set<string>()
        for (const bucket of [base, base + 1, base + 2]) {
          const range = costRangeOf(bucket)
          const key = `${range.min}-${range.max}`
          if (seen.has(key)) continue
          seen.add(key)
          const tier = res.tiers.find(t => t.min === range.min && t.max === range.max)
          const row = tier?.rows?.[0]
          if (!row) continue
          refDps.push({
            label: tier!.label,
            damageText: row.damageText || (row.damage ? String(row.damage) : '—'),
            teamText: row.chars.map(c => `${c.name}${c.constellation ? `C${c.constellation}` : ''}`).join(' + '),
            video: row.video || '',
            chars: (row.chars || []).map(c => ({ name: c.name || '', avatar: c.avatar || '', constellation: Number(c.constellation) || 0 }))
          })
        }
      }
    } catch { /* 拿不到参考就不渲染该区块 */ }

    // 行分组：未达标（含缺数据）在前、已达标压成一行、命座单独提示
    // 「主词条」在 mysPanel 简版来源下拿不到 → 这种行不生成（比显示"无数据"更有信息量）
    const missRows = result.rows
      .filter(r => r.verdict === 'warn' || r.verdict === 'off')
      .filter(r => !(r.group === '主词条' && (r.verdict === 'off' || String(r.actual) === '—')))
      .map(r => ({ ...r, deltaText: deltaTextOf(r) }))
    const okRows = result.rows.filter(r => r.verdict === 'ok')
    const okLine = okRows.map(r => `${r.name}${r.group === '综合' ? ` ${r.actual}` : ''}`).join('、')
    // 关键命座：直接取攻略「命座」模块的目标序列（2026-10-15 用户定：表述为 `关键命座：2/6`，当前命座见「当前配装」的等级行）
    const consLine = targets.consKeys.length ? `关键命座：${targets.consKeys.join('/')}` : ''

    /*
     * 元素样式（照抄 miao `resources/common/layout/elem.html:15-16`）：
     * miao 把 `elem-{elem}` 加在 `<body>` 上，`common.css` 的 `.elem-{elem} .talent-icon`
     * 给天赋/命座图标铺那张**元素圆环底图**（`common/bg/talent-{elem}.webp`）——没有它，
     * 图标只剩中间那 46% 的白色图形、看不出是 miao 的图标（2026-10-15 用户反馈）。
     * 中文元素名（星铁侧）按 miao 的同一张表翻译，其余原样透传。
     */
    const ELEM_CLASS: Record<string, string> = {
      火: 'pyro', 冰: 'cryo', 风: 'anemo', 雷: 'electro', 量子: 'quantum', 虚数: 'geo', 物理: 'sr'
    }
    const elemClass = ELEM_CLASS[String(profile.build.elem || '')] || String(profile.build.elem || '') || 'hydro'

    /*
     * 展示层投影（2026-10-15 UI 重构「档案批注」）：四态、证据号、来源条、计分覆盖都从这一份出来。
     * 旧字段（dims/missRows/suggestions…）**全部保留**，文本回退与老模板继续可用。
     */
    const mx = buildPresentation({
      result,
      observedAt: Date.now(),
      targetVersion: targetVersionOf(codexStore.getSignature(guide?.name || charName)),
      source: profile.source
    })

    const data = {
      title: `#${result.charName} · 提升指南`,
      subtitle: '攻略目标 × 当前配装（面板数据来自 miao）',
      charName: result.charName,
      ranks: result.rank,
      rankClass: String(result.rank || '').toUpperCase(),
      total: result.total,
      dims: result.dims.map(d => ({
        label: d.label,
        pct: d.ratio === null ? 0 : Math.round(d.ratio * 100),
        pctText: d.ratio === null ? '不计分' : `${Math.round(d.ratio * 100)}%`
      })),
      missRows,
      consLine,
      suggestions: result.suggestions,
      buildInfo,
      panelRows,
      uidText: String(profile.uid || '').trim() || '—',
      consIcons,
      talentIcons,
      elemClass,
      heroImg: hero.rel,
      refDps,
      mx,
      assessable: result.assessable,
      notes: [...result.notes, ...profile.notes],
      copyright: COPYRIGHT
    }

    // 文本回落与图片**共用同一份说明**（来源与刷新限制不能只在图上出现）
    // 2026-10-15 外部复核第 6 项发现：这里漏了 `profile.notes`
    return await respond(e, 'grade', data, () => gradeText({ ...result, notes: data.notes }, missRows, okLine))
  }
}