/**
 * `#练度查询 胡桃 [UID]` —— 提升指南（v3 P2）
 *
 * 把**攻略目标**与**当前配装**（miao 面板，账号走米游社绑定）合起来算：
 *   总体练度（四维加权 → MAX…D）＋ 面板三档（大毕业/毕业/小毕业）＋ 对比表 ＋ 提升建议
 *
 * 口径见 v3 方案 §4；评分器在 `modules/grade.ts`（纯函数），面板取数在 `model/MiaoProfile.ts`（薄桥）。
 * 旧 `#DPS练度查询`（akasha 名次面板）原样保留，两者互不影响。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getGradePanelTiers, getGradeRankThresholds, getGradeWeights, getPluginConfig } from '../components/config.js'
import { COPYRIGHT, ENTRY_COMMANDS, ENTRY_RULES } from '../components/constants.js'
import { extractTargets, gradeBuild } from '../modules/grade.js'
import type { GradeResult } from '../modules/grade.js'
import { readProfile } from '../model/MiaoProfile.js'
import { respond } from '../modules/respond.js'

// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js'

/** 本 app 的命令元数据（见 components/constants.ts 的 ENTRY_COMMANDS） */
const META = ENTRY_COMMANDS.find(c => c.rules.includes('grade'))!

/** 文本回退：总体档位 + 四维 + 前几条建议 */
export function gradeText (result: GradeResult, uid: string): string {
  const lines = [
    `【${result.charName}】练度：${result.rank}（${result.total} 分）　面板：${result.panelTier}`,
    `UID ${uid}`,
    ''
  ]
  for (const d of result.dims) {
    const ratio = d.ratio === null ? '不计分' : `${(d.ratio * 100).toFixed(0)}%（权重 ${(d.weight * 100).toFixed(0)}%）`
    lines.push(`· ${d.label}：${ratio} —— ${d.detail}`)
  }
  if (result.suggestions.length) {
    lines.push('', '提升建议：')
    result.suggestions.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`))
  }
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
        { reg: ENTRY_RULES.grade, fnc: 'handleGrade', permission: META.permission }
      ]
    })
  }

  /**
   * `#练度查询 胡桃 [UID]` —— 攻略 × 当前配装
   */
  async handleGrade (e: YunzaiEvent): Promise<boolean> {
    const match = String(e.msg).match(ENTRY_RULES.grade) || []
    const raw = (match[1] || '').trim()

    // 解析「角色名 [UID]」：UID 可选（10 位数字，缺省走 miao 的米游社绑定）
    const uidInText = raw.match(/(?:^|\s)([1-9]\d{8})(?:\s|$)/)
    const charName = raw.replace(/(?:^|\s)[1-9]\d{8}(?:\s|$)/, ' ').trim()

    if (!charName) {
      await e.reply('[Meta] 用法：#练度查询 胡桃（账号走 miao 的米游社绑定；也可在后面带 10 位 UID）')
      return true
    }

    // 攻略目标（缺攻略时明确告知，不静默出半张图）
    const { codexStore } = await import('../model/CodexStore.js')
    const { buildCodexView } = await import('../modules/subViews.js')
    const guide = codexStore.getGuide(charName)
    if (!guide) {
      const { findCharacter, searchCharacters } = await import('../model/CharacterIndex.js')
      const hit = findCharacter(charName)
      const tips = hit ? searchCharacters(hit.name, 5).map(c => c.name) : searchCharacters(charName, 5).map(c => c.name)
      await e.reply(`[Meta] 没有找到角色「${charName}」` + (tips.length ? `\n你是不是想找：${tips.join('、')}` : ''))
      return true
    }
    const view = buildCodexView(guide, {
      signature: codexStore.getSignature(guide?.name || charName),
      weaponTags: codexStore.getWeaponTags()
    }) as unknown as Parameters<typeof extractTargets>[0]
    const targets = extractTargets(view, guide?.name || charName)

    // 当前配装（miao 面板）
    const profile = await readProfile(e, targets.charName || charName, uidInText ? uidInText[1] : '')
    if (!profile.ok) {
      if (!profile.prompted) await e.reply(`[Meta] ${profile.error}`)
      return true
    }

    const result = gradeBuild(targets, profile.build, {
      weights: getGradeWeights() as never,
      panelTiers: getGradePanelTiers(),
      rankThresholds: getGradeRankThresholds()
    })

    const data = {
      title: `#${result.charName} · 提升指南`,
      subtitle: `总体练度 ${result.rank}（${result.total} 分）｜面板 ${result.panelTier}`,
      uid: profile.uid,
      ranks: result.rank,
      total: result.total,
      panelTier: result.panelTier,
      dims: result.dims.map(d => ({
        ...d,
        ratioPct: d.ratio === null ? 0 : Math.round(d.ratio * 100),
        ratioText: d.ratio === null ? '不计分' : `${(d.ratio * 100).toFixed(0)}%`,
        weightText: d.ratio === null ? '' : `权重 ${(d.weight * 100).toFixed(0)}%`
      })),
      rows: result.rows,
      groups: [...new Set(result.rows.map(r => r.group))],
      suggestions: result.suggestions,
      notes: [...result.notes, ...profile.notes],
      copyright: COPYRIGHT
    }

    return await respond(e, 'grade', data, () => gradeText(result, profile.uid))
  }
}
