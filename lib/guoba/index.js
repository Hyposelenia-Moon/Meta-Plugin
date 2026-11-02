/**
 * 锅巴（guoba-plugin）配置界面
 *
 * 对应 `defSet/config.yaml` 的模板变量：`meta_priority` / `meta_renderScale` / `meta_networkEnabled` /
 * `meta_proxy` / `meta_dpsTimeoutMs` / `meta_dpsCacheTtlMinutes` / `meta_dpsPageSize` / `meta_dpsAvatarEnabled` /
 * `meta_module_<模块键>` × 10（模块开关：配置文件里是嵌套的 `modules:`，表单按模块逐项）
 *
 * 界面分组（2026-11-02 更新）：
 *   「模块开关」（功能层：命令是否响应）→「数据源与联网」（查询联网层 + mhydps.cn 数据源）
 *   →「练度评分」（只保留仍可调的面板三档）。练度权重 / 维度达标线 / 九档阈值 / 圣遗物评分曲线已写死，
 *   对应的旧配置键从面板移除（见 `HIDDEN_CONFIG_FIELDS`），但键仍保留在配置与模板中供旧版本读取。
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
    gradeRule: 'meta_gradeRule',
    gradeRuleOverrides: 'meta_gradeRuleOverrides',
    teamDamageAxes: 'meta_teamDamageAxes'
};
/**
 * 已从锅巴面板移除的配置键（2026-11-02）
 *
 * 这些项对应的能力已被写死口径或命令废弃取代：
 *   - `gradeWeights` / `gradeRule` / `gradeRuleOverrides`：练度权重与规则改为按预设写死；
 *   - `gradeRankThresholds`：九档阈值写死；
 *   - `teamDamageAxes`：`#队伍伤害` 的内置序号轴已废除，改用录制轴文件。
 * 键仍保留在 `MetaConfig` 与 `defSet` 模板中，旧配置可读；表单不再展示，保存时按默认值写回。
 */
export const HIDDEN_CONFIG_FIELDS = [
    'gradeWeights', 'gradeRankThresholds', 'gradeRule', 'gradeRuleOverrides', 'teamDamageAxes'
];
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
            title: '原神攻略 · 排行练度',
            author: '@Hyposelenia',
            authorLink: 'https://github.com/Hyposelenia-Moon',
            link: 'https://github.com/Hyposelenia-Moon/Meta-Plugin',
            isV3: true,
            isV2: false,
            description: '原神角色攻略（六模块一图）+ DPS / 危战 + 练度查询（9 个模块可逐项开关）',
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
                // ==================== 数据源与联网（mhydps.cn + 查询联网） ====================
                { label: '数据源与联网 · mhydps.cn', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'networkEnabled',
                    label: '启用业务查询联网',
                    helpMessage: '关闭后 DPS / 危战 / 练度等**查询类**远程请求一律不发（攻略查询完全离线可用）',
                    bottomHelpMessage: '默认关闭。⚠ 只管辖查询类远程访问，不是整个插件的全局联网禁令：别名服务、可选插件探测、依赖安装等不受它影响',
                    component: 'Switch',
                    required: true,
                    componentProps: { defaultValue: false }
                },
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
                    helpMessage: '排行成图每页展示的记录数',
                    bottomHelpMessage: '默认 10，上限 20（条数过多会让图片过长）',
                    component: 'InputNumber',
                    required: true,
                    componentProps: { min: 1, max: 20, defaultValue: 10 }
                },
                {
                    field: 'dpsAvatarEnabled',
                    label: '缓存角色立绘',
                    helpMessage: '是否下载并缓存排行角色立绘',
                    bottomHelpMessage: '默认开启。关闭后成图里以角色名文字占位（不再请求站点图片）',
                    component: 'Switch',
                    required: true,
                    componentProps: { defaultValue: true }
                },
                // ==================== 练度评分 ====================
                // 2026-11-02：口径改为写死（权重 / 达标线 / 九档阈值 / 圣遗物评分曲线），
                // 面板只保留仍可调的面板三档；旧权重 / 阈值 / 规则项已从界面移除（配置键保留）。
                { label: '练度评分', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'gradePanelTiers',
                    label: '面板三档阈值',
                    helpMessage: '大毕业 / 毕业 / 小毕业 的分界（按面板目标平均达成度），默认 0.9 / 0.6 / 0.3',
                    bottomHelpMessage: '综合权重、维度达标线、九档与圣遗物评分曲线已写死；本项是练度页唯一仍可调的参数',
                    component: 'Input',
                    required: false,
                    componentProps: { placeholder: 'big:0.9,normal:0.6,small:0.3' }
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