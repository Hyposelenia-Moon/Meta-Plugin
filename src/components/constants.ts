/**
 * 常量与纯判定（**不含 I/O**，便于回归套件直接 import 编译产物做行为断言）
 */

/**
 * 抢占优先级
 *
 * 我方必须早于两处占用者：Atlas-Plugin 快捷入口（`priority: -99999`）
 * 与 `plugins/genshin`「米游社攻略」（`priority: 50`）。
 *
 * ⚠ **写死、不做成配置项** —— 一旦让用户可改，改坏就等于抢占静默失效（设计文档 §14.8）。
 */
export const PREEMPT_PRIORITY = -100000

/**
 * 帮助入口的三个全局词：`#攻略` / `#攻略帮助` / `#攻略说明`
 *
 * 三者原属 `plugins/genshin` 的 `^#?攻略(说明|帮助)?$`，由本插件接管（设计文档 §5.2）。
 * 与角色后缀式（`#胡桃攻略`）**互不重叠**：那条要求串尾是「攻略」且前缀非空。
 * `#设置默认攻略N` 也不在此列（我们不接管，由 genshin 继续处理）。
 */
export const HELP_RULE = /^#?攻略(?:说明|帮助)?$/

/** 是否帮助入口（`accept()` 只做纯正则判定，不做任何 I/O） */
export function isHelpCommand (msg: string): boolean {
  return HELP_RULE.test(String(msg ?? ''))
}

/** 页脚版权行（模板里的 `{{copyright}}`） */
export const COPYRIGHT = 'Meta-Plugin · 原神攻略 / 强度榜单 / 练度查询'

/**
 * 角色攻略的**后缀式**：`#胡桃攻略` / `#胡桃攻略2` / `#胡桃指南`
 *
 * 与 `plugins/genshin`「米游社攻略」的 `^#?(更新)?\S+攻略([1-7])?$` 同形，由我们接管。
 * ⚠ 负向断言 `(?!.*设置默认攻略)` 必须保留：`#设置默认攻略3` 也以「攻略3」结尾，
 *   否则会被这条正则吞掉，导致 genshin 的设置命令失效（设计文档 §5.2 / §12）。
 */
export const CODEX_SUFFIX_RULE = /^#?(更新)?(?!.*设置默认攻略)([^#\s]\S*?)攻略([1-7])?$/

/** 角色攻略的「指南」后缀式（Atlas 的 codex 快捷入口也用这个词） */
export const CODEX_GUIDE_RULE = /^#(.+)指南$/

/**
 * **前缀式**入口：`#攻略 <角色> [模块|档位]`、`#攻略 武器 <武器名>`、`#攻略 配队 <角色…>`
 *
 * 这里只判断"是不是前缀式"，参数怎么解释交给 `modules/branches.ts`
 * （`武器`/`圣遗物`/`配队` 既是模块名又是反查头部，需要按"能否解析成角色"来定夺）。
 */
export const CODEX_ARG_RULE = /^#攻略\s+(.+)$/

/** 列表与状态：`#攻略列表` / `#攻略状态` */
export const CODEX_META_RULE = /^#攻略(列表|状态)$/

/** 三个档位词（`#攻略 <角色> 过渡` 只看某一档） */
export const TIER_WORDS = ['推荐', '可选', '过渡'] as const

export type TierWord = (typeof TIER_WORDS)[number]

/** 是否角色攻略的后缀式（`#胡桃攻略` / `#胡桃攻略2` / `#胡桃指南`） */
export function isCodexSuffix (msg: string): boolean {
  const text = String(msg ?? '')
  return CODEX_SUFFIX_RULE.test(text) || CODEX_GUIDE_RULE.test(text)
}

/** 是否前缀式（`#攻略 …`） */
export function isCodexArg (msg: string): boolean {
  return CODEX_ARG_RULE.test(String(msg ?? ''))
}

/** 是否列表 / 状态（`#攻略列表` / `#攻略状态`） */
export function isCodexMeta (msg: string): boolean {
  return CODEX_META_RULE.test(String(msg ?? ''))
}

/**
 * 攻略命令的抢占判定（`accept()` 用；**纯正则、无 I/O**）
 *
 * 覆盖本插件规则会处理的**全部形态**：后缀式 + 指南 + 前缀式 + 列表/状态。
 * 为什么连前缀式一起认领：`accept` 返回 true 会 break 掉框架的 accept 循环
 * （`loader.js`：`if (res) break`），从而让排在其后的 miao accept 不再执行 ——
 * 它可能返回 `"return"` 直接终止整条消息（那样连 rule 阶段都不会跑）。
 * 因此凡是我们自己要处理的，都必须先认领。
 * （`#攻略` / `#攻略帮助` / `#攻略说明` 由帮助 app 认领，这里不重复。）
 */
export function isCodexCommand (msg: string): boolean {
  return isCodexSuffix(msg) || isCodexArg(msg) || isCodexMeta(msg)
}

/* ============================================================
 *  Mhydps-Plugin 合并（设计文档 §7 / §14.6）
 *
 *  这一节是从 `Mhydps-Plugin/components/constants.js` 原样端口化的常量与纯函数，
 *  以及原先散在各 `apps/*.js` 里的 `#DPS…` 命令正则（集中到一处便于做路由等价套件）。
 *  改动规则：**值必须与合并前逐字一致** —— `test/constants-parity.test.mjs` 用冻结快照守着。
 * ============================================================ */

/* ---------- 数据源一：mhydps.cn（榜单 / 危战 / 状态） ---------- */

export const SITE_NAME = '原神DPS数据库'
export const SITE_ORIGIN = 'https://www.mhydps.cn'
export const SITE_HOST = 'www.mhydps.cn'

/**
 * 数据源二：akasha.cv（练度查询）
 *
 * akasha 按 UID 记录单角色练度，与 mhydps.cn 是**两套口径**：
 *   - mhydps：匿名配队记录的期望 DPS / 金数 / 危战耗时（榜单用它）
 *   - akasha：单角色伤害与名次（它自己的公式与赛道榜，练度查询用它）
 * 两者数值不可互相解释，出图与文案都必须标注来源。
 */
export const AKASHA_NAME = 'akasha.cv'
export const AKASHA_BASE = 'https://akasha.cv'
/** 接口前缀（实测得出，非官方文档） */
export const AKASHA_API = `${AKASHA_BASE}/api`
/** 中文化语言码（角色名走本插件角色表，武器/套装名走它的 textmap） */
export const AKASHA_LANG = 'zh-CN'
/** 缓存目录（`data/` 下） */
export const AKASHA_CACHE_DIR = 'akasha'

/** 站点接口路径（站点前端 bundle 实际调用的接口，非公开文档） */
export const API_PATH = {
  teams: '/api/teams',
  teams2: '/api/teams2'
} as const

/** 角色立绘路径（站点自托管，用于渲染角色头像） */
export function avatarUrl (characterId: string | number): string {
  return `${SITE_ORIGIN}/charactor/${characterId}.webp`
}

/** 请求头：站点 nginx 对无 Referer 的请求直接 403，UA 沿用站点自身前端所用标识 */
export const SITE_REFERER = `${SITE_ORIGIN}/`
export const SITE_USER_AGENT = 'MHYDPS-CN/1.0'

/** 缓存文件名（`data/` 下，gitignore） */
export const CACHE_FILE = {
  teams: 'teams.json',
  teams2: 'teams2.json',
  meta: 'meta.json'
} as const

/** 角色头像缓存目录名（`data/` 下） */
export const AVATAR_DIR = 'avatar'

/** 榜单每页上限（配置里的 `dpsPageSize` 不得超过它） */
export const MAX_PAGE_SIZE = 20

/** 元素英文 → 中文（与站点角色表 `element` 字段对应） */
export const ELEMENT_CN: Record<string, string> = {
  Cryo: '冰',
  Pyro: '火',
  Hydro: '水',
  Electro: '雷',
  Anemo: '风',
  Geo: '岩',
  Dendro: '草'
}

/** 伤害数值 → 中文数量级文本（如 3230000 → 323.0 万） */
export function damageText (value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  if (n >= 100000000) return `${(n / 100000000).toFixed(2)} 亿`
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`
  return String(Math.round(n))
}

/** 秒数 → 展示文本 */
export function speedText (value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? `${n}s` : '-'
}

/** 时间戳 → `YYYY-MM-DD HH:mm` */
export function formatTime (ts: unknown): string {
  const d = ts instanceof Date ? ts : new Date(ts as string | number)
  if (Number.isNaN(d.getTime())) return '-'
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 毫秒 → “刚刚 / x 分钟前 / x 小时前 / x 天前” */
export function agoText (ms: unknown): string {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return '-'
  const min = Math.floor(n / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}

/**
 * 本插件的自称（用户可见的自指文案统一取这里）
 *
 * ⚠ **暂时保留合并前的 `Mhydps-Plugin`**：阶段 4 的验收要求「`#DPS…` 的输出与合并前逐字等价」，
 *   自指文案属于输出的一部分，改名会让逐字比对失真。改名统一放到**阶段 6 收尾**一次做完
 *   （改这一个常量即可生效；另需同步 `MhydpsClient` 的报错文案与框架 `name` 字段）。
 */
export const PLUGIN_SIGN = 'Meta-Plugin'

/**
 * 榜单 / 危战 / 练度页的页脚版权行（模板统一使用）
 *
 * 与攻略页的 `COPYRIGHT` 分开：两个数据源不同，文案必须各自标注来源。
 */
export const DPS_COPYRIGHT = `Data from mhydps.cn · Created By TRSS-yunzai & ${PLUGIN_SIGN}`

/* ---------- Enka 字段映射（练度查询用） ---------- */

/** 圣遗物 / 面板属性名 → 中文标签（与站点前端同名的 `FIGHT_PROP_*` 常量） */
export const ENKA_PROP_CN: Record<string, string> = {
  FIGHT_PROP_HP: '生命值',
  FIGHT_PROP_HP_PERCENT: '生命值',
  FIGHT_PROP_ATTACK: '攻击力',
  FIGHT_PROP_ATTACK_PERCENT: '攻击力',
  FIGHT_PROP_DEFENSE: '防御力',
  FIGHT_PROP_DEFENSE_PERCENT: '防御力',
  FIGHT_PROP_ELEMENT_MASTERY: '元素精通',
  FIGHT_PROP_CHARGE_EFFICIENCY: '元素充能效率',
  FIGHT_PROP_CRITICAL: '暴击率',
  FIGHT_PROP_CRITICAL_HURT: '暴击伤害',
  FIGHT_PROP_HEAL_ADD: '治疗加成',
  FIGHT_PROP_PHYSICAL_ADD_HURT: '物理伤害加成',
  FIGHT_PROP_FIRE_ADD_HURT: '火元素伤害加成',
  FIGHT_PROP_ELEC_ADD_HURT: '雷元素伤害加成',
  FIGHT_PROP_WATER_ADD_HURT: '水元素伤害加成',
  FIGHT_PROP_GRASS_ADD_HURT: '草元素伤害加成',
  FIGHT_PROP_WIND_ADD_HURT: '风元素伤害加成',
  FIGHT_PROP_ROCK_ADD_HURT: '岩元素伤害加成',
  FIGHT_PROP_ICE_ADD_HURT: '冰元素伤害加成'
}

/**
 * 属性是否为百分比
 *
 * 与站点前端同规则：名字含 `PERCENT` / `CRITICAL` / `ADD_HURT` / `CHARGE_EFFICIENCY` / `HEAL_ADD`
 */
export function isPercentProp (prop: unknown): boolean {
  const name = String(prop ?? '')
  return name.includes('PERCENT') || name.includes('CRITICAL') ||
    name.includes('ADD_HURT') || name.includes('CHARGE_EFFICIENCY') || name.includes('HEAL_ADD')
}

/** 圣遗物部位（Enka `flat.equipType`）→ 中文 */
export const EQUIP_SLOT_CN: Record<string, string> = {
  EQUIP_BRACER: '生之花',
  EQUIP_NECKLACE: '死之羽',
  EQUIP_SHOES: '时之沙',
  EQUIP_RING: '空之杯',
  EQUIP_DRESS: '理之冠'
}

/** 圣遗物部位的固定展示顺序 */
export const EQUIP_SLOT_ORDER = ['EQUIP_BRACER', 'EQUIP_NECKLACE', 'EQUIP_SHOES', 'EQUIP_RING', 'EQUIP_DRESS'] as const

/** 角色面板要展示的属性（`fightPropMap` 的键 → 标签；`20/22/23` 是 0~1 的小数） */
export const PANEL_PROPS: ReadonlyArray<{ key: string, label: string, percent: boolean }> = [
  { key: '2000', label: '生命值', percent: false },
  { key: '2001', label: '攻击力', percent: false },
  { key: '2002', label: '防御力', percent: false },
  { key: '28', label: '元素精通', percent: false },
  { key: '20', label: '暴击率', percent: true },
  { key: '22', label: '暴击伤害', percent: true },
  { key: '23', label: '元素充能效率', percent: true }
]

/** 天赋位次（Enka `skillLevelMap` 键的末位）→ 中文 */
export const TALENT_POSITION_CN: Record<string, string> = {
  1: '普攻',
  2: '战技',
  3: '爆发'
}

/* ---------- `#DPS…` 命令正则（原先散在各 app 里，合并时集中到常量层） ---------- */

/**
 * 命令正则表
 *
 * ⚠ 与合并前**逐字一致**（含 `(?!视频)`、`(?!视频|帮助|状态|更新|刷新|练度|危战)` 这些负向断言）：
 * 它们是路由正确性的关键——`#DPS榜视频` 不能被榜单规则吞掉。
 */
export const DPS_RULES = {
  /** `#DPS更新` / `#DPS强制更新` / `#DPS刷新`（master） */
  admin: /^#?(?:dps|DPS)(?:强制更新|更新|刷新)$/,
  /** `#DPS练度查询 [角色] [UID]` */
  build: /^#?(?:dps|DPS)练度查询\s*([\s\S]*)$/,
  /** `#DPS帮助` */
  help: /^#?(?:dps|DPS)帮助$/,
  /** `#DPS危战榜 [版本] [首领] [角色] [金数] [页N]` */
  raid: /^#?(?:dps|DPS)危战榜?(?!视频)\s*([\s\S]*)$/,
  /** `#DPS榜 [角色] [金数] [标签] [主C] [绿玩] [页N]` */
  rank: /^#?(?:dps|DPS)榜?(?!视频|帮助|状态|更新|刷新|练度|危战)\s*([\s\S]*)$/,
  /** `#DPS状态` */
  status: /^#?(?:dps|DPS)状态$/,
  /** `#DPS视频 <名次>`（榜单视频） */
  video: /^#?(?:dps|DPS)视频\s*([\s\S]*)$/,
  /** `#DPS危战视频 <名次>` */
  raidVideo: /^#?(?:dps|DPS)危战视频\s*([\s\S]*)$/
} as const

export type DpsRuleKey = keyof typeof DPS_RULES

/**
 * 消息命中的 `#DPS…` 命令（按 video → raidVideo → admin → help → status → build → raid → rank 的顺序判定）
 *
 * 顺序与合并前的 app 优先级顺序一致（视频最靠前，榜单兜底）：
 * 合并前 `video` app 的 priority 最小（7900，最优先）。
 */
export function matchDpsCommand (msg: string): { key: DpsRuleKey, match: RegExpMatchArray } | null {
  const text = String(msg ?? '')
  const order: DpsRuleKey[] = ['video', 'raidVideo', 'admin', 'help', 'status', 'build', 'raid', 'rank']
  for (const key of order) {
    const match = text.match(DPS_RULES[key])
    if (match) return { key, match }
  }
  return null
}

/* ---------- `#DPS…` 各 app 的命令元数据（名称 / 帮助文案 / 权限 / 优先级偏移） ---------- */

/**
 * 一条 `#DPS…` 命令的元数据
 *
 * 这些值原先写在各 `apps/*.js` 的 `class` 里（`name` / `dsc` / `permission` / `priority`）；
 * 提到常量层是为了：① 4.5 的 app 只剩薄壳；② 帮助页与状态页有唯一的数据源；
 * ③ 套件能断言「文案里写的命令，其正则真的命中」。
 */
export interface DpsCommandMeta {
  /** 归属的规则键（一个 app 可能有多条规则，如视频 app） */
  rules: DpsRuleKey[]
  /** 插件名（框架日志里的 `NameXX`） */
  name: string
  /** 帮助文案 */
  dsc: string
  /** 权限（`master` = 仅主人可用） */
  permission: 'master' | 'all'
  /** 相对 `config.priority` 的偏移（合并前各 app 的写法，负值 = 更早判定） */
  priorityOffset: number
}

/**
 * `#DPS…` 命令元数据表（顺序 = 帮助页展示顺序）
 *
 * ⚠ **视频命令的文案已按用户 2026-10-13 的决定修正**：合并前 `apps/video.js` 的
 *   `dsc` 写的是 `#DPS榜视频`，而正则其实是 `#DPS视频`（`RANK_VIDEO_RE`），
 *   导致按文案输入 `#DPS榜视频 3` 会被榜单规则吃成「榜单 + 参数『榜视频 3』」。
 *   裁定：**正则保持逐字不变（`#DPS视频`）**，只把文案改成与之一致 →
 *   `#DPS视频 <名次>` / `#DPS危战视频 <名次>`。
 *   `test/dps-commands.test.mjs` 有一条门禁：文案里出现的每个命令都必须被该 app 的正则命中。
 */
export const DPS_COMMANDS: ReadonlyArray<DpsCommandMeta> = [
  { rules: ['rank'], name: 'MetaDPS榜', dsc: '#DPS榜 [角色] [金数] [标签] [主C] [绿玩] [页N]', permission: 'all', priorityOffset: 0 },
  { rules: ['raid'], name: 'Meta危战榜', dsc: '#DPS危战榜 [版本] [首领] [角色] [金数] [页N]', permission: 'all', priorityOffset: -20 },
  { rules: ['build'], name: 'Meta练度查询', dsc: '#DPS练度查询 [角色] [UID]', permission: 'all', priorityOffset: -50 },
  { rules: ['status'], name: 'Meta状态', dsc: '#DPS状态', permission: 'all', priorityOffset: -10 },
  // 文案已修正（原为 `#DPS榜视频`，与正则不符）
  { rules: ['video', 'raidVideo'], name: 'Meta视频查询', dsc: '#DPS视频 <名次> / #DPS危战视频 <名次>', permission: 'all', priorityOffset: -100 },
  { rules: ['help'], name: 'Meta帮助', dsc: '#DPS帮助', permission: 'all', priorityOffset: -10 },
  { rules: ['admin'], name: 'Meta数据管理', dsc: '#DPS更新 / #DPS强制更新 / #DPS刷新', permission: 'master', priorityOffset: -10 }
]
