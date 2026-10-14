/**
 * `#队伍伤害` —— 整队配装的关键伤害 + 参考 DPS + 同阵容参考（v3 P3 v1 / P4 v2）
 *
 * 例：
 *   `#队伍伤害 胡桃 行秋 夜兰 钟离`                        ← 默认轴
 *   `#队伍伤害 胡桃 行秋 夜兰 钟离 轴:重击×8@21s`          ← 手动轴
 *   `#队伍伤害 胡桃 行秋 夜兰 钟离 词条:暴击率+20,暴击伤害+40` ← 可调节词条
 *   （可另附 10 位 UID；账号默认走 miao 的米游社绑定）
 *
 * 口径：
 *   - 每人关键伤害 = miao 的 `avatar.calcDmg()`（与 miao 面板同一套算法），并标注伤害规则来源；
 *   - **参考 DPS** = 轴下各队员伤害之和 ÷ 窗口（默认轴：每人最高单次 ×1／20s，只作横向比较）；
 *   - **词条**是"临时改面板属性后重算"，**不改动** miao 面板里的任何数据；
 *   - 跨角色 buff 叠加（miao 的「组团伤害」）由 miao 系统配置 `teamCalc` 决定，本插件不擅自改配置。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getPluginConfig, getProxy } from '../components/config.js';
import { COPYRIGHT, ENTRY_COMMANDS, ENTRY_RULES } from '../components/constants.js';
import { buildTeamDamageView, parseTeamArgs } from '../modules/teamDamage.js';
import { defaultAxis, parseAxis, teamDps } from '../modules/rotation.js';
import { parseStatPatch, patchLabel } from '../modules/statPatch.js';
import { readTeamDamage } from '../model/MiaoProfile.js';
import { respond } from '../modules/respond.js';
// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js';
/** 本 app 的命令元数据（见 components/constants.ts 的 ENTRY_COMMANDS） */
const META = ENTRY_COMMANDS.find(c => c.rules.includes('teamDamage'));
/** 文本回退：队员伤害 + 参考 DPS + 同阵容参考 */
export function teamDamageText(members, view, uid, dps, patchText) {
    const lines = [`【队伍伤害】约 ${view.approxCost} 金（${view.costNote}）　UID ${uid}`, ''];
    for (const m of members) {
        lines.push(`· ${m.charName} C${m.cons}｜${m.weapon?.name || '无武器'}${m.weapon?.affix ? ` 精${m.weapon.affix}` : ''}｜天赋 A${m.talent.A}/E${m.talent.E}/Q${m.talent.Q}${m.ruleBy ? `｜规则：${m.ruleBy}` : ''}`);
        for (const row of m.rows.slice(0, 4))
            lines.push(`    ${row.title}：${Math.round(row.value).toLocaleString('en-US')}`);
        if (!m.rows.length)
            lines.push('    （没有取到伤害行）');
    }
    lines.push('', `参考 DPS：${Math.round(dps.dps).toLocaleString('en-US')}（窗口 ${dps.window}s，总伤 ${Math.round(dps.total).toLocaleString('en-US')}）`);
    lines.push(`  ${dps.axis.label}`);
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
                { reg: ENTRY_RULES.teamDamage, fnc: 'handleTeamDamage', permission: META.permission }
            ]
        });
    }
    /**
     * `#队伍伤害 胡桃 行秋 夜兰 钟离 [轴:…] [词条:…] [UID]`
     */
    async handleTeamDamage(e) {
        const match = String(e.msg).match(ENTRY_RULES.teamDamage) || [];
        const { names, uid, axisText, patchText } = parseTeamArgs(match[1] || '');
        if (names.length !== 4) {
            await e.reply('[Meta] 用法：#队伍伤害 胡桃 行秋 夜兰 钟离 [轴:重击×8@21s] [词条:暴击率+20]（四个角色名；账号走 miao 的米游社绑定，可另附 10 位 UID）');
            return true;
        }
        const patch = parseStatPatch(patchText);
        const axis = axisText ? parseAxis(axisText) : defaultAxis();
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
            axisLabel: dps.axis.label,
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
        return await respond(e, 'team-damage', data, () => teamDamageText(result.members, view, result.uid, dps, patchLabel(patch)));
    }
}
//# sourceMappingURL=teamDamage.js.map