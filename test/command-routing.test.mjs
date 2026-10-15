/**
 * 命令路由：各入口的正则边界
 *
 * apps/ 里的入口类依赖框架（只能在 bot 的 plugins/ 下导入），所以这里直接读源码里的正则字面量，
 * 钉住最容易出事的一点：**新增的「视频」后缀命令不能被榜单入口抢走**，
 * 同时原有榜单/危战/练度命令的匹配范围不能被收紧到失效。
 */
import { checker, mod } from './_helper.mjs'

const { check, finish } = checker()

/**
 * 取一条 `#DPS…` 命令的正则
 *
 * 合并后正则**只有一处定义**（`components/constants.ts` 的 `RULES`，阶段 4.1 集中），
 * 各 app 通过 `reg: RULES.x` 引用它，所以这里直接取常量表，不再从 app 源码里抠字面量。
 */
const { RULES } = await import(mod('components/constants.js'))

const rankCmd = RULES.rank
const raidTierCmd = RULES.raidTiers
const raidPromptCmd = RULES.raidTiersPrompt
const buildCmd = RULES.build
const adminCmd = RULES.admin
const statusCmd = RULES.status
const helpCmd = RULES.help
const rankVideo = RULES.video
const raidVideo = RULES.raidVideo

// ---- 视频命令：由 video.js 接管，榜单入口不得抢匹配 ----
check('#视频 3 命中视频入口', rankVideo.test('#视频 3'))
check('#榜视频 3 也命中视频入口（榜字可省）', rankVideo.test('#榜视频 3'))
check('#视频 3 不被榜单入口匹配', !rankCmd.test('#视频 3'))
check('#视频 3 胡桃 命中视频入口', rankVideo.test('#视频 3 胡桃'))
check('#危战视频 3 命中危战视频入口', raidVideo.test('#危战视频 3'))
check('#危战视频 3 不被危战入口匹配', !raidTierCmd.test('#危战视频 3') && !raidPromptCmd.test('#危战视频 3'))
check('榜单视频入口不误吞危战视频命令', !rankVideo.test('#危战视频 3'))
check('危战视频入口不误吞榜单视频命令', !raidVideo.test('#视频 3'))

// ---- 榜单 / 危战 / 练度：简化写法仍然可用 ----
check('#DPS榜 与 #DPS 都命中榜单入口', rankCmd.test('#DPS榜') && rankCmd.test('#DPS'))
check('#DPS榜 胡桃 12金 命中榜单入口', rankCmd.test('#DPS榜 胡桃 12金') && rankCmd.test('#DPS 胡桃 12金'))
check('#危战 矮灵 n7 / n6 命中危战入口（档位必填）',
  raidTierCmd.test('#危战 矮灵 n7') && raidTierCmd.test('#危战 矮灵 n6') && raidTierCmd.test('#危战 7.1 n7'))
check('裸 #危战 与 #危战数据/#危战排名 都不认领（那是 miao 的命令）',
  ['#危战', '#危战数据', '#危战排名', '#危战单人'].every(m => !raidTierCmd.test(m) && !raidPromptCmd.test(m)))
check('写了筛选但没档位 → 提示选档入口', raidPromptCmd.test('#危战 矮灵') && !raidTierCmd.test('#危战 矮灵'))
check('#练度榜 <UID> 命中练度入口', buildCmd.test('#练度榜 100000000'))
check('省略「查询」或前缀不再命中（避免抢别的插件的 #练度）', !buildCmd.test('#DPS练度 100000000') && !buildCmd.test('#练度查询 100000000'))
check('#练度榜 <角色> [UID] 命中练度入口', buildCmd.test('#练度榜 胡桃') && buildCmd.test('#练度榜 胡桃 100000000'))
check('#榜单刷新 命中管理入口', adminCmd.test('#榜单刷新'))
check('#meta状态 与 #DPS帮助 各归各家', statusCmd.test('#meta状态') && helpCmd.test('#DPS帮助'))

// ---- 宽泛的 #DPS 规则不得吞掉其它命令 ----
check('#DPS帮助 不被榜单入口匹配', !rankCmd.test('#DPS帮助'))
check('#meta状态 不被榜单入口匹配', !rankCmd.test('#meta状态'))
check('#榜单刷新 不被榜单入口匹配', !rankCmd.test('#榜单刷新'))
check('#练度榜 <UID> 不被榜单入口匹配', !rankCmd.test('#练度榜 100000000'))
check('#练度榜 <角色> 不被危战入口匹配', !raidTierCmd.test('#练度榜 胡桃'))
check('#危战 7.1 n6 不被榜单入口匹配', !rankCmd.test('#危战 7.1 n6'))
check('已废除的旧名不再命中任何入口',
  ['#DPS练度查询 胡桃', '#DPS状态', '#DPS视频 3', '#DPS危战视频 3', '#DPS更新', '#DPS危战榜 7.1', '#胡桃dps'].every(m => !rankCmd.test(m) && !buildCmd.test(m) && !statusCmd.test(m) && !rankVideo.test(m) && !raidVideo.test(m) && !adminCmd.test(m) && !raidTierCmd.test(m) && !raidPromptCmd.test(m)))

// ---- 大小写（`#DPS…` 只剩榜单与帮助两条，其余命令不再带 DPS 前缀） ----
check('小写 #dps 前缀仍认榜单', rankCmd.test('#dps 3金') && rankCmd.test('#dps榜 3金'))
check('帮助的小写前缀也认', helpCmd.test('#dps帮助'))
check('省略 # 但保留前缀仍认榜单', rankCmd.test('dps榜 3金'))

finish()
