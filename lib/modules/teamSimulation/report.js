/** 只做投影与排版：把一轮编排的结果摊平成能直接读的摘要，不改任何计算。 */
const round1 = (value) => Math.round(value * 10) / 10;
export function buildTeamRunReport(result) {
    const stages = result.checks.map(check => ({ stage: check.stage, status: check.status, issues: check.issues.length }));
    const problems = (result.issues ?? []).map(issue => ({ path: issue.path, code: issue.code, message: issue.message }));
    const empty = {
        status: result.status,
        mode: result.status === 'calculated' ? result.mode : 'dps-standard',
        target: null,
        dps: null,
        resources: [],
        simulationReady: false,
        versions: null,
        stages,
        window: null,
        approximateItems: [],
        hits: 0,
        total: 0,
        perActor: [],
        perAction: [],
        triggers: [],
        effectUsage: [],
        reactions: [],
        energy: [],
        timings: null,
        problems
    };
    if (result.status !== 'calculated')
        return empty;
    const { timeline, damage, plan } = result;
    // 成功分支里这两层理论上都是成功态；真出现异常就按空摘要返回，不在这里编造数字。
    if (timeline.status !== 'simulated' || damage.status !== 'calculated') {
        return { ...empty, versions: { pack: result.versions.pack, panels: result.versions.panels } };
    }
    const hitsPerActor = new Map();
    const perAction = new Map();
    const effectUsage = new Map();
    const reactions = new Map();
    for (const row of damage.rows) {
        hitsPerActor.set(row.actorId, (hitsPerActor.get(row.actorId) ?? 0) + 1);
        const key = `${row.actorId}\u0000${row.actionId}`;
        const entry = perAction.get(key) ?? { actorId: row.actorId, actionId: row.actionId, hits: 0, total: 0 };
        entry.hits += 1;
        entry.total += row.damage;
        perAction.set(key, entry);
        if (row.reaction) {
            const reaction = reactions.get(row.reaction.kind) ?? { kind: row.reaction.kind, hits: 0, total: 0 };
            reaction.hits += 1;
            reaction.total += row.reaction.damage;
            reactions.set(row.reaction.kind, reaction);
        }
        for (const id of row.effects ?? []) {
            const usage = effectUsage.get(id) ?? { id, hits: 0, total: 0 };
            usage.hits += 1;
            usage.total += row.damage;
            effectUsage.set(id, usage);
        }
    }
    const triggers = new Map();
    for (const trigger of timeline.triggers ?? [])
        triggers.set(trigger.effectId, (triggers.get(trigger.effectId) ?? 0) + 1);
    return {
        ...empty,
        versions: { pack: result.versions.pack, panels: result.versions.panels },
        target: damage.target,
        dps: result.dps,
        resources: (plan?.checks ?? []).map(check => ({ id: check.id, status: check.status, message: check.message })),
        window: {
            endFrame: timeline.endFrame,
            tierId: timeline.timing.tierId,
            tickMs: timeline.timing.timerTickMs,
            gameMs: timeline.timing.gameMs,
            realMs: timeline.timing.realMs
        },
        approximateItems: [...(timeline.approximateItems ?? []), ...(plan?.approximate ?? [])],
        hits: damage.rows.length,
        total: damage.total,
        perActor: Object.entries(damage.perActor).map(([actorId, total]) => ({ actorId, hits: hitsPerActor.get(actorId) ?? 0, total })),
        perAction: [...perAction.values()],
        triggers: [...triggers.entries()].map(([effectId, count]) => ({ effectId, count })),
        effectUsage: [...effectUsage.values()].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id)),
        reactions: [...reactions.values()].sort((a, b) => b.total - a.total || a.kind.localeCompare(b.kind)),
        energy: result.energy,
        timings: result.timings
    };
}
/** 纯文本摘要，一行一件事，便于贴进日志或对话里核对。 */
export function formatTeamRunReport(report) {
    const lines = [`队伍模拟：${report.status}${report.status === 'calculated' ? '（不可用于正式结论）' : ''}`];
    lines.push(`关：${report.stages.map(stage => `${stage.stage}=${stage.status}`).join(' · ')}`);
    if (report.versions)
        lines.push(`版本：数据包 ${report.versions.pack} / 面板 ${report.versions.panels}`);
    if (report.target)
        lines.push(`目标：${report.target.id}（Lv${report.target.level}、抗性 ${report.target.resistance}） · 口径 ${report.mode}`);
    if (report.window) {
        const { endFrame, tierId, tickMs, gameMs, realMs } = report.window;
        lines.push(`窗口：${endFrame} 帧 · ${tierId}（${tickMs}ms/帧）· 游戏 ${gameMs}ms · 现实 ${round1(realMs)}ms`);
    }
    if (report.status === 'calculated') {
        lines.push(`命中：${report.hits} 段，合计 ${round1(report.total)}`);
        if (report.dps)
            lines.push(`DPS：${round1(report.dps.value)}（${round1(report.dps.total)} / ${round1(report.dps.windowSeconds)} 秒，110 级小宝 · 10% 抗性 · 0 能量起手）`);
        for (const actor of report.perActor)
            lines.push(`  角色 ${actor.actorId}：${actor.hits} 段 ${round1(actor.total)}`);
        for (const action of report.perAction)
            lines.push(`  动作 ${action.actorId} / ${action.actionId}：${action.hits} 段 ${round1(action.total)}`);
        if (report.triggers.length)
            lines.push(`触发：${report.triggers.map(trigger => `${trigger.effectId}×${trigger.count}`).join('、')}`);
        if (report.reactions.length)
            lines.push(`反应：${report.reactions.map(item => `${item.kind} ${item.hits} 段 ${round1(item.total)}`).join('、')}`);
        for (const item of report.energy ?? [])
            lines.push(`  能量 ${item.actorId}：${round1(item.start)} → ${round1(item.end)} / ${round1(item.max)}`);
        if (report.effectUsage.length)
            lines.push(`在场覆盖：${report.effectUsage.map(usage => `${usage.id} ${usage.hits} 段 ${round1(usage.total)}`).join('、')}`);
    }
    if (report.timings)
        lines.push(`耗时：${Object.entries(report.timings).map(([stage, ms]) => `${stage}=${ms}ms`).join(' · ')}`);
    if (report.approximateItems.length)
        lines.push(`近似项：${report.approximateItems.join('、')}`);
    for (const resource of report.resources)
        lines.push(`资源：${resource.id} [${resource.status}` + ') ' + `] ${resource.message}`);
    for (const problem of report.problems)
        lines.push(`问题：${problem.path} [${problem.code}] ${problem.message}`);
    return lines;
}
//# sourceMappingURL=report.js.map