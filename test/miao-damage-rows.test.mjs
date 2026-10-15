/**
 * miao 伤害结果读取契约（2026-10-15 四项目复核 P1）—— **行为层**
 *
 * 复核点：`Avatar.calcDmg({mode:'profile'})` / `ProfileDmg.calcData` 返回的是
 * `{ ret, msg, msgList, dmgRet, … }` **对象**（`models/ProfileDmg.js`），`ret` 才是行数组。
 * 原实现 `if (!Array.isArray(raw)) return []` 把有效伤害全部丢掉 → 队伍 DPS 变 0。
 *
 * 这里用假结果驱动编译产物里的纯函数；同时守住"三种失败口径要能分开"。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, libDir } from './_helper.mjs'

const { ok, report } = createChecks('miao 伤害结果契约（行为）')

const MP = await import(pathToFileURL(path.join(libDir, 'model', 'MiaoProfile.js')).href)
const { damageRowsOf, damageOutcome } = MP

/** miao `ProfileDmg.calcData({mode:'profile'})` 的真实返回形状 */
const retObject = (rows) => ({
  ret: rows,
  msg: '示例 buff 说明',
  msgList: ['示例 buff 说明'],
  dmgRet: [],
  enemyName: '遗迹守卫',
  dmgCfg: {},
  enemyLv: 103,
  createdBy: '喵喵'
})

// ---------- ① 对象里的 `ret` 必须被读出来 ----------
{
  const raw = retObject([
    { title: '重击蒸发', avg: 120000, dmg: 118000 },
    { title: '元素爆发', avg: 80000 }
  ])
  const rows = damageRowsOf(raw)
  ok('① `{ ret: [...] }` 读出两行（原实现返回空数组）', rows.length === 2, JSON.stringify(rows))
  ok('① 取 `avg` 作为数值、`title` 作为标题', rows[0].title === '重击蒸发' && rows[0].value === 120000)
  ok('① 无 `avg` 时回落 `dmg`', damageRowsOf(retObject([{ title: 'x', dmg: 500 }]))[0].value === 500)
}

// ---------- ② 兼容旧的数组形态 ----------
{
  const rows = damageRowsOf([{ title: '普攻', avg: 1000 }, { title: '', avg: 999 }, { title: '无效', avg: 'x' }])
  ok('② 数组形态照常可用，且丢掉无标题/非数值行', rows.length === 1 && rows[0].title === '普攻', JSON.stringify(rows))
}

// ---------- ③ 三种失败口径要能分开 ----------
{
  ok('③ 正常结果 → ok', damageOutcome(retObject([{ title: 'a', avg: 1 }])) === 'ok')
  ok('③ 有规则但没算出行 → empty', damageOutcome(retObject([])) === 'empty')
  ok('③ 没有规则（没有 `ret`）→ no-rule', damageOutcome({ msg: 'x' }) === 'no-rule' && damageOutcome(undefined) === 'no-rule')
  ok('③ 空数组等同于 empty', damageOutcome([]) === 'empty')
}

// ---------- ④ 队伍读取不再产生空 rows ----------
{
  const rows = damageRowsOf(retObject([{ title: '重击', avg: 120000 }]))
  const dps = rows.reduce((s, r) => s + r.value, 0) / 20   // 默认 20 秒轴
  ok('④ 单条 avg=120000、20 秒轴 → 6000（不再是 0）', dps === 6000, String(dps))
}

const bad = report()
process.exit(bad ? 1 : 0)
