/**
 * queryArgs — 命令参数解析（合并自 `Mhydps-Plugin/modules/queryArgs.js`，行为逐字等价）
 *
 * 两种写法都支持，方便群友随手打：
 *   显式键值：`#DPS榜 角色:胡桃 金:12 标签:宏 页:2 绿玩 主C`
 *   位置简写：`#DPS榜 胡桃 12金 宏 -p2`
 * 解析只做语法层的事（哪个 token 是什么），角色名/首领名的合法性由查询层校验
 * （唯一例外：位置简写里要靠 `findCharacter` / `findBoss` 判断"这个 token 像不像角色/首领"）。
 */
import { findBoss, findCharacter } from '../model/CharacterIndex.js';
/** 页码：第2页 / 2页 / p2 / -p2 */
const PAGE_RE = /^(?:第)?(\d+)页$|^[pP](\d+)$|^-p(\d+)$/;
/** 金数上限：金≤12 / ≤12 / 金12 / 12金 */
const COST_MAX_RE = /^(?:金|成本)?\s*[≤<=]\s*(\d+)$|^(?:金|成本)(\d+)$|^(\d+)金$/;
/** 金数下限：金≥8 / ≥8 */
const COST_MIN_RE = /^(?:金|成本)?\s*[≥>=]\s*(\d+)$/;
/** 金数区间：8-12金 / 金8-12 */
const COST_RANGE_RE = /^(?:金|成本)?(\d+)\s*[-~到]\s*(\d+)\s*金?$/;
/** 显式键值 */
const KV_RE = /^(角色|名称|name|金|成本|cost|标签|tag|页|page|版本|ver|首领|boss)[:：](.+)$/i;
/** 取三个分组里第一个有值的数字 */
function pickNum(m, ...groups) {
    for (const g of groups) {
        if (m[g] !== undefined)
            return Number(m[g]);
    }
    return NaN;
}
/** 解析通用 token（页码 / 金数 / 绿玩 / 主C），命中返回结果对象，未命中返回 null */
export function parseCommon(token) {
    let m;
    if ((m = token.match(PAGE_RE))) {
        const page = Number(m[1] ?? m[2] ?? m[3]);
        return Number.isFinite(page) ? { page } : null;
    }
    if ((m = token.match(COST_RANGE_RE))) {
        return { costMin: Number(m[1]), costMax: Number(m[2]) };
    }
    if ((m = token.match(COST_MAX_RE))) {
        return { costMax: pickNum(m, 1, 2, 3) };
    }
    if ((m = token.match(COST_MIN_RE))) {
        return { costMin: Number(m[1]) };
    }
    if (/^(绿玩|纯净)$/.test(token))
        return { cleanOnly: true };
    if (/^(主C|主c|主C位|只搜主C)$/.test(token))
        return { mainOnly: true };
    return null;
}
/** 归一化 token：全角冒号/空格、中英文逗号顿号、大小写 */
function tokenize(text) {
    return String(text || '')
        .replace(/：/g, ':')
        .split(/[\s,，、]+/)
        .map(t => t.trim())
        .filter(Boolean);
}
/**
 * 解析 DPS 榜参数
 *
 * @param text 去掉命令前缀后的参数部分
 */
export function parseRankArgs(text) {
    const args = {
        char: '',
        costMin: null,
        costMax: null,
        tag: '',
        cleanOnly: false,
        mainOnly: false,
        page: 1,
        unknown: []
    };
    for (const token of tokenize(text)) {
        const kv = token.match(KV_RE);
        if (kv) {
            const key = kv[1].toLowerCase();
            const value = kv[2].trim();
            if (['角色', '名称', 'name'].includes(key))
                args.char = value;
            else if (['金', '成本', 'cost'].includes(key))
                args.costMax = Number(value.replace(/[^\d]/g, '')) || null;
            else if (['标签', 'tag'].includes(key))
                args.tag = value;
            else if (['页', 'page'].includes(key))
                args.page = Number(value.replace(/[^\d]/g, '')) || 1;
            continue;
        }
        const common = parseCommon(token);
        if (common) {
            Object.assign(args, common);
            continue;
        }
        // 剩余 token：第一个当角色名，其余当标签（标签里常含点号/字母，如 总伤杯S3.N）
        if (!args.char && findCharacter(token))
            args.char = token;
        else if (!args.char)
            args.unknown.push(token);
        else
            args.tag = args.tag ? `${args.tag} ${token}` : token;
    }
    return args;
}
/**
 * 解析危战榜参数（多出 版本 / 首领 两个维度）
 */
export function parseRaidArgs(text) {
    const args = {
        char: '',
        ver: '',
        boss: '',
        costMin: null,
        costMax: null,
        page: 1,
        unknown: []
    };
    for (const token of tokenize(text)) {
        const kv = token.match(KV_RE);
        if (kv) {
            const key = kv[1].toLowerCase();
            const value = kv[2].trim();
            if (['角色', '名称', 'name'].includes(key))
                args.char = value;
            else if (['版本', 'ver'].includes(key))
                args.ver = value;
            else if (['首领', 'boss'].includes(key))
                args.boss = value;
            else if (['金', '成本', 'cost'].includes(key))
                args.costMax = Number(value.replace(/[^\d]/g, '')) || null;
            else if (['页', 'page'].includes(key))
                args.page = Number(value.replace(/[^\d]/g, '')) || 1;
            continue;
        }
        const common = parseCommon(token);
        if (common) {
            Object.assign(args, common);
            continue;
        }
        // 版本号形如 7.1
        if (!args.ver && /^\d+\.\d+$/.test(token)) {
            args.ver = token;
            continue;
        }
        if (!args.boss && findBoss(token)) {
            args.boss = token;
            continue;
        }
        if (!args.char && findCharacter(token)) {
            args.char = token;
            continue;
        }
        args.unknown.push(token);
    }
    return args;
}
/**
 * 解析练度查询参数（UID 与角色名可以任意顺序、任意组合）
 *
 *   `#DPS练度查询 123456789`        整号全部公开角色
 *   `#DPS练度查询 胡桃`             只看胡桃（UID 取配置里的 `akashaDefaultUid`）
 *   `#DPS练度查询 胡桃 123456789`   两者都给也行
 *   `#DPS练度查询 uid:123456789 桃` 显式键值同样支持
 *
 * UID 只认 9 位纯数字；角色名交给 `findCharacter` 判定（命中别名也算），
 * 两者都不像的 token 进 `unknown`，由 app 层提示用户。
 */
export function parseBuildArgs(text) {
    const args = { uid: '', names: [], unknown: [] };
    for (const token of tokenize(text)) {
        const kv = token.match(/^(?:uid|UID|米游社id|米游社ID)[:：]?(\d+)$/);
        if (kv) {
            if (!args.uid)
                args.uid = kv[1];
            else
                args.unknown.push(token);
            continue;
        }
        if (/^\d+$/.test(token)) {
            if (token.length === 9 && !args.uid)
                args.uid = token;
            else
                args.unknown.push(token);
            continue;
        }
        if (findCharacter(token))
            args.names.push(token);
        else
            args.unknown.push(token);
    }
    return args;
}
/**
 * 从参数里摘出名次（第一个纯数字 token），其余原样留给 `parseRankArgs` / `parseRaidArgs`
 *
 * 用在视频查询（`#DPS视频 3 胡桃`）：名次与榜单图编号同口径，
 * 其余筛选词与榜单命令完全一致，故这里只负责把数字拆出来。
 */
export function takeRankNo(text) {
    let rankNo = 0;
    const rest = [];
    for (const token of String(text || '').split(/[\s,，]+/).filter(Boolean)) {
        if (!rankNo && /^\d+$/.test(token)) {
            rankNo = Number(token);
            continue;
        }
        rest.push(token);
    }
    return { rankNo, rest: rest.join(' ') };
}
//# sourceMappingURL=queryArgs.js.map