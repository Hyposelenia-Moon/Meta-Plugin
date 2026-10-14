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

// ---------- 4. 命令正则：source/flags 逐字一致 ----------
{
  const bad = []
  for (const [key, literal] of Object.entries(snap.rules)) {
    const rule = C.DPS_RULES?.[key]
    if (!rule) {
      bad.push(`DPS_RULES.${key}: 缺失`)
      continue
    }
    if (String(rule) !== literal) bad.push(`DPS_RULES.${key}: 期望 ${literal}，实际 ${String(rule)}`)
  }
  push('8 条 #DPS… 命令正则与合并前逐字一致（含负向断言）', bad, [])
}

// ---------- 5. 路由真值表（含捕获参数） ----------
{
  const bad = []
  const badArgs = []
  for (const row of snap.routing) {
    const hit = C.matchDpsCommand(row.msg)
    const key = hit ? hit.key : null
    if (key !== row.key) bad.push(`${JSON.stringify(row.msg)}: 期望 ${row.key}，实际 ${key}`)
    else {
      const args = hit ? (hit.match[1] ?? null) : null
      if (args !== row.args) badArgs.push(`${JSON.stringify(row.msg)}: 期望参数 ${JSON.stringify(row.args)}，实际 ${JSON.stringify(args)}`)
    }
  }
  push(`路由真值表（${snap.routing.length} 条消息）命中与合并前一致`, bad, [])
  push('路由捕获到的参数与合并前一致', badArgs, [])
}

// ---------- 6. 与攻略命令互不干扰（合并边界） ----------
{
  const codexish = ['#攻略', '#攻略帮助', '#攻略说明', '#胡桃攻略', '#胡桃攻略2', '#攻略 胡桃 武器', '#攻略列表', '#攻略状态', '#设置默认攻略2']
  push('攻略类命令不会被 #DPS… 路由吞掉', codexish.filter(m => C.matchDpsCommand(m) !== null), [])
  const dpsish = ['#DPS榜', '#DPS危战榜', '#DPS状态', '#DPS帮助', '#DPS练度查询', '#DPS更新']
  push('攻略判定（isCodexCommand/isHelpCommand）不认领 #DPS… 命令',
    dpsish.filter(m => C.isCodexCommand(m) || C.isHelpCommand(m)), [])
}

const bad = report()
process.exit(bad ? 1 : 0)
