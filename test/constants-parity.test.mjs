/**
 * 常量与命令路由等价套件（阶段 4.1）
 *
 * 比对基准是**冻结快照** `test/fixtures/mhydps-constants.json`（由 `scripts/gen-mhydps-snapshot.mjs`
 * 在合并前从 Mhydps-Plugin 现场生成），所以：
 *   - 断言的是"与合并前逐字一致"，不是"与我手写的期望一致"；
 *   - Mhydps 仓库删除后本套件仍然有效（不依赖它的目录）。
 *
 * 覆盖四层：标量 → 对象 → 纯函数样例 → 命令正则与路由真值表（含捕获参数）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir, pluginRoot, stableStringify } from './_helper.mjs'

const { push, ok, report } = createChecks('Mhydps 常量与路由等价（阶段 4.1）')

const C = await import(pathToFileURL(path.join(libDir, 'components', 'constants.js')).href)
const fixture = path.join(pluginRoot, 'test', 'fixtures', 'mhydps-constants.json')
ok('冻结快照存在', fs.existsSync(fixture))
if (!fs.existsSync(fixture)) {
  report()
  process.exit(1)
}
const snap = JSON.parse(fs.readFileSync(fixture, 'utf8'))

// ---------- 1. 标量 ----------
{
  const bad = []
  for (const [key, expected] of Object.entries(snap.scalars)) {
    // 合并前叫 COPYRIGHT，合并后必须让位给攻略页的 COPYRIGHT → 重命名为 DPS_COPYRIGHT
    const actualKey = key === 'COPYRIGHT' ? 'DPS_COPYRIGHT' : key
    const actual = C[actualKey]
    // ⚠ **唯一**允许的用户可见差异（阶段 6 收尾改名，用户 2026-10-13 定）：
    //   自指文案里的插件名 `Mhydps-Plugin` → `Meta-Plugin`；其余字符必须逐字一致。
    const normalized = typeof actual === 'string' ? actual.replace('Meta-Plugin', 'Mhydps-Plugin') : actual
    if (normalized !== expected) bad.push(`${key}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
  push('标量常量与合并前逐字一致（仅允许自指插件名改名）', bad, [])
}

// ---------- 2. 对象 / 数组 ----------
{
  const bad = []
  for (const [key, expected] of Object.entries(snap.objects)) {
    const actual = C[key]
    if (stableStringify(actual) !== stableStringify(expected)) {
      bad.push(`${key}: 期望 ${stableStringify(expected)}，实际 ${stableStringify(actual)}`)
    }
  }
  push('对象型常量（映射表 / 顺序表 / 面板属性）与合并前一致', bad, [])
}

// ---------- 3. 纯函数样例 ----------
{
  const bad = []
  for (const [fn, cases] of Object.entries(snap.samples)) {
    if (typeof C[fn] !== 'function') {
      bad.push(`${fn}: 合并后不存在`)
      continue
    }
    for (const [input, expected] of cases) {
      const actual = C[fn](input)
      if (actual !== expected) bad.push(`${fn}(${JSON.stringify(input)}): 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
    }
  }
  push('纯函数（数量级 / 秒数 / 时间 / 头像 URL / 百分比判定）与合并前同输入同输出', bad, [])
}

// ---------- 4. 命令正则（偏差 B17：按用户 2026-10-15 决定重构命令面） ----------
/*
 * 偏差 B17（用户 2026-10-15 定，"指令大乱炖，全部重构"）：
 *   冻结面 `DPS_RULES` 的 8 条旧正则**整体废除**，命令面按功能重新命名 →
 *   `#DPS榜`(榜字可省) / `#练度榜` / `#危战 … n6|n7` / `#练度查询` / `#队伍伤害<N>` /
 *   `#meta状态` / `#榜单刷新` / `#DPS帮助`。
 *   视频名次没有独立命令：它是 `#DPS榜 … 视频N` / `#危战 … n6|n7 视频N` 的**后缀**
 *   （用户 2026-10-15 定：原 `#视频` / `#危战视频` 前缀式**废除**）。
 *   2026-10-16 追加：`#配装 胡桃 [名次]` 并入 `#练度榜 <角色> [名次]`（用户选"直接删除、不做别名"），
 *   故本节由 10 条正则减为 9 条。
 *   因此本节不再对照快照，而是断言**新表的形态**（旧名一条都不许复活）。
 */
{
  const bad = []
  const must = {
    rank: /^#?(?:dps|DPS)(?:榜(?!视频))?(?!榜|视频|帮助|状态|更新|强制|刷新|练度|危战)\s*([\s\S]*)$/,
    build: /^#?练度榜\s*([\s\S]*)$/,
    raidTiers: /^#?危战\s+([\s\S]*?)\s*(?:n|N)?([67])(?:档)?(?:\s*视频\s*(\d+))?\s*$/,
    raidTiersPrompt: /^#?危战\s+([\s\S]+)$/,
    grade: /^#?练度查询(?:\s+([\s\S]+))?$/,
    teamDamage: /^#?队伍伤害\s*(\d{1,2})?(?:\s+([\s\S]+))?$/,
    status: /^#?meta状态$/,
    admin: /^#?榜单刷新$/,
    help: /^#?(?:dps|DPS)帮助$/
  }
  for (const [key, expected] of Object.entries(must)) {
    const rule = C.RULES?.[key]
    if (!rule) { bad.push(`RULES.${key}: 缺失`); continue }
    if (String(rule) !== String(expected)) bad.push(`RULES.${key}: 期望 ${String(expected)}，实际 ${String(rule)}`)
  }
  push('新命令正则与既定口径逐字一致（9 条）', bad, [])
  push('视频前缀式规则已删除（没有 RULES.video / RULES.raidVideo）',
    ['video', 'raidVideo'].filter(k => C.RULES?.[k] !== undefined), [])
  push('合并不留旧规则（没有 RULES.akashaBuild）', ['akashaBuild'].filter(k => C.RULES?.[k] !== undefined), [])

  // 旧名一条都不许复活（用户："旧写法一律废除"）
  const dead = ['#DPS练度查询', '#DPS状态', '#DPS视频', '#DPS危战视频', '#DPS更新', '#DPS强制更新', '#DPS刷新', '#DPS危战榜', '#胡桃dps', '#DPS榜视频', '#视频 3', '#榜视频 3', '#危战视频 3', '#配装 胡桃 3']
  push('旧命令名一个都匹配不到（已废除）', dead.filter(m => C.matchCommand(m) !== null), [])

  // 只保留 `#DPS榜` / `#DPS` / `#DPS帮助` 三个 DPS 字样命令
  push('保留的 DPS 字样命令：榜/省榜/帮助',
    [C.matchCommand('#DPS榜')?.key, C.matchCommand('#DPS')?.key, C.matchCommand('#DPS帮助')?.key].join(','),
    'rank,rank,help')
}

// ---------- 5. 路由真值表（新命令面 + 与 miao 的边界） ----------
{
  const rows = [
    ['#DPS榜', 'rank', ''],
    ['#DPS', 'rank', ''],
    ['#DPS 胡桃 12金', 'rank', '胡桃 12金'],
    ['#练度榜 胡桃', 'build', '胡桃'],
    ['#DPS榜 刻晴 48金视频1', 'rank', '刻晴 48金视频1'],
    ['#危战 矮灵 n7 视频3', 'raidTiers', '矮灵'],
    ['#危战 矮灵 视频3', 'raidTiersPrompt', '矮灵 视频3'],
    ['#危战 矮灵 n7', 'raidTiers', '矮灵'],
    ['#危战 7.1 n6', 'raidTiers', '7.1'],
    ['#危战 n7', 'raidTiers', ''],
    ['#危战 矮灵', 'raidTiersPrompt', '矮灵'],
    ['#练度查询 胡桃', 'grade', '胡桃'],
    ['#队伍伤害2 胡桃 行秋 夜兰 钟离', 'teamDamage', '2'],
    ['#练度榜 胡桃 3', 'build', '胡桃 3'],
    ['#meta状态', 'status', undefined],
    ['#榜单刷新', 'admin', undefined],
    ['#DPS帮助', 'help', undefined]
  ]
  const bad = []
  for (const [msg, key, args] of rows) {
    const hit = C.matchCommand(msg)
    const got = hit ? hit.key : null
    if (got !== key) bad.push(`${JSON.stringify(msg)}: 期望 ${key}，实际 ${got}`)
    else if (args !== undefined) {
      const gotArgs = hit.match[1] ?? null
      if (gotArgs !== args) bad.push(`${JSON.stringify(msg)}: 期望参数 ${JSON.stringify(args)}，实际 ${JSON.stringify(gotArgs)}`)
    }
  }
  push(`新路由真值表（${rows.length} 条）`, bad, [])

  // 与 miao-plugin 的边界：裸 `#危战` 及其"数据/排名/单人"（无空格）形态必须**不**被我们认领
  const miao = ['#危战', '#危战数据', '#危战排名', '#危战单人', '#幽境危战']
  push('miao 的危战形态一条都不认领', miao.filter(m => C.matchCommand(m) !== null), [])
}

// ---------- 6. 与攻略命令互不干扰（合并边界） ----------
{
  const codexish = ['#攻略', '#攻略帮助', '#攻略说明', '#胡桃攻略', '#胡桃攻略2', '#攻略 胡桃 武器', '#攻略列表', '#攻略状态', '#设置默认攻略2']
  push('攻略类命令不会被 #DPS… 路由吞掉', codexish.filter(m => C.matchCommand(m) !== null), [])
  const dpsish = ['#DPS榜', '#危战 矮灵 n7', '#meta状态', '#DPS帮助', '#练度榜', '#榜单刷新']
  push('攻略判定（isCodexCommand/isHelpCommand）不认领 #DPS… 命令',
    dpsish.filter(m => C.isCodexCommand(m) || C.isHelpCommand(m)), [])
}

const bad = report()
process.exit(bad ? 1 : 0)
