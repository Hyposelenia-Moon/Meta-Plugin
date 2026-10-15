/**
 * `#队伍伤害<N>` —— 整队配装的关键伤害 + 参考 DPS + 同阵容参考（v3 P3 v1 / P4 v2）
 *
 * 例（2026-10-15 用户定：**内置序号轴 + 免前缀词条**）：
 *   `#队伍伤害 胡桃 行秋 夜兰 钟离`                   ← 轴 1（保守轴）
 *   `#队伍伤害2 胡桃 行秋 夜兰 钟离`                  ← 配置里序号 2 的轴
 *   `#队伍伤害2 胡桃 行秋 夜兰 钟离 暴击+20 爆伤+40`  ← 顺带改词条（不必写「词条:」）
 *   （可另附 9 位 UID；账号默认走 miao 的米游社绑定）
 *
 * ⚠ 旧写法 `轴:重击×8@21s` / `词条:暴击率+20` 已**废除**：轴改成配置项 `teamDamageAxes` 里的序号表，
 *   词条直接写属性名（`+30暴击` 与 `暴击+20` 都认）。命中旧写法时给一句改用提示，不再静默当角色名。
 *
 * 口径：
 *   - 每人关键伤害 = miao 的 `avatar.calcDmg()`（与 miao 面板同一套算法），并标注伤害规则来源；
 *   - **参考 DPS** = 轴下各队员伤害之和 ÷ 窗口（保守轴：每人最高单次 ×1／20s，只作横向比较）；
 *   - **词条**是"临时改面板属性后重算"，**不改动** miao 面板里的任何数据；
 *   - 跨角色 buff 叠加（miao 的「组团伤害」）由 miao 系统配置 `teamCalc` 决定，本插件不擅自改配置。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig, getProxy } from '../components/config.js';
import { COPYRIGHT, COMMANDS, RULES } from '../components/constants.js';
import { buildTeamDamageView, parseTeamArgs } from '../modules/teamDamage.js';
import { axisByNo, axesHelpLines } from '../modules/teamAxes.js';
import { teamDps } from '../modules/rotation.js';
import { parseStatPatch, patchLabel } from '../modules/statPatch.js';
import { readTeamDamage } from '../model/MiaoProfile.js';
import { respond } from '../modules/respond.js';
// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js';
import { moduleGateReply } from '../modules/moduleGate.js';
/** 本 app 的命令元数据（见 components/constants.ts 的 COMMANDS） */
const META = COMMANDS.find(c => c.rules.includes('teamDamage'));
/** 轴清单（提示里列出可用序号；只展示序号/名称/窗口，不暴露关键词写法） */
function axisLines() {
    return axesHelpLines(getPluginConfig()?.teamDamageAxes).map(l => `· ${l}`).join('\n');
}
/** 用法提示 */
function usage() {
    return [
        '[Meta] 用法：#队伍伤害<N> 胡桃 行秋 夜兰 钟离 [暴击+20 爆伤+40] [UID]',
        '· N = 内置轴序号（省略 = 1）；词条直接写属性名即可，不必加前缀',
        '· 可用轴：',
        axisLines()
    ].join('\n');
}
/** 文本回退：队员伤害 + 参考 DPS + 同阵容参考 */
export function teamDamageText(members, view, uid, dps, patchText, axisLabel) {
    const lines = [`【队伍伤害】约 ${view.approxCost} 金（${view.costNote}）　UID ${uid}`, ''];
    for (const m of members) {
        lines.push(`· ${m.charName} C${m.cons}｜${m.weapon?.name || '无武器'}${m.weapon?.affix ? ` 精${m.weapon.affix}` : ''}｜天赋 A${m.talent.A}/E${m.talent.E}/Q${m.talent.Q}${m.ruleBy ? `｜规则：${m.ruleBy}` : ''}`);
        for (const row of m.rows.slice(0, 4))
            lines.push(`    ${row.title}：${Math.round(row.value).toLocaleString('en-US')}`);
        if (!m.rows.length)
            lines.push('    （没有取到伤害行）');
    }
    lines.push('', `参考 DPS：${Math.round(dps.dps).toLocaleString('en-US')}（窗口 ${dps.window}s，总伤 ${Math.round(dps.total).toLocaleString('en-US')}）`);
    lines.push(`  ${axisLabel}`);
    if (patchText)
        lines.push(`  词条：${patchText}`);
    for (const c of dps.members)
        lines.push(`  · ${c.charName}：${Math.round(c.damage).toLocaleString('en-US')}`);
    lines.push('', `同阵容参考（共 ${view.refTotal} 条，按金数最接近排序）：`);
    if (!view.refs.length)
        lines.push('  （暂无）');
    for (const r of view.refs) {
        lines.push(`  ${r.cost} 金（限${r.limitcost}/常${r.normalcost}，差 ${r.costDiff}）｜${Math.round(r.damage).toLocaleString('en-US')}｜${r.members.map(x => `${x.name}C${x.cons}`).join('+')}${r.video ? '｜有视频' : ''}`);
    }
    for (const n of view.notes)
        lines.push('', `注：${n}`);
    return lines.join('\n');
}
export class MetaTeamDamage extends plugin {
    constructor() {
        super({
            name: META.name,
            dsc: META.dsc,
            event: 'message',
            priority: getPluginConfig()?.priority
                ? Number(getPluginConfig().priority) + META.priorityOffset
                : 8000 + META.priorityOffset,
            rule: [
                { reg: RULES.teamDamage, fnc: 'handleTeamDamage', permission: META.permission }
            ]
        });
    }
    /**
     * `#队伍伤害<N> 胡桃 行秋 夜兰 钟离 [词条…] [UID]` —— N = 内置轴序号（省略 = 1）
     */
    async handleTeamDamage(e) {
        if (await moduleGateReply('teamDamage', e))
            return true;
        const match = String(e.msg).match(RULES.teamDamage) || [];
        const axisNo = (match[1] || '').trim();
        const { names, uid, patchTokens, legacyTokens } = parseTeamArgs(match[2] || '');
        // 旧写法（轴:/词条:）已废除：给一句改用提示，别让它退化成"要四个角色名"的报错
        if (legacyTokens.length) {
            await e.reply(`[Meta] 「轴:…」「词条:…」写法已废除（收到：${legacyTokens.join(' ')}）\n${usage()}`);
            return true;
        }
        const chosen = axisByNo(axisNo, getPluginConfig()?.teamDamageAxes);
        if (!chosen) {
            await e.reply(`[Meta] 没有序号为 ${axisNo} 的轴。可用轴：\n${axisLines()}`);
            return true;
        }
        if (names.length !== 4) {
            await e.reply(usage());
            return true;
        }
        const patch = parseStatPatch(patchTokens.join(' '));
        const axis = chosen.axis;
        const axisLabel = `轴 ${chosen.no}：${chosen.name}（窗口 ${axis.window}s）`;
        const result = await readTeamDamage(e, names, uid, { patch: patch.items.length ? patch : undefined });
        if (!result.ok) {
            if (!result.prompted)
                await e.reply(`[Meta] ${result.error}`);
            return true;
        }
        // 同阵容参考：用榜单缓存（与 `#DPS榜` 同一份；联网开关与代理同口径）
        let teams = [];
        try {
            const { ensureFresh, getSnapshot } = await import('../model/TeamStore.js');
            await ensureFresh({ proxy: getProxy() });
            teams = getSnapshot().teams;
        }
        catch { /* 取不到就不给参考区，伤害与 DPS 照常出 */ }
        const view = buildTeamDamageView(result.members, teams);
        const dps = teamDps(result.members.map(m => ({ charName: m.charName, rows: m.rows })), axis);
        const data = {
            title: '队伍伤害',
            subtitle: `约 ${view.approxCost} 金（${view.costNote}）｜参考 DPS ${Math.round(dps.dps).toLocaleString('en-US')}｜同阵容参考 ${view.refTotal} 条`,
            uid: result.uid,
            referenceDps: Math.round(dps.dps).toLocaleString('en-US'),
            referenceTotal: Math.round(dps.total).toLocaleString('en-US'),
            window: dps.window,
            axisLabel,
            axisManual: dps.axis.manual,
            patchLabel: patchLabel(patch),
            patchInvalid: patch.invalid,
            contributions: dps.members.map(c => ({ charName: c.charName, damageText: Math.round(c.damage).toLocaleString('en-US') })),
            members: result.members.map(m => ({
                ...m,
                weaponText: m.weapon?.name ? `${m.weapon.name}${m.weapon.affix ? ` 精${m.weapon.affix}` : ''}` : '—',
                rowsText: m.rows.slice(0, 6).map(r => ({ ...r, valueText: Math.round(r.value).toLocaleString('en-US') }))
            })),
            refs: view.refs.map(r => ({
                ...r,
                damageText: Math.round(r.damage).toLocaleString('en-US'),
                membersText: r.members.map(x => `${x.name}${x.cons ? `C${x.cons}` : ''}`).join(' + ')
            })),
            refTotal: view.refTotal,
            approxCost: view.approxCost,
            notes: [...result.notes, ...view.notes, ...dps.notes],
            copyright: COPYRIGHT
        };
        return await respond(e, 'team-damage', data, () => teamDamageText(result.members, view, result.uid, dps, patchLabel(patch), axisLabel));
    }
}
//# sourceMappingURL=teamDamage.js.map