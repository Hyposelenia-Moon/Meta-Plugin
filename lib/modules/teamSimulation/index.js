/**
 * 队伍模拟内核的唯一公开出口。
 *
 * 边界约定：
 * - 本目录内的文件只 import 本目录里的文件；
 * - 模块外的代码只 import 本文件（`index.js`），不直接指向 `timeline.js` 之类的内部文件；
 * - `src/model/TeamBuildAdapter.ts` 是适配层，它依赖本模块，本模块不反过来依赖它。
 *
 * 这样将来要抽成独立包时，改的是打包配置，不是每个调用点的 import。
 */
export { SCHEMA_VERSION, legacyEstimate } from './types.js';
export { validateCharacterBuild, requiredEffectSources, buildPermanentStats } from './build.js';
export { TARGET_PRESETS, calculateOrdinaryHit } from './formula.js';
export { DPS_STANDARD, dpsWindowFrames, checkDpsStandard } from './dpsStandard.js';
export { FRAME_TIERS, validateFrameTier, resolveActionTiming, validateActionSpec, simulateTimeline } from './timeline.js';
export { createEffectRuntime, validateEffectSpec, validateEffects, applyPanelModifiers, PANEL_STAT_KEYS, NO_ENEMY_MODIFIERS } from './effects.js';
export { validateDataPack } from './dataPack.js';
export { validateRotation } from './rotation.js';
export { planMechanisms, GEO_MECHANICS } from './mechanisms.js';
export { calculateTimelineDamage } from './hitDamage.js';
export { simulateTeam } from './teamRun.js';
export { buildTeamRunReport, formatTeamRunReport } from './report.js';
export { diffPacks, diffRotations, diffValues, formatDiff } from './diff.js';
export { buildRunLog } from './log.js';
export { validateRecording, recordingToRotation } from './recording.js';
export { evaluateReleaseGate, formatReleaseGate } from './gate.js';
export { REACTION_COEFFICIENT, REACTIONS, isReactiveKind, isStatefulKind, statefulReason, reactionLabel, reactionClass, reactionMultiplier, pairMultiplier, describeMismatch, reactionCoefficient, amplifyingFactor, catalyzeBonus, transformativeBase, SPECIAL_REACTIONS, specialMultiplier, specialMasteryFactor, specialPairMatches, describeSpecialMismatch, isSpecialKind, specialClass, specialLabel, STELLAR_CONDUCT_DEFAULT_COUNT, STELLAR_VORTEX_DEFAULT_COUNT } from './reactions.js';
export { REACTION_FAMILIES, BLOCKED_FAMILIES, gateReactionFamily, familyCoverage } from './reactionFamilies.js';
export { GOLDEN_THRESHOLDS, validateGoldenCases, evaluateGolden } from './metrics.js';
export { attributeEffects } from './attribution.js';
//# sourceMappingURL=index.js.map