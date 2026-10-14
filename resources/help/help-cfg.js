/**
 * Meta-Plugin 帮助配置（2026-10-14：两小一大 · 总菜单导航化）
 *
 * 结构思路：**总菜单管导航**（常用入口 + 数据维护 + 两个分菜单入口），
 * **分菜单管一个主题的完整写法**（攻略练度 / 伤害榜单），互不重复铺内容。
 *
 * - `#meta`      常用指令 + 数据与维护 + 进阶入口（4 组）
 * - `#攻略帮助`  角色攻略 + 练度与配装 + 收录（3 组）
 * - `#DPS帮助`   伤害 + 榜单与配装（2 组）
 *
 * 每项**只有 title / desc 两个字段**；门禁在 `test/dps-help-config.test.mjs`：
 * 主菜单 10~24 字、分菜单 ≤30 字、分组标题不以「看 / 我的」开头且 ≤8 字、每组 ≤8 条、标题唯一。
 *
 * apps/help.ts 用动态 import 读本文件，改完无需重启 bot。
 */

/* ================= 总菜单（#meta） ================= */

const metaRole = {
  group: '角色与练度',
  list: [
    { title: '#胡桃攻略', desc: '角色攻略总页（六模块一图）' },
    { title: '#练度查询 胡桃', desc: '攻略目标 × 当前配装 → 练度档位与建议' }
  ]
}

const metaDamage = {
  group: '伤害与榜单',
  list: [
    { title: '#胡桃dps', desc: '该角色各金档的最高伤害队伍' },
    { title: '#危战', desc: '幽境危战 n6 / n7 两档成绩' },
    { title: '#队伍伤害 四人名', desc: '整队关键伤害 + 参考 DPS（同阵容对照）' },
    { title: '#DPS榜', desc: 'DPS 配队总榜，可按角色 / 金数筛' }
  ]
}

const metaStatus = {
  group: '数据与维护',
  list: [
    { title: '#攻略状态', desc: '数据版本、收录数与缓存情况' },
    { title: '#DPS更新', desc: '立即刷新榜单缓存（仅主人）' },
    { title: '#更新Meta-Plugin', desc: '更新本插件（#更新Meta，可加强制）' }
  ]
}

const metaMore = {
  group: '进阶与帮助',
  list: [
    { title: '#攻略帮助', desc: '攻略与练度的完整写法' },
    { title: '#DPS帮助', desc: '伤害与榜单的完整写法' },
  ]
}

export const helpCfg = {
  title: '#Meta 帮助',
  subTitle: 'Meta-Plugin · 常用指令与导航',
  note: '完整写法在 #攻略帮助 与 #DPS帮助。'
}
export const helpList = [metaRole, metaDamage, metaStatus, metaMore]

/* ================= 分菜单①（#攻略帮助） ================= */

const guideCore = {
  group: '角色攻略',
  list: [
    { title: '#胡桃攻略', desc: '角色攻略总页：六模块一图（含配队）' },
  ]
}

const guideGrade = {
  group: '练度与配装',
  list: [
    { title: '#练度查询 胡桃', desc: '攻略目标对比当前配装，给练度档位与逐项建议' },
    { title: '#练度查询 胡桃 100000000', desc: '显式指定 UID；默认走 miao 的米游社绑定' },
    { title: '#配装 胡桃 3', desc: '阿卡莎角色榜第 3 名的配装（武器 / 圣遗物 / 面板）' }
  ]
}

const guideData = {
  group: '收录',
  list: [
    { title: '#攻略列表', desc: '全部已收录角色；#攻略状态 见总菜单' }
  ]
}

export const guideCfg = {
  title: '#攻略帮助',
  subTitle: '角色攻略 · 练度提升 · 榜上配装',
  note: '常用指令与数据维护看 #meta；伤害与榜单看 #DPS帮助。'
}
export const guideList = [guideCore, guideGrade, guideData]

/* ================= 分菜单②（#DPS帮助） ================= */

const dpsDamage = {
  group: '伤害',
  list: [
    { title: '#胡桃dps', desc: '该角色各金档的最高伤害队伍（每档最多 2 条）' },
    { title: '#危战', desc: '幽境危战 n6/n7' },
    { title: '#危战 7.1 矮灵', desc: '按版本筛；首领支持简写（见 boss-alias.json）' },
    { title: '#队伍伤害 四人名', desc: '四人的关键伤害 + 参考 DPS + 同阵容对照' },
    { title: '#队伍伤害 轴:重击×8', desc: '手动轴：行名×次数@窗口秒；默认最高单次×1／20s' },
    { title: '#队伍伤害 词条:+20暴击', desc: '按 miao 换补写法改面板重算（如 +30暴击）' }
  ]
}

const dpsBoard = {
  group: '榜单与配装',
  list: [
    { title: '#DPS榜', desc: 'DPS 配队总榜；「榜」字可省，如 #DPS' },
    { title: '#DPS榜 胡桃 金≤12', desc: '按角色 / 金数 / 标签 / 主C / 绿玩筛，可翻页' },
    { title: '#DPS视频 3', desc: '发第 3 名队伍的 B 站视频' }
  ]
}

export const dpsCfg = {
  title: '#DPS帮助',
  subTitle: '伤害 · 榜单与配装',
  note: '常用指令与数据维护看 #meta；攻略与练度看 #攻略帮助。'
}
export const dpsList = [dpsDamage, dpsBoard]

/** 三个页面的统一入口（apps/help.ts 按 `page` 取用） */
export const helpPages = {
  meta: { cfg: helpCfg, list: helpList },
  guide: { cfg: guideCfg, list: guideList },
  dps: { cfg: dpsCfg, list: dpsList }
}