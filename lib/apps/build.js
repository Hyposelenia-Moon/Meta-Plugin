/**
 * `#练度榜 <角色> [名次]` —— 数据源 akasha.cv 的**阿卡莎角色榜**（2026-10-16 与 `#配装` 合并）
 *
 * 一条命令两个视图（按有没有写名次分流）：
 *   省略名次 → **前 20 名列表**（模板 `build`）
 *   写名次   → **该名次的配装详情**（模板 `akasha-build`；原 `#配装 胡桃 [名次]` 命令已按用户决定删除，不做别名）
 *
 * 本命令与查询者账号**无任何关系**：不解析、不接受、不显示任何 UID（连上榜者的也不展示）；
 * 名次与配装全部来自榜单条目（取数见 `model/AkashaBoard.ts` 的浏览器会话）。
 * 纯数字参数（如 9 位 UID）→ 静默不回复；完全空参数 → 回用法提示。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 *   参数解析在 `modules/akashaBoard.ts` 的 `parseBoardArgs`，文本回退在 `modules/formatText.ts` 的 `buildText`。
 */
import { getAkashaEnabled, getPluginConfig } from '../components/config.js';
import { COMMANDS, COPYRIGHT, RULES, formatTime } from '../components/constants.js';
import { setSummary } from '../components/presentation.js';
import { panelSummary, parseBoardArgs, pickByRank } from '../modules/akashaBoard.js';
import { buildText } from '../modules/formatText.js';
import { respond } from '../modules/respond.js';
import { fetchBoard } from '../model/AkashaBoard.js';
import { findCharacter } from '../model/CharacterIndex.js';
// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js';
import { moduleGateReply } from '../modules/moduleGate.js';
const META = COMMANDS.find(c => c.rules.includes('build'));
const TITLE = '#练度榜';
const USAGE = [
    `${TITLE} <角色> — 该角色的阿卡莎角色榜前 20 名`,
    `${TITLE} <角色> <名次> — 该名次的配装详情（1~50）`,
    `例：${TITLE} 胡桃　${TITLE} 胡桃 1`
].join('\n');
/**
 * 角色名 → CSS 元素类（`body.elem-*`）
 *
 * `resources/common/base.css:229` 用 `body.elem-{元素}` 给出 `--page-art`（**元素底**）与元素强调色；
 * 元素取自本地角色表（`findCharacter().element`，如 `Anemo` → `anemo`），
 * 取不到就返回空串 —— 页面退回 `--page-gradients` 的中性兜底（不报错）。
 */
function elementClassOf(name) {
    return String(findCharacter(name)?.element || '').trim().toLowerCase();
}
export class MetaBuild extends plugin {
    constructor() {
        super({
            name: META.name,
            dsc: META.dsc,
            event: 'message',
            priority: getPluginConfig()?.priority
                ? Number(getPluginConfig().priority) + META.priorityOffset
                : 8000 + META.priorityOffset,
            rule: [
                { reg: RULES.build, fnc: 'handleBuild', permission: META.permission }
            ]
        });
    }
    /**
     * `#练度榜 <角色> [名次]`：取榜单（浏览器会话）→ 按有没有名次分流 → 出图，失败一律回退文本
     */
    async handleBuild(e) {
        if (await moduleGateReply('build', e))
            return true;
        const text = (String(e.msg).match(RULES.build) || [])[1] || '';
        if (!getAkashaEnabled()) {
            await e.reply('[Meta] 阿卡莎数据通道已关闭（锅巴 → 数据源二 · akasha.cv → 阿卡莎数据通道）；'
                + '注意这与「模块开关」不同：模块开关关闭时命令直接不响应');
            return true;
        }
        const { names, rank, rankGiven, sawNumericOnly } = parseBoardArgs(text);
        if (!names.length) {
            // 只给数字（如 9 位 UID）→ 按用户要求静默不回复；完全空参数才给用法提示
            if (sawNumericOnly)
                return true;
            await e.reply(`[Meta] 用法：\n${USAGE}`);
            return true;
        }
        const charName = names.join(' ');
        const board = await fetchBoard(charName);
        if (!board.ok) {
            await e.reply(`[Meta] ${board.error}`);
            return true;
        }
        return rankGiven
            ? await this.replyBuildDetail(e, board, charName, rank)
            : await this.replyBoardList(e, board, charName);
    }
    /** 列表视图（省略名次）：前 20 名；`first` 只用于头卡（第 1 名那一行在列表里高亮） */
    async replyBoardList(e, board, charName) {
        const first = board.entries[0];
        const boardData = {
            title: `${TITLE} ${charName}`,
            subtitle: `阿卡莎角色榜｜前 20 名（共收录 ${board.total} 条）`,
            hint: '名次与结果均为 akasha 口径',
            footerMethod: '数据来源：阿卡莎角色榜（榜单数据，与查询者账号无关）',
            rank: first ? String(first.rank) : '-',
            charName: first ? first.charNameCn : charName,
            elemClass: elementClassOf(first ? first.charNameCn : charName),
            cons: first ? first.cons : 0,
            nickname: first ? first.nickname : '',
            buildTimeText: first && first.lastBuildUpdate ? formatTime(first.lastBuildUpdate) : '时间未提供',
            rows: board.entries.map(x => ({
                label: `#${x.rank}`,
                name: x.nickname || '匿名',
                cons: x.cons,
                isCurrent: first ? x.rank === first.rank : false,
                // 站点没给精炼时**不写 `R0`**（与详情页的「精N」写法一致：0 = 不显示）
                weaponText: x.weapon ? `${x.weapon.nameCn}${x.weapon.affix ? ` R${x.weapon.affix}` : ''}` : '—',
                /*
                 * 套装走 `nameCn`（站点 textmap 的**官方中文名**，如 纺月的夜歌 / 晨星与月的晓歌），
                 * 并按全站同一份套装表述规则（`components/presentation.ts` 的 `setSummary`）：
                 * 只写 4 件套 / 2+2 / 2 件套，**不列单件散件**，凑不出套装加成就写「散件」。
                 */
                setsText: x.sets && x.sets.length
                    ? setSummary(x.sets.map(s => ({ name: s.nameCn, count: s.count })))
                    : '—',
                damageText: Math.round(x.damage).toLocaleString('en-US')
            })),
            copyright: COPYRIGHT
        };
        return await respond(e, 'build', boardData, () => `${TITLE} ${charName}（前 20 名，共 ${board.total} 条）`);
    }
    /** 详情视图（写了名次）：该名次的配装；名次越界给可读提示（不静默、不出空图） */
    async replyBuildDetail(e, board, charName, rank) {
        const entry = pickByRank(board.entries, rank);
        if (!entry) {
            await e.reply(`[Meta] 这个榜单只有 ${board.total} 条（你要的是第 ${rank} 名）；可用名次 1~${board.total}`);
            return true;
        }
        const data = {
            title: `${TITLE} ${charName} ${entry.rank}`,
            subtitle: `阿卡莎角色榜第 ${entry.rank} 名｜共收录 ${board.total} 条`,
            charName: entry.charNameCn,
            elemClass: elementClassOf(entry.charNameCn || charName),
            rank: entry.rank,
            nickname: entry.nickname,
            cons: entry.cons,
            damageText: Math.round(entry.damage).toLocaleString('en-US'),
            critValueText: entry.critValue.toFixed(1),
            talent: entry.talent,
            weapon: entry.weapon
                ? { ...entry.weapon, text: `${entry.weapon.nameCn}${entry.weapon.affix ? ` 精${entry.weapon.affix}` : ''}` }
                : null,
            artis: entry.artis,
            // 套装与列表行同规则（只写 4 件套 / 2+2 / 2 件套；凑不出加成写「散件」，不列单件散件）
            setsText: entry.sets.length ? setSummary(entry.sets.map(s => ({ name: s.nameCn, count: s.count }))) : '',
            panel: panelSummary(entry),
            /*
             * 展示层投影（2026-10-15 UI 重构「档案批注」）：章节 + 来源条。
             *
             * 来源时间**暂时留空**（页面写"时间未提供"）：阿卡莎条目的字段单位（秒/毫秒/原文）还没核对，
             * 按设计规格的口径，宁可不写也不能拿本次抓取时间冒充数据更新时间（现场核对 §一）。
             */
            mx: {
                sections: [
                    { index: '01', title: '伤害与评分' },
                    { index: '02', title: '配装' },
                    { index: '03', title: '面板' }
                ],
                sources: [{ source: 'akasha', name: '阿卡莎角色榜', mode: 'cache', modeText: '缓存数据', updatedAt: '', observedAt: 0 }],
                hint: '伤害、双爆分与名次是不同量纲，分别成槽，不互相换算。'
            },
            copyright: COPYRIGHT
        };
        return await respond(e, 'akasha-build', data, () => buildText(entry, rank));
    }
}
//# sourceMappingURL=build.js.map