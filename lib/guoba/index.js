/**
 * 锅巴（guoba-plugin）配置界面
 *
 * 对应 `defSet/config.yaml` 的模板变量：`meta_priority` / `meta_renderScale` / `meta_networkEnabled` /
 * `meta_proxy` / `meta_dpsTimeoutMs` / `meta_dpsCacheTtlMinutes` / `meta_dpsPageSize` / `meta_dpsAvatarEnabled` /
 * `meta_akashaEnabled` / `meta_akashaDefaultUid` / `meta_akashaProxy` / `meta_akashaTimeoutMs` /
 * `meta_akashaCacheTtlMinutes` / `meta_akashaMaxChars`
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
import { configFile, defaultConfig, exampleFile } from '../components/config.js';
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
    akashaMaxChars: 'meta_akashaMaxChars'
};
/** 模板变量兜底值（字符串形态；取自 defaultConfig，保证示例文件与代码默认值同源） */
const DEFAULTS = Object.fromEntries(Object.entries(TEMPLATE_VARS).map(([field, varName]) => [
    varName,
    String(defaultConfig[field] ?? '')
]));
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
            description: '原神角色攻略（六模块一图）+ DPS / 危战榜单 + 练度查询',
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
                // ==================== 联网 ====================
                { label: '联网（榜单 / 练度）', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'networkEnabled',
                    label: '启用联网功能',
                    helpMessage: '关闭后榜单 / 危战 / 练度一律不发请求',
                    bottomHelpMessage: '默认关闭：攻略查询完全离线可用；要查榜单与练度时再打开',
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
                { label: '数据源二 · akasha.cv（练度查询）', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'akashaEnabled',
                    label: '启用练度查询',
                    helpMessage: '练度数据来自 akasha.cv（mhydps.cn 没有练度排名）',
                    bottomHelpMessage: '关闭后 #练度查询 只提示未启用，不发任何请求',
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
                { label: '练度评分 · 权重与档位', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'gradeWeights',
                    label: '练度评分权重',
                    helpMessage: '面板 / 武器 / 圣遗物 / 天赋 的权重',
                    bottomHelpMessage: '写法 panel:30,weapon:20,artifact:35,talent:15；只对攻略里有目标的维度加权（改权重不用改代码）',
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