/**
 * miao 圣遗物对象契约（2026-10-15 外部复核第 1/2 项）—— **行为层**
 *
 * 复核点：`Avatar.artis` 是 miao 的 `Artis` **实例**（`getDetail()` 按部位 1..5 索引），不是数组；
 * 只有套装信息时**件数在 `.sets`**（`{套装名: 2|4}`），不是去重后的 `.names`。
 * 用 `Array.isArray` / `names` 计件会导致：完整明细被丢、2+2 被当成 5 件不同套装。
 *
 * 做法：用**假 Artis 形状**驱动编译产物里的纯读取函数，不需要 bot 与 miao 安装。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createChecks, pluginRoot } from './_helper.mjs'

const { ok, report } = createChecks('miao 圣遗物对象契约（行为）')

const mod = await import(pathToFileURL(path.join(pluginRoot, 'lib', 'model', 'MiaoProfile.js')).href)
const { artisRowsOf, setRowsOf, artisHasAttr, artisDetailOf } = mod

/** miao 原生主词条键 → 中文（真实映射来自 `ArtisMark.getKeyTitleMap('gs')`） */
const TITLES = { cpct: '暴击率', cdmg: '暴击伤害', recharge: '元素充能效率', hp: '生命值' }

/** 造一个"像 miao `Artis` 实例"的假对象：只有方法与 `sets`，没有数组 */
function fakeAvatar ({ detail = {}, sets = {}, hasAttr = false, isProfile = true } = {}) {
  return {
    isProfile,
    getArtisDetail: () => detail,
    artis: {
      getDetail: () => detail,
      sets,
      hasAttr
    }
  }
}

// ---------- ① 完整明细：1..5 部位 ----------
{
  const detail = {
    1: { set: '晨星与月的晓歌', name: '晨星之冠', level: 20, main: { key: 'hp' } },
    2: { set: '晨星与月的晓歌', name: '晨星之羽', level: 20, main: { key: 'cpct' } },
    3: { set: '晨星与月的晓歌', name: '晨星之沙', level: 16, main: { key: 'recharge' } },
    4: { set: '晨星与月的晓歌', name: '晨星之杯', level: 20, main: { key: 'hp' } },
    5: { set: '晨星与月的晓歌', name: '晨星之冕', level: 20, main: { key: 'cdmg' } }
  }
  const rows = artisRowsOf(fakeAvatar({ detail, hasAttr: true }), TITLES)
  ok('① 五部位明细读成 5 行', rows.length === 5)
  ok('① 部位顺序固定（生之花…理之冠）', rows.map(r => r.slot).join(',') === '生之花,死之羽,时之沙,空之杯,理之冠')
  ok('① 主词条用 miao 原生键映射中文（不是 FIGHT_PROP_*）', rows[1].mainName === '暴击率' && rows[4].mainName === '暴击伤害')
  ok('① 套装名与等级保留', rows[0].set === '晨星与月的晓歌' && rows[2].level === 16)
  ok('① 词条完备走 `artis.hasAttr`', artisHasAttr(fakeAvatar({ hasAttr: true })) === true && artisHasAttr(fakeAvatar({ hasAttr: false })) === false)
}

// ---------- ② 旧写法（把 artis 当数组）不再被采纳 ----------
{
  const legacy = { artis: [{ set: 'A', main: { key: 'hp' } }], isProfile: true }
  ok('② 数组形状读不出明细（不再靠 Array.isArray）', artisRowsOf(legacy, TITLES).length === 0)
  ok('② artis 缺失 / getDetail 抛错都不抛到调用方',
    artisRowsOf(null, TITLES).length === 0 &&
    Object.keys(artisDetailOf({ artis: { getDetail: () => { throw new Error('boom') } } })).length === 0)
}

// ---------- ③ 只有套装信息：按 `.sets` 件数展开 ----------
{
  const rows = setRowsOf(fakeAvatar({ sets: { 晨星与月的晓歌: 4, 纺月的夜歌: 2 } }))
  const counts = rows.reduce((m, r) => { m[r.set] = (m[r.set] || 0) + 1; return m }, {})
  ok('③ 4+2 展开成 4 件 + 2 件（2+2 不会被当成 5 件）',
    rows.length === 6 && counts['晨星与月的晓歌'] === 4 && counts['纺月的夜歌'] === 2)
  ok('③ 件数封顶 4（miao `sets` 的口径）', setRowsOf(fakeAvatar({ sets: { X: 9 } })).length === 4)
  ok('③ 没有 sets 时不产出行', setRowsOf(fakeAvatar({})).length === 0)
}

const bad = report()
process.exit(bad ? 1 : 0)
