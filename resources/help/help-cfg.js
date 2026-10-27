/**
 * Meta-Plugin 帮助配置（2026-10-14：两小一大 · 总菜单导航化；2026-10-15：文案精简）
 *
 * 结构思路：**总菜单管导航**（常用入口 + 数据维护 + 两个分菜单入口），
 * **分菜单管一个主题的完整写法**（攻略练度 / 伤害榜单），互不重复铺内容。
 *
 * - `#meta`      常用指令 + 数据与维护 + 进阶入口（4 组）
 * - `#攻略帮助`  角色攻略 + 练度与配装 + 收录（3 组）
 * - `#DPS帮助`   伤害 + 榜单与配装（2 组）
 *
 * 每项**只有 title / desc 两个字段**；门禁在 `test/dps-help-config.test.mjs`：
 * 主菜单说明 ≤24 字、分菜单 ≤30 字、分组标题非空且 ≤8 字、每组 ≤8 条、标题唯一且以 `#` 开头。
 *
 * ⚠ 2026-10-15 用户定：帮助页**只写使用者需要知道的**——不出现配置键、文件名、"改配置"这类
 *   需要开发者/管理员处理的内容；队伍伤害只展示默认轴（其余序号轴要管理员先在配置里定义，
 *   不适合当作入口展示）。
 *
 * apps/help.ts 用动态 import 读本文件，改完无需重启 bot。
 */

/* ================= 总菜单（#meta） ================= */

const metaRole = {
  group: '角色与练度',
  list: [
    { title: '#胡桃攻略', desc: '角色攻略总页（六模块一图）' },
    { title: '#练度查询 胡桃', desc: '攻略目标 × 当前配装 → 练度档位与建议' },
    { title: '#练度查询 胡桃 面板图3', desc: '立绘改用图库里的第 3 张' }
  ]
}

const metaDamage = {
  group: '伤害与榜单',
  list: [
    { title: '#DPS榜 胡桃', desc: '该角色各金档最高伤害队伍' },
    { title: '#危战 矮灵 n7', desc: '危战成绩：须指定 n7 速通档或 n6 险胜档' },
    { title: '#队伍伤害 四人名', desc: '整队关键伤害 + 参考 DPS（可加词条）' },
    { title: '#DPS榜', desc: '全库各金档最高伤害队伍' }
  ]
}

const metaStatus = {
  group: '数据与维护',
  list: [
    { title: '#攻略状态', desc: '数据版本、收录数与缓存情况' },
    { title: '#meta状态', desc: '缓存、联网与已关闭模块' },
    { title: '#榜单刷新', desc: '立即刷新榜单缓存（仅主人）' }
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
  subTitle: 'Meta-Plugin · 常用指令与导航'
}
export const helpList = [metaRole, metaDamage, metaStatus, metaMore]

/* ================= 分菜单①（#攻略帮助） ================= */

const guideCore = {
  group: '角色攻略',
  list: [
    { title: '#胡桃攻略', desc: '角色攻略总页：六模块一图（含配队）' },
    { title: '#胡桃攻略 面板图3', desc: '立绘改用图库里的第 3 张' }
  ]
}

const guideGrade = {
  group: '练度与配装',
  list: [
    { title: '#练度查询 胡桃', desc: '攻略目标对比当前配装，给练度档位与逐项建议' },
    { title: '#练度查询 胡桃 面板图3', desc: '立绘改用图库里的第 3 张' }
  ]
}

const guideData = {
  group: '收录',
  list: [
    { title: '#攻略列表', desc: '全部已收录角色' }
  ]
}

export const guideCfg = {
  title: '#攻略帮助',
  subTitle: '角色攻略 · 练度提升 · 收录'
}
export const guideList = [guideCore, guideGrade, guideData]

/* ================= 分菜单②（#DPS帮助） ================= */

/*
 * 2026-10-27 用户定：按**功能**分组（配队榜单 / 危战 / 队伍伤害），每组两列；
 * 每条只讲一种写法，不再把「筛选」「视频」混在伤害组里，也不重复列同一个命令。
 */
const dpsBoard = {
  group: '配队榜单',
  cols: 2,
  list: [
    { title: '#DPS榜 胡桃', desc: '该角色各金档最高伤害队伍' },
    { title: '#DPS榜', desc: '全库各金档最高伤害队伍' },
    { title: '#DPS榜 总榜', desc: '全库按伤害排序的总榜，可页N' },
    { title: '#DPS榜 12金', desc: '≤12 金的榜单，最多 10 条' },
    { title: '#DPS榜 9-12金', desc: '指定金数区间（含两端）' },
    { title: '#DPS榜 胡桃 12金', desc: '该角色在 ≤12 金内的榜单' },
    { title: '#DPS榜 … 视频1', desc: '取当前筛选第 1 名的视频' }
  ]
}

const dpsRaid = {
  group: '危战',
  cols: 2,
  list: [
    { title: '#危战 矮灵 n7', desc: 'n7 速通档（≤70s）；n6 为险胜档' },
    { title: '#危战 7.1 矮灵 n6', desc: '可按版本 / 首领 / 角色筛选' },
    { title: '#危战 … n7 视频3', desc: '取全榜第 3 名的视频' }
  ]
}

const dpsTeam = {
  group: '队伍伤害',
  cols: 2,
  list: [
    { title: '#队伍伤害 四人名', desc: '整队关键伤害 + 参考 DPS' },
    { title: '#队伍伤害 四人名 +30暴击', desc: '词条免前缀，直接写暴击 / 爆伤' }
  ]
}

export const dpsCfg = {
  title: '#DPS帮助',
  subTitle: '配队榜单 · 危战 · 队伍伤害'
}
export const dpsList = [dpsBoard, dpsRaid, dpsTeam]

/** 三个页面的统一入口（apps/help.ts 按 `page` 取用） */
export const helpPages = {
  meta: { cfg: helpCfg, list: helpList },
  guide: { cfg: guideCfg, list: guideList },
  dps: { cfg: dpsCfg, list: dpsList }
}
