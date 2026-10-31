import { buildPermanentStats, validateCharacterBuild } from './build.js';
import { simulateTimeline } from './timeline.js';
import { calculateTimelineDamage } from './hitDamage.js';
import { validateDataPack } from './dataPack.js';
import { validateRotation } from './rotation.js';
const fail = (status, checks, issues) => ({ status, checks, issues });
/**
 * 关状态与整轮状态用同一套归类：有 unsupported 先报 unsupported，其次 invalid，
 * 只剩缺字段才算 incomplete——缺字段与写错值是两种不同的修法，不能都塞进 invalid。
 */
const statusOf = (issues) => !issues.length ? 'ok'
    : issues.some(issue => issue.code === 'unsupported') ? 'unsupported'
        : issues.some(issue => issue.code === 'invalid') ? 'invalid'
            : 'incomplete';
/**
 * 编排：数据包 → 轴 → 每个成员的面板 → 时间线 → 每段命中结算。
 * 任何一关不过就整轮拒绝，不拿默认值降级；结果里保留每关的 issues 便于定位。
 */
export function simulateTeam(input) {
    const checks = [];
    if (!input || typeof input !== 'object')
        return fail('invalid', checks, [{ code: 'invalid', path: 'input', message: '输入必须是对象' }]);
    const packResult = validateDataPack(input.pack);
    checks.push({ stage: 'data-pack', status: packResult.status, issues: packResult.issues });
    if (packResult.status !== 'ok')
        return fail(packResult.status === 'version-mismatch' ? 'invalid' : packResult.status, checks, packResult.issues);
    // 包与面板必须同版本：帧表来自一份版本、属性表来自另一份，跑出来的数没有统一基准。
    const panelsVersion = typeof input.expected?.gameVersion === 'string' ? input.expected.gameVersion : '';
    const versionIssues = [];
    if (!panelsVersion)
        versionIssues.push({ code: 'missing', path: 'expected.gameVersion', message: '必须给出面板数据版本，才能与数据包版本比对' });
    else if (packResult.pack.gameVersion !== panelsVersion)
        versionIssues.push({ code: 'invalid', path: 'pack.gameVersion', message: `数据包版本 ${packResult.pack.gameVersion} 与面板数据版本 ${panelsVersion} 不一致：跨版本混跑没有意义` });
    const versionsStatus = statusOf(versionIssues);
    checks.push({ stage: 'versions', status: versionsStatus, issues: versionIssues });
    if (versionsStatus !== 'ok')
        return fail(versionsStatus, checks, versionIssues);
    const rotationIssues = validateRotation(input.rotation, packResult.pack);
    const rotationStatus = statusOf(rotationIssues);
    checks.push({ stage: 'rotation', status: rotationStatus, issues: rotationIssues });
    if (rotationStatus !== 'ok')
        return fail(rotationStatus, checks, rotationIssues);
    const members = input.members;
    if (!Array.isArray(members) || !members.length) {
        const issues = [{ code: 'missing', path: 'members', message: '至少要有一个成员的配装与永久数据' }];
        checks.push({ stage: 'members', status: 'incomplete', issues });
        return fail('incomplete', checks, issues);
    }
    const memberIssues = [];
    const contexts = {};
    const actorIds = new Set();
    members.forEach((member, index) => {
        const p = `members.${index}`;
        const buildResult = validateCharacterBuild(member?.build);
        if (buildResult.status !== 'raw-complete') {
            memberIssues.push(...buildResult.issues.map(issue => ({ ...issue, path: `${p}.build.${issue.path}` })));
            return;
        }
        const build = buildResult.build;
        if (actorIds.has(build.actorId)) {
            memberIssues.push({ code: 'invalid', path: `${p}.build.actorId`, message: `角色实例 ${build.actorId} 重复登记` });
            return;
        }
        actorIds.add(build.actorId);
        const permanent = buildPermanentStats(build, member.permanentData, input.expected);
        if (permanent.status !== 'permanent-ready') {
            memberIssues.push(...permanent.issues.map(issue => ({ ...issue, path: `${p}.permanentData.${issue.path}` })));
            return;
        }
        contexts[build.actorId] = {
            level: build.level,
            stats: permanent.stats,
            targetPresetId: input.targetPresetId,
            crit: input.crit,
            gameVersion: permanent.gameVersion,
            source: permanent.bundleId,
            debuffs: input.debuffs
        };
    });
    // 轴上出手的角色必须有面板，否则命中无法结算；只有切人经过的角色可以没有面板，但必须在 rotation.actors 登记（由 validateRotation 把关）。
    for (const step of input.rotation.steps) {
        if (step.kind === 'action' && step.actorId && !contexts[step.actorId]) {
            memberIssues.push({ code: 'unsupported', path: 'members', message: `轴上出手的角色 ${step.actorId} 没有可用的面板` });
        }
    }
    const memberStatus = statusOf(memberIssues);
    checks.push({ stage: 'members', status: memberStatus, issues: memberIssues });
    if (memberStatus !== 'ok')
        return fail(memberStatus, checks, memberIssues);
    const timeline = simulateTimeline({
        scheduler: input.rotation.scheduler,
        steps: input.rotation.steps,
        actions: packResult.pack.actions,
        actors: input.rotation.actors,
        activeActorId: input.rotation.activeActorId,
        frameTier: input.rotation.frameTier,
        measurementEndFrame: input.rotation.measurementEndFrame,
        switchFrames: input.rotation.switchFrames,
        energyRecharge: input.rotation.energyRecharge,
        stateFlags: input.rotation.stateFlags,
        effects: packResult.pack.effects ?? {}
    });
    checks.push({ stage: 'timeline', status: timeline.status === 'simulated' ? 'ok' : timeline.status, issues: timeline.issues });
    if (timeline.status !== 'simulated')
        return fail('invalid', checks, timeline.issues);
    const damage = calculateTimelineDamage({ timeline, contexts });
    checks.push({ stage: 'damage', status: damage.status === 'calculated' ? 'ok' : damage.status, issues: damage.issues });
    if (damage.status !== 'calculated')
        return fail(damage.status, checks, damage.issues);
    return { status: 'calculated', scope: 'team-run-no-reaction', simulationReady: false, checks, versions: { pack: packResult.pack.gameVersion, panels: panelsVersion }, timeline, damage, issues: [] };
}
//# sourceMappingURL=teamRun.js.map