/**
 * `#练度查询 胡桃` —— 提升指南（v3 P2）
 *
 * 排版（2026-10-14 用户定稿）：三屏式 —— **结论 → 差在哪 → 怎么做**；
 * 权重与口径收进脚注，不再用四条进度条占版面；页头不显示 UID（账号走 miao 绑定）。
 *
 * ⚠ 本文件只导出插件类：`src/index.ts` 的加载器取「模块首个导出」当插件类。
 */
import { getGradePanelTiers, getGradeRankThresholds, getGradeWeights, getPluginConfig } from '../components/config.js';
import { COPYRIGHT, ENTRY_COMMANDS, ENTRY_RULES } from '../components/constants.js';
import { extractTargets, gradeBuild } from '../modules/grade.js';
import { readProfile } from '../model/MiaoProfile.js';
import { respond } from '../modules/respond.js';
// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析（见 components/render.ts 文件头 T1 / T2）
import plugin from '../../../../lib/plugins/plugin.js';
/** 本 app 的命令元数据（见 components/constants.ts 的 ENTRY_COMMANDS） */
const META = ENTRY_COMMANDS.find(c => c.rules.includes('grade'));
/** 未达标行的"差多少"文案 */
export function deltaTextOf(row) {
    if (row.verdict === 'off')
        return '无数据';
    const actual = Number(String(row.actual).replace(/[^\d.-]/g, ''));
    const nums = String(row.target).match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    if (!Number.isFinite(actual) || !nums.length)
        return '未达标';
    const min = Math.min(...nums);
    const diff = Number((min - actual).toFixed(1));
    return diff > 0 ? `差 ${diff}` : '未达标';
}
/** 维度徽标：达标 / 百分比 / 不计分 */
function badgeOf(label, ratio) {
    if (ratio === null)
        return { label, value: '不计分', kind: 'off' };
    const pct = Math.round(ratio * 100);
    return { label, value: pct >= 100 ? '达标' : `${pct}%`, kind: pct >= 100 ? 'ok' : pct >= 60 ? 'warn' : 'off' };
}
/** 文本回退（同样三屏式：结论 → 差在哪 → 怎么做） */
export function gradeText(result, missRows, okLine) {
    const lines = [
        `【${result.charName}】练度 ${result.rank}（${result.total} 分）　面板 ${result.panelTier}`,
        result.dims.map(d => `${d.label} ${d.ratio === null ? '不计分' : Math.round(d.ratio * 100) + '%'}`).join('｜'),
        '',
        '差在哪：'
    ];
    if (missRows.length)
        for (const r of missRows)
            lines.push(`  ${r.group} ${r.name}　${r.actual} → ${r.target}（${deltaTextOf(r)}）`);
    else
        lines.push('  全部达标');
    if (okLine)
        lines.push(`  已达标：${okLine}`);
    lines.push('', '怎么做：');
    result.suggestions.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    if (result.notes.length)
        lines.push('', ...result.notes.map(n => `注：${n}`));
    return lines.join('\n');
}
export class MetaGrade extends plugin {
    constructor() {
        super({
            name: META.name,
            dsc: META.dsc,
            event: 'message',
            priority: getPluginConfig()?.priority
                ? Number(getPluginConfig().priority) + META.priorityOffset
                : 8000 + META.priorityOffset,
            rule: [
                { reg: ENTRY_RULES.grade, fnc: 'handleGrade', permission: META.permission }
            ]
        });
    }
    /** `#练度查询 胡桃`（账号走 miao 的米游社绑定，命令里不带 UID） */
    async handleGrade(e) {
        const match = String(e.msg).match(ENTRY_RULES.grade) || [];
        const charName = String(match[1] || '').replace(/\s+/g, ' ').trim();
        if (!charName) {
            await e.reply('[Meta] 用法：#练度查询 胡桃（账号走 miao 的米游社绑定，不用写 UID）');
            return true;
        }
        const { codexStore } = await import('../model/CodexStore.js');
        const { buildCodexView } = await import('../modules/subViews.js');
        const guide = codexStore.getGuide(charName);
        if (!guide) {
            const { findCharacter, searchCharacters } = await import('../model/CharacterIndex.js');
            const hit = findCharacter(charName);
            const tips = (hit ? searchCharacters(hit.name, 5) : searchCharacters(charName, 5)).map(c => c.name);
            await e.reply(`[Meta] 没有找到角色「${charName}」` + (tips.length ? `\n你是不是想找：${tips.join('、')}` : ''));
            return true;
        }
        const view = buildCodexView(guide, {
            signature: codexStore.getSignature(guide?.name || charName),
            weaponTags: codexStore.getWeaponTags()
        });
        const targets = extractTargets(view, guide?.name || charName, guide);
        const profile = await readProfile(e, targets.charName || charName);
        if (!profile.ok) {
            if (!profile.prompted)
                await e.reply(`[Meta] ${profile.error}`);
            return true;
        }
        const weights = getGradeWeights();
        const result = gradeBuild(targets, profile.build, {
            weights: weights,
            panelTiers: getGradePanelTiers(),
            rankThresholds: getGradeRankThresholds()
        });
        // 行分组：未达标（含缺数据）在前、已达标压成一行、命座单独提示
        // 「主词条」在 mysPanel 简版来源下拿不到 → 这种行不生成（比显示"无数据"更有信息量）
        const missRows = result.rows
            .filter(r => r.verdict === 'warn' || r.verdict === 'off')
            .filter(r => !(r.group === '主词条' && (r.verdict === 'off' || String(r.actual) === '—')))
            .map(r => ({ ...r, deltaText: deltaTextOf(r) }));
        const okRows = result.rows.filter(r => r.verdict === 'ok');
        const consRow = result.rows.find(r => r.group === '命座');
        const okLine = okRows.map(r => `${r.name}${r.group === '面板' ? ` ${r.actual}` : ''}`).join('、');
        const consLine = consRow ? `${consRow.target}（当前 ${consRow.actual}，不计分）` : '';
        const data = {
            title: `#${result.charName} · 提升指南`,
            subtitle: '攻略目标 × 当前配装（面板数据来自 miao）',
            ranks: result.rank,
            total: result.total,
            panelTier: result.panelTier,
            dims: result.dims.map(d => ({
                label: d.label,
                pct: d.ratio === null ? 0 : Math.round(d.ratio * 100),
                pctText: d.ratio === null ? '不计分' : `${Math.round(d.ratio * 100)}%`
            })),
            missRows,
            consLine,
            suggestions: result.suggestions,
            weightsNote: `权重 面板 ${weights.panel} / 武器 ${weights.weapon} / 圣遗物 ${weights.artifact} / 天赋 ${weights.talent}（可配置）`,
            notes: [...result.notes, ...profile.notes],
            copyright: COPYRIGHT
        };
        // 文本回落与图片**共用同一份说明**（来源与刷新限制不能只在图上出现）
        // 2026-10-15 外部复核第 6 项发现：这里漏了 `profile.notes`
        return await respond(e, 'grade', data, () => gradeText({ ...result, notes: data.notes }, missRows, okLine));
    }
}
//# sourceMappingURL=grade.js.map