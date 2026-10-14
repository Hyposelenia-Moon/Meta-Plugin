/**
 * Meta-Plugin 帮助配置（阶段 5 合并：攻略侧 + 榜单/危战/练度侧合成一份）
 *
 * 结构约定（帮助图是「分组标题条 + 三列网格」的紧凑版式）：
 *   helpCfg  —— 页头标题、副标题、可选的页脚说明（note）
 *   helpList —— 分组；每组 list 里每项**只有 title / desc 两个字段**：
 *               title 写成「命令 + 用法」的可直接照抄形态（如 `#攻略 胡桃 武器`），
 *               desc 压成一行说明；不放语法块 / 参数表 / 示例块
 *
 * ⚠ `#攻略帮助` 与 `#DPS帮助` **渲染同一份本页**（合并后不再有两套帮助图）。
 *   apps/help.ts 用动态 import 读本文件，改完无需重启 bot。
 */
export const helpCfg = {
  title: '#Meta 帮助',
  subTitle: 'Meta-Plugin · 原神攻略 / 强度榜单 / 练度查询',
  note: '本插件已接管 #〈角色〉攻略 / #攻略 系列指令；原「米游社攻略图」不再触发。'
}

export const helpList = [
  {
    group: '攻略查询',
    list: [
      { title: '#胡桃攻略', desc: '角色攻略总页（六模块一图）；「指南」同义' },
      { title: '#攻略 胡桃', desc: '前缀式入口，效果同上（不依赖抢占）' },
      { title: '#攻略 胡桃 武器', desc: '只看单个模块：武器 / 圣遗物 / 天赋 / 面板 / 命座 / 配队' },
      { title: '#攻略 胡桃 过渡', desc: '只看某一档：推荐 / 可选 / 过渡' }
    ]
  },
  {
    group: '攻略反向查询',
    list: [
      { title: '#攻略 武器 护摩之杖', desc: '谁推荐了这把武器（含专武分组与档位）' },
      { title: '#攻略 配队 胡桃 夜兰', desc: '同时含这些角色的配队（多角色取交集）' }
    ]
  },
  {
    group: 'DPS 榜单',
    list: [
      { title: '#胡桃dps', desc: '该角色各金档的最高伤害队伍（每档最多 2 条，带视频标记）' },
      { title: '#DPS榜', desc: 'DPS 配队总榜；「榜」字可省，如 #DPS' },
      { title: '#DPS榜 胡桃', desc: '只看含该角色的配队，支持别名（火神 / 桃 / 爷）' },
      { title: '#DPS榜 金≤12', desc: '金数筛选：金≥8 / 8-12金 亦可；可加 主C / 绿玩 / -p2' }
    ]
  },
  {
    group: '危战榜单',
    list: [
      { title: '#危战', desc: 'n6 / n7 两档：n7 = 70s 内，n6 看越近 120s 的' },
      { title: '#危战 7.1', desc: '按版本或首领筛；#危战 矮灵雕刻师 亦可' },
      { title: '#DPS危战榜', desc: '幽境危战收录：金数升序，同金数比耗时' },
      { title: '#DPS危战榜 7.1', desc: '按版本或首领筛（首领可只写简称，如 矮灵雕刻师）' }
    ]
  },
  {
    group: '练度查询',
    list: [
      { title: '#练度查询 胡桃', desc: '攻略目标 × 当前配装 → 总体练度 + 面板档 + 提升建议' },
      { title: '#DPS练度查询 <UID>', desc: 'akasha 练度面板（名次 / top% / 伤害 / 武器）' },
      { title: '#DPS练度查询 胡桃', desc: '只看指定角色；UID 取配置 defaultUid' }
    ]
  },
  {
    group: '列表与维护',
    list: [
      { title: '#攻略列表', desc: '全部已收录角色' },
      { title: '#DPS视频 3', desc: '发第 3 名的 B 站视频；危战榜用 #DPS危战视频 3' },
      { title: '#攻略帮助', desc: '显示本页；#DPS帮助 / #攻略 / #攻略说明 同义' },
      { title: '#攻略状态', desc: '数据版本、覆盖数、资源来源与缓存情况；#DPS状态 同页' },
      { title: '#DPS更新', desc: '立即刷新榜单缓存（仅主人）' },
      { title: '#更新Meta-Plugin', desc: '更新本插件（简写 #更新Meta；有本地改动时用 #强制更新Meta）' }
    ]
  }
]
