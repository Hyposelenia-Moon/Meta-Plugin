// @ts-expect-error 维护者区是 ESM JS，没有类型声明（下面用窄类型断言后导出）
import { buildV2Sections as rawBuildV2Sections } from '../../scripts/lib/v2-sections.mjs';
// @ts-expect-error 同上（必须写成单行：`@ts-expect-error` 只压紧随的那一行，多行 import 的报错会落在 `} from …` 上）
import { tierLabelClass as rawTierLabelClass, EMPTY_TEXT as rawEmptyText, WEAPON_REFINE_HINT as rawRefineHint } from '../../scripts/lib/guide-display.mjs';
/**
 * v2 → 显示级 sections（**忠实的行构造器**，已含显示级归一）
 *
 * 实现见 `scripts/lib/v2-sections.mjs`（移植自 Atlas 的 `codexIndex/parse.js`）：
 * 档位词、`＞`、2+2 整体保留、皇冠并入天赋、命座「命之座X」、空模块「暂无」都在里面完成。
 * 实测与 Atlas 输出**全库 131/131 角色逐字段一致**（`test/codex-parity.test.mjs` 守着）。
 *
 * ⚠ 不要改用 `guide-model.mjs` 的 `v2ToSections`：那是两个维护者脚本用的简化测试模型，
 * 会丢 `kind`/`sets`/`talentLevel`/`crown`，导致天赋等级与 2+2 组合出错（见 1.2c 记录）。
 */
export const buildV2Sections = rawBuildV2Sections;
/** 档位标签的 CSS 类名（`推荐` → `label-推荐`，非档位词返回空串） */
export const tierLabelClass = rawTierLabelClass;
/** 空模块文案（`暂无`） */
export const EMPTY_TEXT = rawEmptyText;
/** 武器精炼提示（`（四星/三星武器默认为精5）`） */
export const WEAPON_REFINE_HINT = rawRefineHint;
//# sourceMappingURL=markup.js.map