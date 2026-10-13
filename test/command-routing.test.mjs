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
 * 合并后正则**只有一处定义**（`components/constants.ts` 的 `DPS_RULES`，阶段 4.1 集中），
 * 各 app 通过 `reg: DPS_RULES.x` 引用它，所以这里直接取常量表，不再从 app 源码里抠字面量。
 */
const { DPS_RULES } = await import(mod('components/constants.js'))

const rankCmd = DPS_RULES.rank
const raidCmd = DPS_RULES.raid
const buildCmd = DPS_RULES.build
const adminCmd = DPS_RULES.admin
const statusCmd = DPS_RULES.status
const helpCmd = DPS_RULES.help
const rankVideo = DPS_RULES.video
const raidVideo = DPS_RULES.raidVideo

// ---- 视频命令：由 video.js 接管，榜单入口不得抢匹配 ----
check('#DPS视频 3 命中视频入口', rankVideo.test('#DPS视频 3'))
check('#DPS视频 3 不被榜单入口匹配', !rankCmd.test('#DPS视频 3'))
check('#DPS视频 3 胡桃 命中视频入口', rankVideo.test('#DPS视频 3 胡桃'))
check('#DPS危战视频 3 命中危战视频入口', raidVideo.test('#DPS危战视频 3'))
check('#DPS危战视频 3 不被危战入口匹配', !raidCmd.test('#DPS危战视频 3'))
check('榜单视频入口不误吞危战视频命令', !rankVideo.test('#DPS危战视频 3'))
check('危战视频入口不误吞榜单视频命令', !raidVideo.test('#DPS视频 3'))

// ---- 榜单 / 危战 / 练度：简化写法仍然可用 ----
check('#DPS榜 与 #DPS 都命中榜单入口', rankCmd.test('#DPS榜') && rankCmd.test('#DPS'))
check('#DPS榜 胡桃 12金 命中榜单入口', rankCmd.test('#DPS榜 胡桃 12金') && rankCmd.test('#DPS 胡桃 12金'))
check('#DPS危战榜 / #DPS危战 命中危战入口', raidCmd.test('#DPS危战榜') && raidCmd.test('#DPS危战 7.1'))
check('#DPS练度查询 <UID> 命中练度入口', buildCmd.test('#DPS练度查询 100000000'))
check('省略「查询」或前缀不再命中（避免抢别的插件的 #练度）', !buildCmd.test('#DPS练度 100000000') && !buildCmd.test('#练度查询 100000000'))
check('#DPS练度查询 <角色> [UID] 命中练度入口', buildCmd.test('#DPS练度查询 胡桃') && buildCmd.test('#DPS练度查询 胡桃 100000000'))
check('#DPS更新 / #DPS刷新 命中管理入口', adminCmd.test('#DPS更新') && adminCmd.test('#DPS刷新'))
check('#DPS状态 与 #DPS帮助 各归各家', statusCmd.test('#DPS状态') && helpCmd.test('#DPS帮助'))

// ---- 宽泛的 #DPS 规则不得吞掉其它命令 ----
check('#DPS帮助 不被榜单入口匹配', !rankCmd.test('#DPS帮助'))
check('#DPS状态 不被榜单入口匹配', !rankCmd.test('#DPS状态'))
check('#DPS更新 不被榜单入口匹配', !rankCmd.test('#DPS更新'))
check('#DPS练度查询 <UID> 不被榜单入口匹配', !rankCmd.test('#DPS练度查询 100000000'))
check('#DPS练度查询 <角色> 不被危战入口匹配', !raidCmd.test('#DPS练度查询 胡桃'))
check('#DPS危战榜 7.1 不被榜单入口匹配', !rankCmd.test('#DPS危战榜 7.1'))

// ---- 大小写与小写前缀 ----
check('小写 #dps视频 2 也认', rankVideo.test('#dps视频 2'))
check('省略 # 但保留前缀仍认榜单', rankCmd.test('dps榜 3金'))

finish()
