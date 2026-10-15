/**
 * `#DPS…` 命令元数据套件（阶段 4.1）
 *
 * 守三件事：
 *   1. **文案与正则一致**：`dsc` 里出现的每个命令（如 `#榜视频`）都必须真的被该 app 的某条正则命中
 *      —— 这条门禁正是为合并前那个 bug 立的（`dsc` 写 `#榜视频`，正则却是 `#视频`，
 *      照文案输入会被榜单规则吃成「榜单 + 参数『榜视频 3』」）。
 *   2. **视频文案已修正**（用户 2026-10-13 定）：只允许 `#视频` / `#危战视频`。
 *   3. **元数据与合并前一致**：名称 / 权限 / 优先级偏移逐条对照 Mhydps 的 `apps/*.js`。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir } from './_helper.mjs'

const { push, ok, report } = createChecks('#DPS 命令元数据（阶段 4.1）')

const C = await import(pathToFileURL(path.join(libDir, 'components', 'constants.js')).href)
const { COMMANDS, RULES, matchCommand } = C

// ---------- 1. 表结构 ----------
{
  const keys = COMMANDS.flatMap(c => c.rules)
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i)
  push('每条规则恰好归属一个 app', dup, [])
  push('规则表里的 8 条规则都有归属', Object.keys(RULES).filter(k => !keys.includes(k)), [])
}

// ---------- 2. 文案里的命令必须被自己的正则命中 ----------
{
  const bad = []
  for (const cmd of COMMANDS) {
    // 从文案里抠出 `#DPS…` 命令词（到空格或中文参数位为止）
    for (const m of cmd.dsc.matchAll(/#(?:dps|DPS)[\u4e00-\u9fa5]*/g)) {
      const token = m[0]
      const hit = cmd.rules.some(k => RULES[k].test(token))
      if (!hit) bad.push(`${cmd.name} 的文案写了 ${token}，但它自己的正则都不命中`)
    }
  }
  push('文案里的每个命令都能被该 app 的正则命中（合并前那个 bug 的护栏）', bad, [])
}

// ---------- 3. 视频文案已修正 ----------
{
  const videoCmd = COMMANDS.find(c => c.rules.includes('video'))
  ok('存在视频命令元数据', !!videoCmd)
  if (videoCmd) {
    // 2026-10-15 命令面重构：`#DPS视频` → `#视频`（= `#榜视频`），文案与正则都按新名
    ok('视频文案写的是 #视频 / #榜视频', videoCmd.dsc.includes('#视频') && videoCmd.dsc.includes('#榜视频'))
    ok('危战视频文案写的是 #危战视频', videoCmd.dsc.includes('#危战视频'))
    // 文案里出现的命令都要真能命中视频 app 的两条正则
    const tokens = [...videoCmd.dsc.matchAll(/#[^\s/（(]+/g)].map(m => m[0])
    push('视频文案里的命令全部命中视频 app 的正则', tokens.filter(t => !['video', 'raidVideo'].some(k => RULES[k].test(t))), [])
  }
  // 反向钉死：正则与既定口径逐字一致（`榜` 字可省）
  ok('RULES.video 是 #榜视频 / #视频（榜字可省）', String(RULES.video) === String(/^#?榜?视频\s*([\s\S]*)$/))
  ok('RULES.raidVideo 是 #危战视频', String(RULES.raidVideo) === String(/^#?危战视频\s*([\s\S]*)$/))
  ok('#榜视频 与 #视频 都归视频命令（不再是榜单参数）',
    matchCommand('#榜视频 3')?.key === 'video' && matchCommand('#视频 3')?.key === 'video')
}

// ---------- 4. 元数据口径（阶段 6 后：name 已改名为 Meta*；权限/偏移仍与合并前一致） ----------
{
  /**
   * 合并前 `apps/*.js` 的实际取值（从部署副本与工作区副本核对过，两份哈希一致）。
   *
   * ⚠ 阶段 6 收尾把框架 `name` 由 `Mhydps*` 改为 `Meta*`（用户 2026-10-13 定，属唯一允许的用户可见改名）；
   *    `permission` 与 `priorityOffset` **必须与合并前逐条一致** —— 它们是路由行为的一部分。
   *
   * ⚠ 2026-10-15 偏差 B17（用户定：命令面重构）：`raid`（旧危战榜 app）随旧榜废除、`build` 改名 `#练度榜`，
   *    其余各条的权限与优先级偏移不变；`charDps` 并入 `rank`。
   */
  const before = {
    rank: { name: 'MetaDPS榜', permission: 'all', priorityOffset: 0 },
    raidTiers: { name: 'Meta危战档位', permission: 'all', priorityOffset: -5 },
    build: { name: 'Meta练度榜', permission: 'all', priorityOffset: -50 },
    status: { name: 'Meta状态', permission: 'all', priorityOffset: -10 },
    video: { name: 'Meta视频查询', permission: 'all', priorityOffset: -100 },
    help: { name: 'Meta帮助', permission: 'all', priorityOffset: -10 },
    admin: { name: 'Meta数据管理', permission: 'master', priorityOffset: -10 }
  }
  const bad = []
  for (const [key, expected] of Object.entries(before)) {
    const cmd = COMMANDS.find(c => c.rules.includes(key))
    if (!cmd) { bad.push(`${key}: 元数据缺失`); continue }
    if (cmd.name !== expected.name) bad.push(`${key}.name: 期望 ${expected.name}，实际 ${cmd.name}`)
    if (cmd.permission !== expected.permission) bad.push(`${key}.permission: 期望 ${expected.permission}，实际 ${cmd.permission}`)
    if (cmd.priorityOffset !== expected.priorityOffset) bad.push(`${key}.priorityOffset: 期望 ${expected.priorityOffset}，实际 ${cmd.priorityOffset}`)
  }
  push('名称（Meta*）/ 权限 / 优先级偏移与既定口径一致', bad, [])
  // 合并前的判定顺序 = 按 priorityOffset 升序（video 最优先，rank 兜底）
  const order = [...COMMANDS].flatMap(c => c.rules.map(r => [r, c.priorityOffset]))
    .sort((a, b) => a[1] - b[1]).map(x => x[0])
  ok('优先级偏移递增顺序与路由判定顺序一致', order[0] === 'video' && order[order.length - 1] === 'rank')
}

const bad = report()
process.exit(bad ? 1 : 0)
