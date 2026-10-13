// @ts-expect-error 维护者区是 ESM JS，没有类型声明（下面用窄类型断言后导出）
import { v2ToSections as rawV2ToSections } from '../../scripts/lib/guide-model.mjs';
// @ts-expect-error 同上（必须写成单行：`@ts-expect-error` 只压紧随的那一行，多行 import 的报错会落在 `} from …` 上）
import { normalizeGuideSections as rawNormalizeGuideSections, tierLabelClass as rawTierLabelClass, EMPTY_TEXT as rawEmptyText, WEAPON_REFINE_HINT as rawRefineHint } from '../../scripts/lib/guide-display.mjs';
/** `v2`（结构化六模块）→ 归一前的 sections */
export const v2ToSections = rawV2ToSections;
/** 归一：档位词、分隔符、专武标色、活动标签、空模块「暂无」等全在这里完成 */
export const normalizeGuideSections = rawNormalizeGuideSections;
/** 档位标签的 CSS 类名（`推荐` → `label-推荐`，非档位词返回空串） */
export const tierLabelClass = rawTierLabelClass;
/** 空模块文案（`暂无`） */
export const EMPTY_TEXT = rawEmptyText;
/** 武器精炼提示（`（四星/三星武器默认为精5）`） */
export const WEAPON_REFINE_HINT = rawRefineHint;
//# sourceMappingURL=markup.js.map