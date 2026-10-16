/**
 * 锅巴（guoba-plugin）配置界面
 *
 * 对应 `defSet/config.yaml` 的模板变量：`meta_priority` / `meta_renderScale` / `meta_networkEnabled` /
 * `meta_proxy` / `meta_dpsTimeoutMs` / `meta_dpsCacheTtlMinutes` / `meta_dpsPageSize` / `meta_dpsAvatarEnabled` /
 * `meta_akashaEnabled` / `meta_akashaDefaultUid` / `meta_akashaProxy` / `meta_akashaTimeoutMs` /
 * `meta_akashaCacheTtlMinutes` / `meta_akashaMaxChars` /
 * `meta_module_<模块键>` × 10（模块开关：配置文件里是嵌套的 `modules:`，表单按模块逐项）
 *
 * 三层开关的界面分组（2026-10-15 起）：
 *   「模块开关」（功能层：命令是否响应）→「业务查询联网」（查询联网层）→「数据源二 · akasha」（数据通道层）。
 *   三者正交，说明文字不得互相替代（见 `AGENTS.md` 硬约束 8/12）。
 *
 * 沿用 Mhydps-Plugin 的三条约定：
 *   1. 字段名 → 模板变量名的映射集中在 `TEMPLATE_VARS`（用 `Record<keyof MetaConfig, string>` 让 tsc 保证不漏键）；
 *   2. 保存时**读 defSet 模板做 `${变量}` 替换**后整篇写入，**绝不 `YAML.stringify` 重写**（否则注释与键序全丢）；
 *   3. 路径走 `components/config.ts` 的 `configFile()` / `exampleFile()`，因此同样支持 `META_CONFIG_FILE` 覆盖
 *      （回归套件用它把读写指向临时目录，不碰仓库里的 `config/config.yaml`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { pluginRoot } from '../dir.js';
import { configFile, defaultConfig, defaultModules, exampleFile, MODULE_KEYS, MODULE_LABELS } from '../components/config.js';
const DEFSET_CONFIG_PATH = path.join(pluginRoot, 'defSet', 'config.yaml');
/** guoba 字段 → defSet 模板变量名 */
const TEMPLATE_VARS = {
    priority: 'meta_priority',
    renderScale: 'meta_renderScale',
    networkEnabled: 'meta_networkEnabled',
    proxy: 'meta_proxy',
    dpsTimeoutMs: 'meta_dpsTimeoutMs',
    dpsCacheTtlMinutes: 'meta_dpsCacheTtlMinutes',
    dpsPageSize: 'meta_dpsPageSize',
    dpsAvatarEnabled: 'meta_dpsAvatarEnabled',
    gradeWeights: 'meta_gradeWeights',
    gradePanelTiers: 'meta_gradePanelTiers',
    gradeRankThresholds: 'meta_gradeRankThresholds',
    akashaEnabled: 'meta_akashaEnabled',
    akashaDefaultUid: 'meta_akashaDefaultUid',
    akashaProxy: 'meta_akashaProxy',
    akashaTimeoutMs: 'meta_akashaTimeoutMs',
    akashaCacheTtlMinutes: 'meta_akashaCacheTtlMinutes',
    akashaMaxChars: 'meta_akashaMaxChars',
    teamDamageAxes: 'meta_teamDamageAxes'
};
/**
 * 模块开关：每个模块一个 guoba 字段 + 一个模板变量
 *
 * 配置文件里它们是 `modules:` 下的嵌套键（便于阅读与手改），但锅巴表单是**逐项** Switch，
 * 所以这里走"字段 `module_<key>` ↔ 变量 `meta_module_<key>`"的映射，由 get/setConfigData 负责换算。
 */
const MODULE_VARS = Object.fromEntries(MODULE_KEYS.map(key => [key, `meta_module_${key}`]));
/** guoba 表单里的模块开关字段名 */
export function moduleField(key) {
    return `module_${key}`;
}
/**
 * 模块开关的界面说明
 *
 * ⚠ 接管类（攻略 / 帮助）关闭时是"不认领、放行"，其他模块是"回一条提示"，说明文字不能写同一句。
 */
const MODULE_HELP = Object.fromEntries(MODULE_KEYS.map(key => [
    key,
    (key === 'codex' || key === 'help')
        ? {
            help: '关闭后本插件不接管该入口：放行给 genshin「米游社攻略」/ Atlas',
            bottom: `配置键 modules.${key}，默认${defaultModules[key] ? '开启' : '关闭'}`
        }
        : {
            help: '关闭后该模块的命令不响应：回一条「已在配置中关闭」的提示',
            bottom: `配置键 modules.${key}，默认${defaultModules[key] ? '开启' : '关闭'}`
        }
]));
/** 模板变量兜底值（字符串形态；取自 defaultConfig，保证示例文件与代码默认值同源） */
const DEFAULTS = {
    ...Object.fromEntries(Object.entries(TEMPLATE_VARS).map(([field, varName]) => [
        varName,
        String(defaultConfig[field] ?? '')
    ])),
    // 模块开关的兜底值（`true` / `false` 文本，正好是 YAML 布尔）
    ...Object.fromEntries(MODULE_KEYS.map(key => [MODULE_VARS[key], String(defaultModules[key])]))
};
/** 读运行时配置：`config.yaml` > `config.yaml.example` > 空对象 */
function readConfig() {
    const file = fs.existsSync(configFile())
        ? configFile()
        : (fs.existsSync(exampleFile()) ? exampleFile() : '');
    if (!file)
        return {};
    try {
        return (YAML.parse(fs.readFileSync(file, 'utf8')) || {});
    }
    catch (err) {
        logger?.error(`[Meta][锅巴] 解析配置失败：${err?.message || err}`);
        return {};
    }
}
export function supportGuoba() {
    return {
        pluginInfo: {
            name: 'Meta-Plugin',
            title: '原神攻略 · 榜单练度',
            author: '@Hyposelenia',
            authorLink: 'https://github.com/Hyposelenia-Moon',
            link: 'https://github.com/Hyposelenia-Moon/Meta-Plugin',
            isV3: true,
            isV2: false,
            description: '原神角色攻略（六模块一图）+ DPS / 危战榜单 + 练度查询（13 个模块可逐项开关）',
            icon: 'mdi:book-open-variant',
            iconColor: '#4a9eff'
        },
        configInfo: {
            schemas: [
                // ==================== 基础设置 ====================
                { label: '基础设置', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'priority',
                    label: '优先级',
                    helpMessage: '常规查询命令的优先级，数字越小越先执行',
                    bottomHelpMessage: '默认 8000。攻略模块的抢占优先级（-100000）写死在代码里，不受本项影响',
                    component: 'InputNumber',
                    required: true,
                    componentProps: { min: -99999, max: 99999, defaultValue: 8000 }
                },
                {
                    field: 'renderScale',
                    label: '渲染缩放',
                    helpMessage: 'HTML 渲染时的缩放比例',
                    bottomHelpMessage: '默认 1.5，越大图片越清晰但渲染越慢',
                    component: 'InputNumber',
                    required: true,
                    componentProps: { min: 0.5, max: 3, step: 0.1, defaultValue: 1.5 }
                },
                // ==================== 模块开关（功能层：命令是否响应） ====================
                {
                    label: '模块开关（功能层）',
                    component: 'SOFT_GROUP_BEGIN'
                },
                {
                    field: moduleField('teamDamage'),
                    label: `${MODULE_LABELS.teamDamage}（默认关闭）`,
                    helpMessage: MODULE_HELP.teamDamage.help,
                    bottomHelpMessage: MODULE_HELP.teamDamage.bottom,
                    component: 'Switch',
                    required: true,
                    componentProps: { defaultValue: defaultModules.teamDamage }
                },
                ...MODULE_KEYS.filter(key => key !== 'teamDamage').map(key => ({
                    field: moduleField(key),
                    label: MODULE_LABELS[key],
                    helpMessage: MODULE_HELP[key].help,
                    bottomHelpMessage: MODULE_HELP[key].bottom,
                    component: 'Switch',
                    required: true,
                    componentProps: { defaultValue: defaultModules[key] }
                })),
                // ==================== 业务查询联网（查询联网层） ====================
                { label: '业务查询联网（查询联网层）', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'networkEnabled',
                    label: '启用业务查询联网',
                    helpMessage: '关闭后 DPS 榜 / 危战 / 练度等**查询类**远程请求一律不发（攻略查询完全离线可用）',
                    bottomHelpMessage: '默认关闭。⚠ 只管辖查询类远程访问，不是整个插件的全局联网禁令：别名服务、可选插件探测、依赖安装等不受它影响',
                    component: 'Switch',
                    required: true,
                    componentProps: { defaultValue: false }
                },
                // ==================== 数据源一 · mhydps.cn ====================
                { label: '数据源一 · mhydps.cn（DPS榜 / 危战榜）', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'proxy',
                    label: '请求代理',
                    helpMessage: '抓取 mhydps.cn 使用的代理，留空 = 直连',
                    bottomHelpMessage: '实测国内直连 www.mhydps.cn 会被重置（TLS 握手 RST），通常需要本地代理，如 http://<代理主机>:<端口>',
                    component: 'Input',
                    required: false,
                    componentProps: { placeholder: 'http://<代理主机>:<端口>' }
                },
                {
                    field: 'dpsTimeoutMs',
                    label: '请求超时（毫秒）',
                    helpMessage: '单次请求的最大等待时间',
                    bottomHelpMessage: '默认 30000 = 30 秒；走代理较慢时可适当调大',
                    component: 'InputNumber',
                    required: true,
                    componentProps: { min: 3000, max: 120000, step: 1000, defaultValue: 30000 }
                },
                {
                    field: 'dpsCacheTtlMinutes',
                    label: '缓存有效期（分钟）',
                    helpMessage: '超过后下一次查询自动重新拉取',
                    bottomHelpMessage: '默认 30 分钟；站点数据更新不频繁，调小会增加请求次数',
                    component: 'InputNumber',
                    required: true,
                    componentProps: { min: 1, max: 1440, defaultValue: 30 }
                },
                {
                    field: 'dpsPageSize',
                    label: '每页条数',
                    helpMessage: '榜单成图每页展示的记录数',
                    bottomHelpMessage: '默认 10，上限 20（条数过多会让图片过长）',
                    component: 'InputNumber',
                    required: true,
                    componentProps: { min: 1, max: 20, defaultValue: 10 }
                },
                {
                    field: 'dpsAvatarEnabled',
                    label: '缓存角色立绘',
                    helpMessage: '是否下载并缓存榜单角色立绘',
                    bottomHelpMessage: '默认开启。关闭后成图里以角色名文字占位（不再请求站点图片）',
                    component: 'Switch',
                    required: true,
                    componentProps: { defaultValue: true }
                },
                // ==================== 数据源二 · akasha.cv ====================
                { label: '数据源二 · akasha.cv（练度名次榜单）', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'akashaEnabled',
                    label: '阿卡莎数据通道（数据通道层）',
                    helpMessage: '练度数据来自 akasha.cv（mhydps.cn 没有练度排名）；本项只控制"能不能走阿卡莎通道"',
                    bottomHelpMessage: '⚠ 与「模块开关」正交：关掉它，模块即使开着也取不到练度数据；关掉 modules.build 则命令直接不响应',
                    component: 'Switch',
                    required: true,
                    componentProps: { defaultValue: true }
                },
                {
                    field: 'akashaDefaultUid',
                    label: '默认 UID',
                    helpMessage: '练度查询命令里不写 UID 时用它',
                    bottomHelpMessage: '填了以后可以直接「#练度查询 胡桃」；留空则必须带 9 位 UID',
                    component: 'Input',
                    required: false,
                    componentProps: { placeholder: '123456789' }
                },
                {
                    field: 'akashaProxy',
                    label: '请求代理（akasha）',
                    helpMessage: 'akasha.cv 的代理，留空 = 直连',
                    bottomHelpMessage: 'akasha 通常可直连；只有本机确实需要时才填',
                    component: 'Input',
                    required: false,
                    componentProps: { placeholder: '留空 = 直连' }
                },
                {
                    field: 'akashaTimeoutMs',
                    label: '请求超时（毫秒，akasha）',
                    helpMessage: 'akasha 取数单次最大等待',
                    bottomHelpMessage: '默认 60000 = 60 秒；需要浏览器会话取数时会明显偏慢',
                    component: 'InputNumber',
                    required: true,
                    componentProps: { min: 5000, max: 180000, step: 1000, defaultValue: 60000 }
                },
                {
                    field: 'akashaCacheTtlMinutes',
                    label: '缓存有效期（分钟，akasha）',
                    helpMessage: '练度数据缓存多久',
                    bottomHelpMessage: '默认 30 分钟；接口非官方，调太小容易触发限流',
                    component: 'InputNumber',
                    required: true,
                    componentProps: { min: 1, max: 1440, defaultValue: 30 }
                },
                {
                    field: 'akashaMaxChars',
                    label: '最多展示角色数（akasha）',
                    helpMessage: '一次练度查询最多列几个角色',
                    bottomHelpMessage: '默认 12，上限 30；超出按名次先后截断',
                    component: 'InputNumber',
                    required: true,
                    componentProps: { min: 1, max: 30, defaultValue: 12 }
                },
                // ==================== 练度评分（v3 P2） ====================
                // ==================== 队伍伤害 ====================
                { label: '队伍伤害', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'teamDamageAxes',
                    label: '序号轴表',
                    helpMessage: '写法 `序号:名称=轴定义`，多个轴用逗号分隔；轴定义 = 关键词×次数@窗口s（多段用 +）',
                    bottomHelpMessage: '`默认` 或留空 = 保守轴（每人最高单次×1／20s）。例：1:保守轴=默认,2:重击轴=重击×8@20s+元素战技×1；查询时发 #队伍伤害2 四人名',
                    component: 'Input',
                    required: false,
                    componentProps: { placeholder: '1:保守轴=默认,2:重击轴=重击×8@20s+元素战技×1' }
                },
                { label: '练度评分 · 权重与档位', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'gradeWeights',
                    label: '练度评分权重',
                    helpMessage: '综合（圣遗物有效词条）/ 武器 / 天赋 的权重',
                    bottomHelpMessage: '写法 comprehensive:65,weapon:20,talent:15；面板目标不计分、只作参考（旧写法 panel+artifact 会自动相加）',
                    component: 'Input',
                    required: false,
                    componentProps: { placeholder: 'panel:30,weapon:20,artifact:35,talent:15' }
                },
                {
                    field: 'gradePanelTiers',
                    label: '面板三档阈值',
                    helpMessage: '大毕业 / 毕业 / 小毕业 的分界（面板目标平均达成度）',
                    bottomHelpMessage: '写法 big:0.9,normal:0.6,small:0.3',
                    component: 'Input',
                    required: false,
                    componentProps: { placeholder: 'big:0.9,normal:0.6,small:0.3' }
                },
                {
                    field: 'gradeRankThresholds',
                    label: '总体练度九档阈值',
                    helpMessage: 'MAX…C 的分界，低于最后一项记 D',
                    bottomHelpMessage: '写法 MAX:95,ACE:88,SSS:80,SS:72,S:64,A:55,B:45,C:30',
                    component: 'Input',
                    required: false,
                    componentProps: { placeholder: 'MAX:95,ACE:88,SSS:80,SS:72,S:64,A:55,B:45,C:30' }
                }
            ],
            /** 读回当前配置给表单 */
            getConfigData() {
                const cfg = readConfig();
                const out = {};
                for (const [field, varName] of Object.entries(TEMPLATE_VARS)) {
                    out[field] = cfg[field] ?? defaultConfig[field] ?? DEFAULTS[varName];
                }
                // 模块开关：从嵌套的 `modules` 里逐项摊平成表单字段
                const modules = (cfg.modules && typeof cfg.modules === 'object') ? cfg.modules : {};
                for (const key of MODULE_KEYS) {
                    out[moduleField(key)] = modules[key] ?? defaultModules[key];
                }
                return out;
            },
            /** 保存：读 defSet 模板 → 替换 `${变量}` → 整篇写入（保留注释与键序） */
            async setConfigData(data, { Result }) {
                try {
                    if (!fs.existsSync(DEFSET_CONFIG_PATH)) {
                        return Result.error('模板文件 defSet/config.yaml 不存在');
                    }
                    let template = fs.readFileSync(DEFSET_CONFIG_PATH, 'utf8');
                    for (const [field, varName] of Object.entries(TEMPLATE_VARS)) {
                        const raw = data[field];
                        const value = (raw === undefined || raw === null || raw === '') ? (DEFAULTS[varName] ?? '') : raw;
                        // 2026-10-15 审核 P2：第二参是**替换字符串**，用户值里的 `$&`/`$1` 会被当替换语法解释
                        //（实测密码 `pass$&word` 存成 `pass${meta_proxy}word`）→ 改用回调，返回值按字面量插入
                        template = template.replace(new RegExp(`\\$\\{${varName}\\}`, 'g'), () => String(value));
                    }
                    // 模块开关：表单字段 `module_<key>` → 模板变量 `meta_module_<key>`（值就是 `true` / `false`）
                    for (const key of MODULE_KEYS) {
                        const raw = data[moduleField(key)];
                        const value = (raw === undefined || raw === null || raw === '')
                            ? (DEFAULTS[MODULE_VARS[key]] ?? String(defaultModules[key]))
                            : raw;
                        template = template.replace(new RegExp(`\\$\\{${MODULE_VARS[key]}\\}`, 'g'), () => String(value));
                    }
                    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
                    fs.writeFileSync(configFile(), template, 'utf8');
                    return Result.ok({}, '保存成功~');
                }
                catch (err) {
                    logger?.error(`[Meta][锅巴] 保存配置失败：${err?.message || err}`);
                    return Result.error(`保存失败：${err?.message || err}`);
                }
            }
        }
    };
}
//# sourceMappingURL=index.js.map