export const GOLDEN_THRESHOLDS = {
    /** 计入闸门的用例，总伤相对误差的中位数上限。 */
    totalMedian: 0.10,
    /** DPS 口径的相对误差中位数上限（DPS = 总伤 / 窗口秒数，窗口不同才需要单列）。 */
    dpsMedian: 0.12,
    /** 任何单例的相对误差上限。 */
    singleMax: 0.20,
    /** 分角色伤害占比的最大偏差（百分点换算成 0–1 的比例）。 */
    contribution: 0.10
};
const relativeError = (actual, expected) => {
    if (!Number.isFinite(actual) || !Number.isFinite(expected) || expected <= 0)
        return null;
    return Math.abs(actual - expected) / expected;
};
const maxContributionError = (actual, expected) => {
    if (!actual || !expected)
        return null;
    const sum = (record) => Object.values(record).reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
    const actualTotal = sum(actual);
    const expectedTotal = sum(expected);
    if (actualTotal <= 0 || expectedTotal <= 0)
        return null;
    let worst = 0;
    for (const id of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
        const share = (actual[id] ?? 0) / actualTotal - (expected[id] ?? 0) / expectedTotal;
        worst = Math.max(worst, Math.abs(share));
    }
    return worst;
};
/** 校验用例自身是否可采信：缺来源、非正期望值、重复 id 都直接判无效。 */
export function validateGoldenCases(input) {
    if (!Array.isArray(input))
        return [{ code: 'invalid', path: 'cases', message: '黄金集必须是数组' }];
    const issues = [];
    const seen = new Set();
    for (const [index, item] of input.entries()) {
        const path = `cases.${index}`;
        if (!item || typeof item !== 'object') {
            issues.push({ code: 'invalid', path, message: '用例必须是对象' });
            continue;
        }
        const golden = item;
        if (typeof golden.id !== 'string' || !golden.id.trim())
            issues.push({ code: 'missing', path: `${path}.id`, message: '用例必须带 id' });
        else if (seen.has(golden.id))
            issues.push({ code: 'invalid', path: `${path}.id`, message: `用例 id ${golden.id} 重复` });
        else
            seen.add(golden.id);
        if (typeof golden.source !== 'string' || !golden.source.trim())
            issues.push({ code: 'invalid', path: `${path}.source`, message: '必须写明期望值来源，来源不可考的用例不予采信' });
        if (!['measured', 'hand-calculated', 'cross-check', 'synthetic'].includes(String(golden.kind)))
            issues.push({ code: 'unsupported', path: `${path}.kind`, message: `未知用例类型 ${String(golden.kind)}` });
        const total = golden.expected?.total;
        if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0)
            issues.push({ code: 'invalid', path: `${path}.expected.total`, message: '期望总伤必须是正数' });
        if (golden.tolerance !== undefined && (!Number.isFinite(golden.tolerance) || golden.tolerance < 0))
            issues.push({ code: 'invalid', path: `${path}.tolerance`, message: '容差必须是非负有限值' });
    }
    return issues;
}
/**
 * 按黄金集算误差并给闸门结论。
 * `actuals` 里找不到的用例记 `missing`（不按 0 参与统计），synthetic 用例只展示、不计入闸门。
 */
export function evaluateGolden(cases, actuals, thresholds = {}) {
    const limits = { ...GOLDEN_THRESHOLDS, ...thresholds };
    const byId = new Map(actuals.map(actual => [actual.id, actual]));
    const rows = [];
    for (const golden of cases) {
        const actual = byId.get(golden.id);
        if (!actual) {
            rows.push({ id: golden.id, kind: golden.kind, status: 'missing', error: null, contributionError: null, message: '没有对应的实跑结果' });
            continue;
        }
        const error = relativeError(actual.total, golden.expected.total);
        if (error === null) {
            rows.push({ id: golden.id, kind: golden.kind, status: 'unmeasurable', error: null, contributionError: null, message: '期望总伤不是正数，无法计算相对误差' });
            continue;
        }
        const contributionError = maxContributionError(actual.perActor, golden.expected.perActor);
        const tolerance = golden.tolerance ?? limits.singleMax;
        const failed = error > tolerance || (contributionError !== null && contributionError > limits.contribution);
        rows.push({
            id: golden.id,
            kind: golden.kind,
            status: failed ? 'failed' : 'passed',
            error,
            contributionError,
            message: failed
                ? `相对误差 ${(error * 100).toFixed(1)}%（容差 ${(tolerance * 100).toFixed(1)}%）` + (contributionError !== null && contributionError > limits.contribution ? `，贡献偏差 ${(contributionError * 100).toFixed(1)}pp` : '')
                : '在容差内'
        });
    }
    const counted = rows.filter(row => row.kind !== 'synthetic' && row.error !== null);
    const errors = counted.map(row => row.error).sort((a, b) => a - b);
    const median = errors.length ? (errors.length % 2 ? errors[(errors.length - 1) / 2] : (errors[errors.length / 2 - 1] + errors[errors.length / 2]) / 2) : null;
    const max = errors.length ? errors[errors.length - 1] : null;
    const passed = counted.filter(row => row.status === 'passed').length;
    if (!counted.length) {
        return { rows, counted: 0, passed: 0, median, max, gate: 'insufficient-data', reason: '没有可计入闸门的用例（需要实测/手算/对照来源，synthetic 不算）' };
    }
    // 中位数门槛只在样本够多时才有统计意义：三条以下直接用单例容差判，避免「一条 15% 的准用例」被中位数一票否决。
    if (counted.length >= 3 && median !== null && median > limits.totalMedian)
        return { rows, counted: counted.length, passed, median, max, gate: 'fail', reason: `中位相对误差 ${(median * 100).toFixed(1)}% 超过 ${(limits.totalMedian * 100).toFixed(0)}%` };
    const failing = rows.filter(row => row.kind !== 'synthetic' && row.status === 'failed');
    if (failing.length)
        return { rows, counted: counted.length, passed, median, max, gate: 'fail', reason: `${failing.length} 条用例超出单例容差：${failing.map(row => row.id).join('、')}` };
    return { rows, counted: counted.length, passed, median, max, gate: 'pass', reason: `${counted.length} 条用例全部在容差内（中位 ${((median ?? 0) * 100).toFixed(1)}%）` };
}
//# sourceMappingURL=metrics.js.map