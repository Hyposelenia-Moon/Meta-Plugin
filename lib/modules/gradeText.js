/**
 * 练度页的**文本回退**（与图片同源的三屏式：结论 → 差在哪 → 怎么做）
 *
 * 2026-10-27 复审 R2 后从 `apps/grade.ts` 提成纯模块：`apps/*` 依赖框架（只能在 bot 下 import），
 * 而"差在哪"的判定必须能被套件直接驱动做行为断言（「对比行没有 warn」≠「全部达标」）。
 */
import { deltaTextOf } from '../components/presentation.js';
export function gradeText(result, missRows, okLine) {
    const dimText = (d) => {
        if (d.state === 'unknown')
            return `${d.label} 未知`;
        if (d.state === 'unscored')
            return `${d.label} 不计分`;
        return `${d.label} ${Math.round((d.ratio || 0) * 100)}%`;
    };
    const lines = [
        result.assessable
            ? `【${result.charName}】练度 ${result.rank}（${result.total} 分）`
            : `【${result.charName}】练度：无法评估（关键数据未取到）`,
        result.dims.map(dimText).join('｜'),
        '',
        '差在哪：'
    ];
    /*
     * 2026-10-27 复审 R2（文本回退）：对比行没有未达标项 ≠ 全部达标 ——
     * 综合维度的结论由规则 `floors` 决定（如 SSS/SS 词条在 dps 规则下是 below），
     * 这时 rows 里可能一条 warn 都没有（词条评分行按 0.8 判 ok、套装 ok），
     * 旧代码仍打「全部达标」，与同一条回复里的「提升词条」建议自相矛盾。
     */
    const belowDims = result.dims.filter(d => d.state === 'below');
    const unknownDims = result.dims.filter(d => d.state === 'unknown');
    if (missRows.length) {
        for (const r of missRows)
            lines.push(`  ${r.group} ${r.name}　${r.actual} → ${r.target}（${deltaTextOf(r)}）`);
    }
    else {
        if (belowDims.length) {
            lines.push(`  ${belowDims.map(d => `${d.label} ${Math.round((d.ratio ?? 0) * 100)}% 未达标`).join('、')}（按下面的建议逐项优化）`);
        }
        if (unknownDims.length) {
            lines.push(`  数据不全：${unknownDims.map(d => d.label).join('、')} 未取到，暂不判定达标`);
        }
        if (!belowDims.length && !unknownDims.length)
            lines.push('  全部达标');
    }
    if (okLine)
        lines.push(`  已达标：${okLine}`);
    lines.push('', '怎么做：');
    result.suggestions.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    if (result.notes.length)
        lines.push('', ...result.notes.map(n => `注：${n}`));
    return lines.join('\n');
}
//# sourceMappingURL=gradeText.js.map