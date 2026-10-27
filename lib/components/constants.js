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
export const PREEMPT_PRIORITY = -100000;
/**
 * 帮助入口的三个全局词：`#攻略` / `#攻略帮助` / `#攻略说明`
 *
 * 三者原属 `plugins/genshin` 的 `^#?攻略(说明|帮助)?$`，由本插件接管（设计文档 §5.2）。
 * 与角色后缀式（`#胡桃攻略`）**互不重叠**：那条要求串尾是「攻略」且前缀非空。
 * `#设置默认攻略N` 也不在此列（我们不接管，由 genshin 继续处理）。
 */
export const HELP_RULE = /^#?攻略(?:说明|帮助)?$/;
/** 是否帮助入口（`accept()` 只做纯正则判定，不做任何 I/O） */
export function isHelpCommand(msg) {
    return HELP_RULE.test(String(msg ?? ''));
}
/**
 * 总帮助入口 `#meta` / `#Meta帮助`（2026-10-14：帮助改成两小一大）
 *
 * `#攻略帮助`（含 `#攻略` / `#攻略说明`）= 攻略 + 提升指南；`#DPS帮助` = 伤害 + 榜单 + 状态。
 */
export const META_HELP_RULE = /^#?(?:meta|Meta|META)(?:帮助|说明)?$/;
/** 是否总帮助入口（纯正则，无 I/O） */
export function isMetaHelpCommand(msg) {
    return META_HELP_RULE.test(String(msg ?? ''));
}
/** 页脚版权行（模板里的 `{{copyright}}`） */
export const COPYRIGHT = 'Meta-Plugin · 原神攻略 / 强度榜单 / 练度查询';
/**
 * 角色攻略的**后缀式**：`#胡桃攻略` / `#胡桃攻略2` / `#胡桃指南` / `#胡桃攻略 面板图3`
 *
 * 与 `plugins/genshin`「米游社攻略」的 `^#?(更新)?\S+攻略([1-7])?$` 同形，由我们接管。
 * ⚠ 负向断言 `(?!.*设置默认攻略)` 必须保留：`#设置默认攻略3` 也以「攻略3」结尾，
 *   否则会被这条正则吞掉，导致 genshin 的设置命令失效（设计文档 §5.2 / §12）。
 *
 * `面板图N`（2026-10-17 加）：指定图库里的第 N 张立绘，写法与 `#练度查询 胡桃 面板图3` 一致
 * （可带空格也可不带）。与 `#胡桃攻略2` 的套数标记可同时出现。
 */
export const CODEX_SUFFIX_RULE = /^#?(更新)?(?!.*设置默认攻略)([^#\s]\S*?)攻略([1-7])?(?:\s*面板图([1-9]\d*))?$/;
/** 前缀式 #攻略 <角色> [模块|档位]（2026-10-14 起**入口已移除**；规则保留给 modules/branches 的解析器） */
export const CODEX_GUIDE_RULE = /^#(.+)指南$/;
/** 反查 #攻略 <武器|配队> …（同上：入口已移除） */
export const CODEX_ARG_RULE = /^#攻略\s+(.+)$/;
/** 角色攻略的「指南」后缀式（Atlas 的 codex 快捷入口也用这个词） */
/**
 * **前缀式**入口：`#攻略 <角色> [模块|档位]`、`#攻略 武器 <武器名>`、`#攻略 配队 <角色…>`
 *
 * 这里只判断"是不是前缀式"，参数怎么解释交给 `modules/branches.ts`
 * （`武器`/`圣遗物`/`配队` 既是模块名又是反查头部，需要按"能否解析成角色"来定夺）。
 */
/** 列表与状态：`#攻略列表` / `#攻略状态` */
export const CODEX_META_RULE = /^#攻略(列表|状态)$/;
/** 三个档位词（`#攻略 <角色> 过渡` 只看某一档） */
export const TIER_WORDS = ['推荐', '可选', '过渡'];
/** 是否角色攻略的后缀式（`#胡桃攻略` / `#胡桃攻略2` / `#胡桃指南`） */
export function isCodexSuffix(msg) {
    const text = String(msg ?? '');
    return CODEX_SUFFIX_RULE.test(text);
}
/** 是否前缀式（`#攻略 …`） */
export function isCodexArg(msg) {
    return CODEX_ARG_RULE.test(String(msg ?? ''));
}
/** 是否列表 / 状态（`#攻略列表` / `#攻略状态`） */
export function isCodexMeta(msg) {
    return CODEX_META_RULE.test(String(msg ?? ''));
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
export function isCodexCommand(msg) {
    return isCodexSuffix(msg) || isCodexArg(msg) || isCodexMeta(msg);
}
/* ============================================================
 *  Mhydps-Plugin 合并（设计文档 §7 / §14.6）
 *
 *  这一节是从 `Mhydps-Plugin/components/constants.js` 原样端口化的常量与纯函数，
 *  以及原先散在各 `apps/*.js` 里的 `#DPS…` 命令正则（集中到一处便于做路由等价套件）。
 *  改动规则：**值必须与合并前逐字一致** —— `test/constants-parity.test.mjs` 用冻结快照守着。
 * ============================================================ */
/* ---------- 数据源一：mhydps.cn（榜单 / 危战 / 状态） ---------- */
export const SITE_NAME = '原神DPS数据库';
export const SITE_ORIGIN = 'https://www.mhydps.cn';
export const SITE_HOST = 'www.mhydps.cn';
/** 站点接口路径（站点前端 bundle 实际调用的接口，非公开文档） */
export const API_PATH = {
    teams: '/api/teams',
    teams2: '/api/teams2'
};
/** 角色立绘路径（站点自托管，用于渲染角色头像） */
export function avatarUrl(characterId) {
    return `${SITE_ORIGIN}/charactor/${characterId}.webp`;
}
/** 请求头：站点 nginx 对无 Referer 的请求直接 403，UA 沿用站点自身前端所用标识 */
export const SITE_REFERER = `${SITE_ORIGIN}/`;
export const SITE_USER_AGENT = 'MHYDPS-CN/1.0';
/**
 * 站点请求用的浏览器 UA（2026-10-16 实测：MHYDPS-CN/1.0 会被 mhydps 直接 403，
 * 换浏览器 UA + Referer 后正常 200）。请求头统一用它；SITE_USER_AGENT 保留给兼容/测试引用。
 */
export const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
/** 缓存文件名（`data/` 下，gitignore） */
export const CACHE_FILE = {
    teams: 'teams.json',
    teams2: 'teams2.json',
    meta: 'meta.json'
};
/** 角色头像缓存目录名（`data/` 下） */
export const AVATAR_DIR = 'avatar';
/** 榜单每页上限（配置里的 `dpsPageSize` 不得超过它） */
export const MAX_PAGE_SIZE = 20;
/** 元素英文 → 中文（与站点角色表 `element` 字段对应） */
export const ELEMENT_CN = {
    Cryo: '冰',
    Pyro: '火',
    Hydro: '水',
    Electro: '雷',
    Anemo: '风',
    Geo: '岩',
    Dendro: '草'
};
/** 伤害数值 → 中文数量级文本（如 3230000 → 323.0 万） */
export function damageText(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return '-';
    if (n >= 100000000)
        return `${(n / 100000000).toFixed(2)} 亿`;
    if (n >= 10000)
        return `${(n / 10000).toFixed(1)} 万`;
    return String(Math.round(n));
}
/** 秒数 → 展示文本 */
export function speedText(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n}s` : '-';
}
/** 时间戳 → `YYYY-MM-DD HH:mm` */
export function formatTime(ts) {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(d.getTime()))
        return '-';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** 毫秒 → “刚刚 / x 分钟前 / x 小时前 / x 天前” */
export function agoText(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0)
        return '-';
    const min = Math.floor(n / 60000);
    if (min < 1)
        return '刚刚';
    if (min < 60)
        return `${min} 分钟前`;
    const hour = Math.floor(min / 60);
    if (hour < 24)
        return `${hour} 小时前`;
    return `${Math.floor(hour / 24)} 天前`;
}
/**
 * 本插件的自称（用户可见的自指文案统一取这里）
 *
 * ⚠ **暂时保留合并前的 `Mhydps-Plugin`**：阶段 4 的验收要求「`#DPS…` 的输出与合并前逐字等价」，
 *   自指文案属于输出的一部分，改名会让逐字比对失真。改名统一放到**阶段 6 收尾**一次做完
 *   （改这一个常量即可生效；另需同步 `MhydpsClient` 的报错文案与框架 `name` 字段）。
 */
export const PLUGIN_SIGN = 'Meta-Plugin';
/**
 * 榜单 / 危战 / 练度页的页脚版权行（模板统一使用）
 *
 * 与攻略页的 `COPYRIGHT` 分开：两个数据源不同，文案必须各自标注来源。
 */
export const DPS_COPYRIGHT = `Data from mhydps.cn · Created By TRSS-yunzai & ${PLUGIN_SIGN}`;
/* ---------- Enka 字段映射（练度查询用） ---------- */
/** 圣遗物 / 面板属性名 → 中文标签（与站点前端同名的 `FIGHT_PROP_*` 常量） */
export const ENKA_PROP_CN = { FIGHT_PROP_HP: '生命值',
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
};
/**
 * 属性**短键** → 中文（2026-10-15 真机反馈：练度页主词条显示成了 `hp`）
 *
 * miao 的圣遗物明细里 `main.key` 有时是短键（`hp` / `cpct` …）而不是 `FIGHT_PROP_*`，
 * 而 `main.title` 在部分角色/数据缺失时是空的，于是 `artisRowsOf()` 一路兜底到原始键，
 * 页面上就出现了 `hp → 充能效率 / 生命值` 这种"实际值没翻译"的对比行。
 * 这里补齐短键表，只作**兜底**（miao 自己的中文名优先）。
 */
export const STAT_KEY_CN = {
    hp: '生命值',
    hpBase: '基础生命值',
    atk: '攻击力',
    atkBase: '基础攻击力',
    def: '防御力',
    defBase: '基础防御力',
    mastery: '元素精通',
    cpct: '暴击率',
    cdmg: '暴击伤害',
    recharge: '元素充能效率',
    dmg: '伤害加成',
    heal: '治疗加成',
    phy: '物理伤害加成',
    anemo: '风元素伤害加成',
    geo: '岩元素伤害加成',
    electro: '雷元素伤害加成',
    dendro: '草元素伤害加成',
    hydro: '水元素伤害加成',
    pyro: '火元素伤害加成',
    cryo: '冰元素伤害加成'
};
/**
 * 属性是否为百分比
 *
 * 与站点前端同规则：名字含 `PERCENT` / `CRITICAL` / `ADD_HURT` / `CHARGE_EFFICIENCY` / `HEAL_ADD`
 */
export function isPercentProp(prop) {
    const name = String(prop ?? '');
    return name.includes('PERCENT') || name.includes('CRITICAL') ||
        name.includes('ADD_HURT') || name.includes('CHARGE_EFFICIENCY') || name.includes('HEAL_ADD');
}
/** 圣遗物部位（Enka `flat.equipType`）→ 中文 */
export const EQUIP_SLOT_CN = {
    EQUIP_BRACER: '生之花',
    EQUIP_NECKLACE: '死之羽',
    EQUIP_SHOES: '时之沙',
    EQUIP_RING: '空之杯',
    EQUIP_DRESS: '理之冠'
};
/** 圣遗物部位的固定展示顺序 */
export const EQUIP_SLOT_ORDER = ['EQUIP_BRACER', 'EQUIP_NECKLACE', 'EQUIP_SHOES', 'EQUIP_RING', 'EQUIP_DRESS'];
/** 角色面板要展示的属性（`fightPropMap` 的键 → 标签；`20/22/23` 是 0~1 的小数） */
export const PANEL_PROPS = [
    { key: '2000', label: '生命值', percent: false },
    { key: '2001', label: '攻击力', percent: false },
    { key: '2002', label: '防御力', percent: false },
    { key: '28', label: '元素精通', percent: false },
    { key: '20', label: '暴击率', percent: true },
    { key: '22', label: '暴击伤害', percent: true },
    { key: '23', label: '元素充能效率', percent: true }
];
/** 天赋位次（Enka `skillLevelMap` 键的末位）→ 中文 */
export const TALENT_POSITION_CN = {
    1: '普攻',
    2: '战技',
    3: '爆发'
};
/* ---------- 命令正则表（2026-10-15 用户决定重构：合并成单一表） ---------- */
/**
 * 命令正则表
 *
 * 2026-10-15 用户定：旧 `#DPS…` 命令族整体废除，命令面按**功能**重新命名（保留 `#DPS榜` 与 `#DPS帮助`）：
 *
 * | 功能 | 命令 | 原命令 |
 * |---|---|---|
 * | DPS 榜（含角色档位视图） | `#DPS榜` / `#DPS`（榜字可省） | 合并 `#DPS榜` + `#DPS榜 胡桃` |
 * | 榜单视频 | `#DPS榜 … 视频N` / `#危战 … n6\|n7 视频N`（**后缀式**） | 原 `#视频` / `#危战视频`（已废除） |
 * | 危战分档 | `#危战 <筛选> n6\|n7` | `#危战`（已废除） |
 * | 插件状态 | `#meta状态` | `#meta状态` |
 * | 榜单数据刷新（仅主人） | `#榜单刷新` | `#榜单刷新` / `#榜单刷新` / `#榜单刷新` |
 * | 帮助 | `#DPS帮助`（保留，与 `#DPS榜` 同族） | 不变 |
 *
 * ⚠ **危战必带档位**：裸 `#危战` / `#危战数据` / `#危战排名` / `#危战单人` 都是 miao-plugin 的命令
 *   （它是 `priority: 1`，永远先跑）。我们只认"带 n6/n7"的形态；`raidTiersPrompt` 只负责
 *   "写了筛选但忘了档位"时的提示。命名冲突结论见 docs/功能与命令.md。
 */
export const RULES = {
    /**
     * `#DPS榜 [角色] [金数|金数区间|总榜] [标签] [主C] [绿玩] [页N] [视频N]`（`榜` 字可省 = `#DPS`）
     *
     * 2026-10-27 用户定：
     *   - **必须带 `#`**：裸词 `dps`（英文常用词）不再被认领，避免聊天里误触发（原 `^#?` 的 bug）；
     *   - 不带参数 = 全库各金档最高伤害队伍；`总榜` = 不分组、按伤害排序；`12金` = ≤12 金；
     *     带角色 = 该角色各金档；角色 + 金数 = 该角色在该金数内的平铺榜单。
     *
     * `视频N` 是**后缀式**视频名次（2026-10-15 用户定：原 `#视频 <名次>` 前缀式**已废除**），
     * 序号 = 在当前筛选（含金数）之内按伤害排名的第 N 名，由 app 用 `takeVideoToken` 摘出。
     */
    rank: /^#(?:dps|DPS)(?:榜(?!视频))?(?!榜|视频|帮助|状态|更新|强制|刷新|练度|危战)\s*([\s\S]*)$/,
    /**
     * `#危战 <版本/首领/角色> n6|n7 [视频N]` —— 档位**必填**；`视频N` 是后缀式视频名次
     * （第 3 组；名次按全榜排序，与档页每行标的「全榜 #N」同口径）。
     */
    /*
     * 档位必须是**独立词**：`n6` / `6` / `6档` 且**前面是空白或开头**、**后面不是数字**。
     * 2026-10-17 复审修复：旧版 `(?:n|N)?([67])(?:档)?` 前面没有任何边界约束，于是
     *   `#危战 矮灵 视频6` → 把 `视频6` 的末位当档位（本应"请选档"）；
     *   `#危战 胡桃 金:16` → 把 `16` 的 `6` 当档位（本应"请选档"）。
     * 现在 `(?:^|\s)` + `(?!\d)` 双保险，`视频N` 仍走第 3 组。
     */
    raidTiers: /^#?危战\s+([\s\S]*?)\s*(?:(?<=\s|^)(?:n|N)?([67])(?:档)?)(?!\d)(?:\s*视频\s*(\d+))?\s*$/,
    /** `#危战 <筛选>`（没写档位 → app 回"请选档"提示；裸 `#危战` 不在此列，留给 miao） */
    raidTiersPrompt: /^#?危战\s+([\s\S]+)$/,
    /**
     * `#练度查询 胡桃 [UID]` —— 攻略目标 × 当前配装
     *
     * UID 可省略：账号默认走 miao 的米游社绑定。
     */
    grade: /^#?练度查询(?:\s+([\s\S]+))?$/,
    /**
     * `#队伍伤害<N> 胡桃 行秋 夜兰 钟离 暴击+20` —— 整队关键伤害 + 同阵容参考
     *
     * 轴 = 配置项 `teamDamageAxes` 里的序号轴（省略 = 1）；词条**免前缀**；旧 `轴:`/`词条:` 已废除。
     * ⚠ `(\d{1,2})?` 只吃 1~2 位数字：`#队伍伤害 123456789 胡桃 …` 里的 9 位 UID 不会被当轴序号。
     */
    teamDamage: /^#?队伍伤害\s*(\d{1,2})?(?:\s+([\s\S]+))?$/,
    /** `#meta状态` */
    status: /^#?meta状态$/,
    /**
     * `#榜单刷新`（master）—— 立即重新抓取榜单缓存
     *
     * 与云崽的**插件自更新** `#更新meta` 刻意用不同词根（"刷新数据" vs "更新插件"），避免记混；
     * 旧 `#榜单刷新` / `#榜单刷新` / `#榜单刷新` 行为完全一样（都是忽略 TTL 重抓），故只留一条。
     */
    admin: /^#?榜单刷新$/,
    /** `#DPS帮助`（保留：与 `#DPS榜` 同族） */
    help: /^#?(?:dps|DPS)帮助$/
};
/**
 * 消息命中的命令（顺序 = 判定顺序）
 *
 * `rank` 放最后兜底；`raidTiers` 在 `raidTiersPrompt` 之前（带档位的先匹配）。
 * 视频名次没有独立规则：它是 `rank` / `raidTiers` / `raidTiersPrompt` 参数里的 `视频N` 后缀
 * （2026-10-15 用户定：原 `#视频` / `#危战视频` 前缀式**废除**）。
 */
export function matchCommand(msg) {
    const text = String(msg ?? '');
    const order = [
        'raidTiers', 'admin', 'help', 'status', 'grade', 'teamDamage', 'raidTiersPrompt', 'rank'
    ];
    for (const key of order) {
        const match = text.match(RULES[key]);
        if (match)
            return { key, match };
    }
    return null;
}
/**
 * 命令元数据表（顺序 = 帮助页展示顺序）
 *
 * `test/dps-commands.test.mjs` 有一条门禁：**文案里出现的每个命令都必须被该 app 的正则命中**。
 */
export const COMMANDS = [
    { key: 'rank', rules: ['rank'], name: 'MetaDPS榜', dsc: '#DPS榜 [角色] [金数|总榜] [标签] [主C] [绿玩] [页N]（榜字可省；不带参数=各金档最高伤害；12金/9-12金=该金数的榜单；总榜=全库按伤害；加 `视频N` 取该名次的视频）', permission: 'all', priorityOffset: 0 },
    { key: 'raidTiers', rules: ['raidTiers', 'raidTiersPrompt'], name: 'Meta危战档位', dsc: '#危战 [版本/首领/角色] n6|n7 [视频N] — 幽境危战分档（n7 ≤70s 速通档 / n6 险胜档）', permission: 'all', priorityOffset: -5 },
    { key: 'grade', rules: ['grade'], name: 'Meta练度提升指南', dsc: '#练度查询 胡桃 — 攻略目标 × 当前配装 → 总体练度 + 面板档 + 提升建议', permission: 'all', priorityOffset: -5 },
    { key: 'teamDamage', rules: ['teamDamage'], name: 'Meta队伍伤害', dsc: '#队伍伤害<N> 胡桃 行秋 夜兰 钟离 [暴击+20 爆伤+40] — 整队关键伤害 + 参考 DPS + 同阵容参考（N = 轴序号，省略 = 1）', permission: 'all', priorityOffset: -5 },
    { key: 'status', rules: ['status'], name: 'Meta状态', dsc: '#meta状态', permission: 'all', priorityOffset: -10 },
    { key: 'help', rules: ['help'], name: 'Meta帮助', dsc: '#DPS帮助', permission: 'all', priorityOffset: -10 },
    { key: 'admin', rules: ['admin'], name: 'Meta数据管理', dsc: '#榜单刷新 — 立即重新抓取榜单缓存（仅主人）', permission: 'master', priorityOffset: -10 }
];
//# sourceMappingURL=constants.js.map