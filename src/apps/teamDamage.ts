/**
 * `#队伍伤害 胡桃 行秋 夜兰 钟离 [UID]` —— 队伍模拟内核的命令入口（2026-11-01 起替代旧的 miao 聚合）。
 *
 * 行为（用户 2026-11-01 定）：
 *   - 只认默认无轴：轴来自 `data/team-sim/rotations/` 里的录制文件，**没有轴就不给数字**；
 *   - 不再有内置序号轴与临时词条：`#队伍伤害2` 与 `词条:` 都会收到一句「已废除」；
 *   - 缺什么就说缺什么：动作数据、轴、永久数据三关各自点名，不拿 0 或猜测值顶上。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig } from '../components/config.js'
import { COMMANDS, RULES } from '../components/constants.js'
import { parseTeamArgs, rotationHelpText } from '../modules/teamDamage.js'
import { readTeamBuilds } from '../model/TeamBuildAdapter.js'
import { findRotation, loadPermanentData, loadRoster, loadTeamPack, toRotation } from '../model/TeamSimStore.js'
import {
  DPS_STANDARD,
  FRAME_TIERS,
  buildTeamRunReport,
  dpsWindowFrames,
  evaluateReleaseGate,
  formatTeamRunReport,
  simulateTeam,
  type CharacterBuild,
  type DataPack,
  type Issue,
  type TeamMemberInput
} from '../modules/teamSimulation/index.js'
import { moduleGateReply } from '../modules/moduleGate.js'

// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js'

/** 本 app 的命令元数据（见 components/constants.ts 的 COMMANDS） */
const META = COMMANDS.find(c => c.rules.includes('teamDamage'))!

/** 用法提示 */
function usage (): string {
  return [
    '[Meta] 用法：#队伍伤害 胡桃 行秋 夜兰 钟离 [UID]',
    '· 轴来自录制文件（data/team-sim/rotations/），没有轴就不给数字',
    '· 旧的 `#队伍伤害2` 序号轴与 `词条:` 写法已废除'
  ].join('\n')
}

/** issues → 每行一条，最多列 6 条，多的折成「还有 N 条」 */
function issueLines (issues: Issue[]): string {
  const lines = issues.slice(0, 6).map(i => `  · ${i.path}: ${i.message}`)
  if (issues.length > 6) lines.push(`  · …… 还有 ${issues.length - 6} 条`)
  return lines.join('\n')
}

export class MetaTeamDamage extends plugin {
  constructor () {
    super({
      name: META.name,
      dsc: META.dsc,
      event: 'message',
      priority: getPluginConfig()?.priority
        ? Number(getPluginConfig().priority) + META.priorityOffset
        : 8000 + META.priorityOffset,
      rule: [
        { reg: RULES.teamDamage, fnc: 'handleTeamDamage', permission: META.permission }
      ]
    })
  }

  /** `#队伍伤害 胡桃 行秋 夜兰 钟离 [UID]` —— 四人齐全才进管线 */
  async handleTeamDamage (e: YunzaiEvent): Promise<boolean> {
    if (await moduleGateReply('teamDamage', e)) return true
    const match = String(e.msg).match(RULES.teamDamage) || []
    const axisNo = (match[1] || '').trim()
    const { names, uid, patchTokens, legacyTokens } = parseTeamArgs(match[2] || '')

    if (legacyTokens.length) {
      await e.reply(`[Meta] 「轴:…」「词条:…」写法已废除（收到：${legacyTokens.join(' ')}）\n${usage()}`)
      return true
    }
    if (axisNo) {
      await e.reply(`[Meta] 内置序号轴已废除：轴改由录制文件提供，不再按序号取。\n${usage()}`)
      return true
    }
    if (names.length !== 4) {
      await e.reply(usage())
      return true
    }
    if (patchTokens.length) {
      await e.reply(`[Meta] 临时词条还没接进队伍模拟内核（收到：${patchTokens.join(' ')}），先只按当前面板计算。`)
      return true
    }

    // 1. 面板：只读 miao 的公开配装字段，不用最终面板反推
    const adapted = await readTeamBuilds(e, names, uid)
    if (adapted.status !== 'raw-complete') {
      await e.reply(`[Meta] 取配装失败（${adapted.status}）：\n${issueLines(adapted.issues)}`)
      return true
    }
    const builds = adapted.members
      .filter((m): m is Extract<typeof m, { status: 'raw-complete' }> => m.status === 'raw-complete')
      .map(m => m.build)
    if (builds.length !== 4) {
      await e.reply(`[Meta] 只取到 ${builds.length} 份可用配装，需要四份。\n${issueLines(adapted.issues)}`)
      return true
    }

    // 2. 动作数据：名录 → 四个包 → 合并
    const team = loadTeamPack(builds)
    if (team.status !== 'ok' || !team.pack) {
      await e.reply(`[Meta] 缺动作数据：\n${issueLines(team.issues)}`)
      return true
    }

    // 3. 轴：没有就明说，不给数字；有相近的轴就把「差谁」一起说清楚
    const found = findRotation(builds.map(b => b.characterId))
    if (!found.rotationFile) {
      const help = rotationHelpText({
        builds: builds.map(build => ({ actorId: build.actorId, characterId: build.characterId, name: build.name })),
        actions: Object.values(team.pack.actions ?? {}).map(action => ({ id: action.id, actorId: action.actorId, kind: action.kind })),
        nearby: found.nearby,
        rosterNames: Object.fromEntries(loadRoster().characters.map(entry => [entry.charId, entry.cn])),
        windowFrames: dpsWindowFrames(FRAME_TIERS['fps-60'])
      })
      await e.reply(`[Meta] ${help}${found.issues.length ? `\n${issueLines(found.issues)}` : ''}`)
      return true
    }
    const converted = toRotation(found.rotationFile, team.pack)
    if (!converted.rotation || converted.status !== 'ok') {
      await e.reply(`[Meta] 轴不可用（${converted.status}）：\n${issueLines(converted.issues)}`)
      return true
    }

    // 4. 永久数据：基础白值与效果，缺一个角色就整体不算
    const members: TeamMemberInput[] = []
    const missing: Issue[] = []
    for (const build of builds) {
      const { data, issue } = loadPermanentData(build)
      if (issue || !data) { if (issue) missing.push(issue); continue }
      members.push({ build: build as CharacterBuild, permanentData: data })
    }
    if (missing.length) {
      await e.reply(`[Meta] 缺永久数据：\n${issueLines(missing)}`)
      return true
    }

    // 5. 结算：标准口径（110 级小宝 / 10% 抗 / 120 秒 / 0 初始能量），暴击取期望
    const first = members[0].permanentData
    const expected = { gameVersion: first.gameVersion, bundleId: first.bundleId, source: first.source }
    const run = simulateTeam({
      pack: team.pack,
      rotation: converted.rotation,
      members,
      expected,
      targetPresetId: DPS_STANDARD.targetId,
      crit: 'expected',
      debuffs: { defenseReduction: 0, defenseIgnore: 0, resistanceReduction: 0 }
    })

    if (run.status !== 'calculated') {
      const last = run.checks[run.checks.length - 1]
      await e.reply(`[Meta] 模拟没有算出来（${run.status}）：\n${issueLines(last ? last.issues : [])}`)
      return true
    }

    const lines = formatTeamRunReport(buildTeamRunReport(run))
    /*
     * 2026-11-02 用户定：发布闸门先接成**警告**——数字照给，但没过的关必须写在结果里。
     * 等数据补齐后再改成硬拦截（blocked 时不出数字）。
     */
    const gate = evaluateReleaseGate({ result: run })
    const gateLines = gate.status === 'pass'
      ? []
      : [
          `未过发布闸门（${gate.status}）：以下数字仅供调试，不代表可发布结论`,
          ...gate.checks.filter(check => check.status !== 'pass').map(check => `  · ${check.id}：${check.detail}`)
        ]
    await e.reply(`[Meta] ${[...lines, ...(gateLines.length ? ['', ...gateLines] : [])].join('\n')}`)
    return true
  }
}
