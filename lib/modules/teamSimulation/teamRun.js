import { buildPermanentStats, validateCharacterBuild } from './build.js';
import { simulateTimeline } from './timeline.js';
import { calculateTimelineDamage } from './hitDamage.js';
import { validateDataPack } from './dataPack.js';
import { validateRotation } from './rotation.js';
import { checkDpsStandard } from './dpsStandard.js';
import { planMechanisms } from './mechanisms.js';
const fail = (status, checks, issues) => ({ status, checks, issues });
/**
 * 关状态与整轮状态用同一套归类：有 unsupported 先报 unsupported，其次 invalid，
 * 只剩缺字段才算 incomplete——缺字段与写错值是两种不同的修法，不能都塞进 invalid。
 */
const statusOf = (issues) => !issues.length ? 'ok'
    : issues.some(issue => issue.code === 'unsupported') ? 'unsupported'
        : issues.some(issue => issue.code === 'invalid') ? 'invalid'
            : 'incomplete';
const dpsViolationToIssue = (violation) => ({ code: 'invalid', path: violation.path, message: violation.message });
/**
 * 编排：数据包 → 轴 → DPS 口径 → 每个成员的面板 → 机制规划 → 时间线 → 每段命中结算。
 * 任何一关不过就整轮拒绝，不拿默认值降级；结果里保留每关的 issues 便于定位。
 */
export function simulateTeam(input) {
    const checks = [];
    if (!input || typeof input !== 'object')
        return fail('invalid', checks, [{ code: 'invalid', path: 'input', message: '输入必须是对象' }]);
    const mode = input.mode ?? 'dps-standard';
    if (mode !== 'dps-standard' && mode !== 'diagnostic') {
        return fail('unsupported', checks, [{ code: 'unsupported', path: 'mode', message: `未知运行模式 ${String(mode)}` }]);
    }
    const timings = {};
    let lapStart = input.instrument ? performance.now() : 0;
    const lap = (stage) => {
        if (!input.instrument)
            return;
        const now = performance.now();
        timings[stage] = Math.round((now - lapStart) * 1000) / 1000;
        lapStart = now;
    };
    const packResult = validateDataPack(input.pack);
    checks.push({ stage: 'data-pack', status: packResult.status, issues: packResult.issues });
    lap('data-pack');
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
    lap('versions');
    if (versionsStatus !== 'ok')
        return fail(versionsStatus, checks, versionIssues);
    const rotationIssues = validateRotation(input.rotation, packResult.pack);
    const rotationStatus = statusOf(rotationIssues);
    checks.push({ stage: 'rotation', status: rotationStatus, issues: rotationIssues });
    lap('rotation');
    if (rotationStatus !== 'ok')
        return fail(rotationStatus, checks, rotationIssues);
    // DPS 标准口径：对外只认 110 级小宝、10% 抗性、120 秒、0 初始能量。诊断模式显式跳过，并在结果里标出来。
    if (mode === 'dps-standard') {
        const violations = checkDpsStandard({
            frameTier: input.rotation.frameTier,
            targetPresetId: input.targetPresetId,
            measurementEndFrame: input.rotation.measurementEndFrame,
            actors: input.rotation.actors
        });
        const dpsIssues = violations.map(dpsViolationToIssue);
        const dpsStatus = statusOf(dpsIssues);
        checks.push({ stage: 'dps-standard', status: dpsStatus, issues: dpsIssues });
        lap('dps-standard');
        if (dpsStatus !== 'ok')
            return fail(dpsStatus, checks, dpsIssues);
    }
    const members = input.members;
    if (!Array.isArray(members) || !members.length) {
        const issues = [{ code: 'missing', path: 'members', message: '至少要有一个成员的配装与永久数据' }];
        checks.push({ stage: 'members', status: 'incomplete', issues });
        return fail('incomplete', checks, issues);
    }
    const memberIssues = [];
    const contexts = {};
    const builds = {};
    const unmodeled = [];
    const permanentByActor = {};
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
        builds[build.actorId] = build;
        permanentByActor[build.actorId] = member.permanentData;
        for (const item of permanent.unmodeled)
            unmodeled.push({ actorId: build.actorId, id: item.id, reason: item.reason });
        contexts[build.actorId] = {
            level: build.level,
            stats: permanent.stats,
            // 白值：atkPct/hpPct/defPct 一类百分比加成的折算基准（武器白值含在 atk 里）
            base: { hp: permanent.base.hp, atk: permanent.base.atk, def: permanent.base.def },
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
    lap('members');
    if (memberStatus !== 'ok')
        return fail(memberStatus, checks, memberIssues);
    const { plan, issues: mechanismIssues } = planMechanisms({
        pack: packResult.pack,
        rotation: input.rotation,
        builds,
        contexts,
        tier: input.rotation.frameTier
    });
    const violationIssues = plan.checks
        .filter(check => check.status === 'violation')
        .map(check => ({ code: 'invalid', path: `mechanisms.${check.id}`, message: check.message }));
    const allMechanismIssues = [...mechanismIssues, ...violationIssues];
    const mechanismStatus = statusOf(allMechanismIssues);
    checks.push({ stage: 'mechanisms', status: mechanismStatus, issues: allMechanismIssues });
    lap('mechanisms');
    if (mechanismStatus !== 'ok')
        return fail(mechanismStatus, checks, allMechanismIssues);
    /*
     * 4 件套触发式（2026-11-02）：只并入真正穿在身上的套装的运行时效果。
     * 永久数据是按角色+武器一次生成的，里面包含全部 63 套的 `runtimeEffects`；
     * 这里用本队实际圣遗物的 setId 过滤，避免「没穿也触发」。
     */
    const effects = { ...(packResult.pack.effects ?? {}) };
    const effectTriggers = [];
    for (const [actorId, data] of Object.entries(permanentByActor)) {
        const setCounts = new Map();
        for (const artifact of builds[actorId].artifacts)
            setCounts.set(artifact.setId, (setCounts.get(artifact.setId) ?? 0) + 1);
        for (const [effectId, spec] of Object.entries(data.runtimeEffects ?? {})) {
            const setId = /^artifact-set:([^:]+):/.exec(effectId)?.[1];
            if (!setId || (setCounts.get(setId) ?? 0) < 4)
                continue;
            effects[effectId] = spec;
            effectTriggers.push({ effectId, actorId, on: spec.trigger });
            for (const extra of spec.extraTriggers ?? [])
                effectTriggers.push({ effectId, actorId, on: extra });
        }
    }
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
        effects,
        ...(effectTriggers.length ? { effectTriggers } : {}),
        ...(input.auraMode ? { auraMode: input.auraMode } : {})
    });
    checks.push({ stage: 'timeline', status: timeline.status === 'simulated' ? 'ok' : timeline.status, issues: timeline.issues });
    lap('timeline');
    if (timeline.status !== 'simulated')
        return fail('invalid', checks, timeline.issues);
    const damage = calculateTimelineDamage({ timeline, contexts, plan });
    checks.push({ stage: 'damage', status: damage.status === 'calculated' ? 'ok' : damage.status, issues: damage.issues });
    lap('damage');
    if (damage.status !== 'calculated')
        return fail(damage.status, checks, damage.issues);
    const windowSeconds = input.rotation.measurementEndFrame / input.rotation.frameTier.fps;
    return {
        status: 'calculated',
        scope: 'team-run-no-reaction',
        simulationReady: false,
        mode,
        checks,
        versions: { pack: packResult.pack.gameVersion, panels: panelsVersion },
        timeline,
        damage,
        plan,
        dps: mode === 'dps-standard' ? { total: damage.total, windowSeconds, value: damage.total / windowSeconds } : null,
        unmodeled,
        energy: (input.rotation.actors ?? []).map(actor => {
            const final = timeline.actors.find(item => item.actorId === actor.actorId);
            return { actorId: actor.actorId, start: actor.energy, end: final?.energy ?? actor.energy, max: actor.energyMax };
        }),
        timings: input.instrument ? timings : null,
        issues: []
    };
}
//# sourceMappingURL=teamRun.js.map