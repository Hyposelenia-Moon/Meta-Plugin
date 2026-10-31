/** 队伍模拟 P0 契约。百分比为比例（20%=0.2），属性为点数；不接管现有命令。 */
export const SCHEMA_VERSION = 1;
/** 构造旧口径结果，防止以 raw-complete 或 simulationReady:true 的形态冒充新引擎输出。 */
export function legacyEstimate(input) {
    return {
        status: 'legacy-estimate', mode: 'legacy', simulationReady: false,
        gameVersion: input.gameVersion ?? null, source: input.source,
        rows: input.rows.map(row => ({ title: row.title, value: row.value })),
        notes: [...(input.notes ?? [])]
    };
}
//# sourceMappingURL=types.js.map