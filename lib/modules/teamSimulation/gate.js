import { evaluateGolden } from './metrics.js';
import { gateReactionFamily } from './reactionFamilies.js';
const statusOf = (checks) => {
    if (checks.some(check => check.status === 'blocked'))
        return 'blocked';
    if (checks.some(check => check.status === 'insufficient-data'))
        return 'insufficient-data';
    return 'pass';
};
export function evaluateReleaseGate(input) {
    const checks = [];
    const result = input?.result;
    checks.push(!result || result.status !== 'calculated'
        ? { id: 'run', status: 'blocked', detail: `本轮状态是 ${String(result?.status)}，没有可发布的结算结果` }
        : { id: 'run', status: 'pass', detail: '本轮结算成功' });
    if (!result || result.status !== 'calculated') {
        return { status: statusOf(checks), checks, blocking: checks.filter(check => check.status === 'blocked').map(check => check.id) };
    }
    checks.push(result.mode === 'dps-standard'
        ? { id: 'mode', status: 'pass', detail: '按 DPS 标准口径运行' }
        : { id: 'mode', status: 'blocked', detail: '诊断口径不能作为发布结论：目标、窗口、起手能量都可能不是标准值' });
    const approximate = result.timeline.approximateItems ?? [];
    checks.push(result.timeline.accuracy === 'verified' && !approximate.length
        ? { id: 'accuracy', status: 'pass', detail: '没有近似项' }
        : { id: 'accuracy', status: 'blocked', detail: `仍有近似项：${approximate.join('、') || '未标注'}` });
    const rows = result.damage.status === 'calculated' ? result.damage.rows : [];
    const reactions = input.reactions ?? [...new Set(rows.map(row => row.reaction?.kind).filter((kind) => typeof kind === 'string'))];
    const blockedReactions = reactions.filter(kind => gateReactionFamily(kind).status !== 'ok');
    checks.push(!blockedReactions.length
        ? { id: 'reactions', status: 'pass', detail: reactions.length ? `用到的反应家族都已有 fixture：${reactions.join('、')}` : '本轮没有用到反应' }
        : { id: 'reactions', status: 'blocked', detail: `这些反应家族还没有 fixture：${blockedReactions.join('、')}` });
    const violations = (result.plan?.checks ?? []).filter(check => check.status === 'violation');
    checks.push(!violations.length
        ? { id: 'resources', status: 'pass', detail: '机制资源检查没有违规' }
        : { id: 'resources', status: 'blocked', detail: violations.map(check => `${check.id}: ${check.message}`).join('；') });
    const minimum = Number.isInteger(input.minimumCases) && input.minimumCases > 0 ? input.minimumCases : 10;
    const cases = input.golden?.cases ?? [];
    const actuals = input.golden?.actuals ?? [];
    if (cases.length < minimum) {
        checks.push({ id: 'golden', status: 'insufficient-data', detail: `黄金集只有 ${cases.length} 例，差 ${minimum - cases.length} 例（至少 ${minimum} 例合格场景）` });
    }
    else {
        const report = evaluateGolden(cases, actuals);
        checks.push(report.gate === 'pass'
            ? { id: 'golden', status: 'pass', detail: `黄金集 ${report.counted} 例计入闸门，中位误差 ${report.median === null ? '—' : report.median}` }
            : { id: 'golden', status: 'blocked', detail: `黄金集未过闸门：${report.reason}` });
    }
    return { status: statusOf(checks), checks, blocking: checks.filter(check => check.status === 'blocked').map(check => check.id) };
}
/** 把闸门结论排成可读行；`pass` 之外都写明卡在哪一条。 */
export function formatReleaseGate(verdict) {
    const lines = [`发布闸门：${verdict.status}`];
    for (const check of verdict.checks)
        lines.push(`  ${check.id}=${check.status} · ${check.detail}`);
    if (verdict.blocking.length)
        lines.push(`  阻断项：${verdict.blocking.join('、')}`);
    return lines;
}
//# sourceMappingURL=gate.js.map