# Meta-Plugin — 维护者指令

TRSS-Yunzai v3 插件：**原神攻略 · 强度榜单 · 练度查询**。
原数据仓库 `Character-Codex-Data`；2026-10 改造为独立插件，并整体并入 `Mhydps-Plugin`（后者已废弃）。

本文件与 `docs/`（除 `docs/private/`）**入库**、与代码一同评审；盘符、部署机与本机工作区在 `docs/private/`（**不入库，新克隆上不存在**）。

## 项目概况

- **入口**：`index.js` → `lib/index.js`；框架实际加载 `lib/`（**`lib/` 入库**，因 bot 侧只允许 `git pull`）。
- **源码**：`src/` → `tsc` → `lib/`（目录结构一致）。
- **分层**：`src/apps/`（命令薄壳）→ `src/modules/`（业务与查询）→ `src/model/`（外部适配：miao / mhydps / 本仓库商店 / Atlas 探测）→ `src/components/`（纯函数与常量，零 I/O，套件直接 import 编译产物）。
- **维护者区**（ESM JS，不参与编译）：`data/`（攻略数据本体 + `_index.json` / `_order.json`）、`scripts/`（Word→JSON→页面流水线、编辑器服务、自检）、`templates/`、`resources/`（页面模板、编辑器前端、字体、背景图）、`tool/`（背景图裁剪与对比度脚本）。
- **常用命令**：`pnpm build`、`pnpm test`（59 套）、`pnpm check`。
- **数据准备**：主文档 → `node scripts/parse-docx.mjs`；索引 `node scripts/build-index.mjs`；页面 `build-html.mjs` / `build-doc.mjs`。

### 快速参考

| 功能 | 入口（priority） | 触发 | 说明 |
|---|---|---|---|
| 角色攻略 | `Meta攻略`（**-100000**，写死） | `#胡桃攻略` / `#芙宁娜攻略 辅助` | 后缀式；单预设直返、多预设列用法；Atlas 别名可用；早于 Atlas 快捷入口(-99999) |
| 帮助（两小一大） | `Meta攻略帮助`（-100000） | `#meta`（总）/ `#攻略帮助`（=`#攻略`/`#攻略说明`）/ `#DPS帮助` | 三条规则同一 handler；图失败回落同源文本 |
| DPS（含角色档位视图） | `MetaDPS`（8000+0） | `#DPS [角色] [金数\|总榜] [标签] [主C] [绿玩] [页N]`（**`#` 必填**，不再接受 `榜` 后缀） | 2026-10-15 合并原 `#胡桃dps`；2026-10-17 重定分档；**2026-10-27**：裸 `#DPS` = 全库各金档（每档 6/5/4 条）；`总榜` = 平铺总榜；`12金` / `9-12金` = 该金数平铺前 10；`#DPS 胡桃` 仍为角色档位，`胡桃 12金` 改平铺前 10；裸词 `dps` 不再认领 |
| 危战分档 | `Meta危战档位`（8000-5） | `#危战 <版本/首领/角色> n6\|n7` | n6/n7 **剥离**，档位必填；裸 `#危战` 是 miao 的命令，不认领；单档最多列 **10** 条，页头**不渲染副标题行**；排序 **金数升序 → 同金数耗时升序**（2026-10-17，n7/n6 同口径） |
| 练度提升指南 | `Meta练度提升指南`（8000-5） | `#练度查询 胡桃` / `#练度查询 芙宁娜 辅助` | 攻略预设目标 × 当前配装（**不带 UID**）；miao 激活规则匹配预设，各预设独立维度与权重 |
| 队伍伤害 | `Meta队伍伤害`（8000-5） | `#队伍伤害<N> A B C D [词条…] [UID]` | v3；N = 配置 `teamDamageAxes` 的序号轴（省略 = 1），词条**免前缀**；旧 `轴:`/`词条:` 已废除 |
| 视频名次（**后缀式**） | 随 `rank` / `raidTiers`（无独立 app） | `#DPS 刻晴 48金视频1` / `#危战 矮灵 n7 视频3` | 原 `#视频` / `#危战视频` 前缀式与 `video` app **已废除**（用户 2026-10-15 定）；「视频名次」模块开关保留，在后缀分发处拦截 |
| 状态 | `Meta状态`（8000-10） | `#meta状态` | |
| 榜单刷新 | `Meta数据管理`（8000-10，master） | `#榜单刷新` | 仅主人；旧三种写法行为相同，只留一条 |

> 2026-10-15 用户裁定**命令面整体重构**（"指令大乱炖"）：旧 `#DPS…` 族一律废除，只保留 `#DPS` / `#DPS帮助`；
> 冲突侦察结论与最终命名表见 [docs/功能与命令.md](./docs/功能与命令.md)（`constants-parity` 的偏差 B17 守着旧名不复活）。

> 本插件业务命令的 priority = `config.priority`（默认 8000）+ 各命令偏移；偏移与文案的唯一来源是 `src/components/constants.ts` 的 `COMMANDS`。

> **展示层分两层，不要混**（2026-10-15 UI 重构「档案批注」定）：业务口径在 `src/modules/grade.ts`
> （三维权重、九档、毕业档、四态 `met/below/unscored/unknown` + `reason`），**展示投影**一律走
> `src/components/presentation.ts`（`buildPresentation()` → `mx`：`dims / evidence / references /
> suggestions / score / sources`），模板只消费 `mx.*` 与少量既有字段：
>   - `pct: null` = 未知/不计分 → **不画填充条**、数值列写 `—`（旧实现写 `0%`，把"没取到"说成"一点没做"）；
>   - 证据号 `E01…` 是**本页呈现号**，只发给未达标/未知行（达标行压成"其余 N 项达标"）；建议用
>     **稳定键**（`talent:A` / `artifact:main:时之沙` / `weapon:choice`）绑定证据，不靠中文名；
>   - 来源时间只写可核实的源时间（miao 的 `dataSource` / `updateTime`），缺失写"时间未提供"；
>     **不得用 `Date.now()` 冒充面板更新时间**；`assessable=false`（关键数据未知）时页面显示"待评"、不出 0 分字母档。
> 共享样式一律进 `resources/common/meta-ui.css`（**浅色底**；组件规则限定在 `.mx-content` 作用域内，
> 页面级只允许 `:root` / `body.elem-*` 这类**令牌块**；**不给立绘行内部类写规则** —— `.gd-basic` / `.gd-main-pic` /
> `.gd-char-` / `.gd-talent` / `.gd-cons` 一个都不许出现，`body.gd-elem-*` 是元素标记、放行），
> 四张图都消费 `mx`：练度 `grade.html`、攻略 `codex.html`（miao 外壳与
> `.talent-icon` 不动）、队伍伤害 `team-damage.html`。
> 练度页的冻结立绘行 `.gd-basic` 子树与 miao 原生名次面板不受影响。设计规格与离线预览包：
> `D:\Downloads\QQ\Meta-UI设计包.zip`（落地范围：阶段 1–4、不新增维度、§12 各条按规格默认）。

> **浅色主题（B+C 方案，2026-10-15 用户选定；审核 Q6/Q7 口径）**：
> ① 页面底层在 `resources/common/base.css` 的 `.page--soft::before`（**opt-in**，程序生成的三层低频渐变，不引素材）；
>    元素强调色令牌 `--page-acc` / `--page-acc-soft` 定义在 `meta-ui.css`（攻略页不引 base.css 也要用），
>    两套元素类名都认：自有模板 `body.gd-elem-{element}`、miao 布局 `body.elem-{element}`；未识别元素退回中性灰；
>    每个元素色都是"不透明浅底上的正文色"，三档浅底均 ≥4.5:1（`test/presentation.test.mjs` 守着）。
> ② 纸面（`.mx-content`）是**不透明**白 + 1px 描边 + 柔和投影 + 极轻噪点（data-URI）＝Mica 风格，**不做半透明**；
>    元素色只作**弱点缀**：章节号 / 总分 / 证据号 + 纸面顶部 3px 细条（`.mx-content::after`）。
> ③ 立绘→纸面过渡带是 `.page--soft .mx-content::before`（高度 `--mx-hero-fade`，默认 96px，置 0 即关闭）；
>    **只在浅色主题页生效** —— 攻略页继承 miao 外壳，不得被这层雾盖住页头。立绘行 `.gd-basic` 的 DOM/样式一行未动。
> ④ 已启用：`dps/grade.html`、`dps/team-damage.html`（`class="page page--soft"`）；
>    榜单/危战/状态/帮助系列**未启用**（密集表格结构不动，按审核 Q10 先验证再扩展）。
> ⑤ 后续（审核 §4.2）：要上亚克力/半透明主题，必须先补 alpha 合成 + 实际渲染背景的对比度门禁，
>    并在含立绘整页与真实发送格式上测图积/耗时。

> **元素底 + miao 图鉴式模块卡（成品版，2026-10-15 定稿）**：
> ① 页面背景 = miao 的元素底 `common/bg/bg-{元素}.webp`（**只引用不复制**，见 `base.css` 的 `.page--elem` / `--page-art`），
>    并柔化成"氛围底"：`filter: blur(16px) saturate(1.35) brightness(1.18)` + `--page-scrim` 压暗；
>    未识别元素退回柔和渐变（同一 `background-image` 栈的第二层起）。
> ② 数据区（练度 / 队伍伤害）= `.mx-content--glass`：**miao 图鉴模块卡**的表层
>    （10px 圆角 + 柔和外阴影 + 1px 浅环；标题条 `rgba(0,0,0,.4)` + 金色 `#d3bc8e`，照 `common.css` 的 `.cont`/`.cont-title`），
>    内部行**不用斑马底**，靠细分隔线 + 行高；数值/进度条用 miao 金渐变，达标用绿 `#90e800`。
>    文字不透明度按"元素底最亮像素 → 压暗层 → 卡片"的 alpha 合成验 ≥4.5:1（`test/presentation.test.mjs`）。
> ③ 攻略页**排版回到本插件迭代前的自绘版式**（`card` + `codex-row`，不继承 miao 图鉴外壳），
>    仍走同一张元素底；长标签独占一行、占位值在视图层归一。
> ④ 已启用元素底的页面：练度 / 队伍伤害 用 `class="page page--elem"`；攻略页用 `gd-elem-*` + `page--elem`；
>    榜单/危战/状态/帮助系列**未启用**（密集表格结构保持原样，按审核 Q10 先验证再扩展）。
> ⑤ 要上半透明亚克力主题前，先按审核 §4.2 补 alpha 合成 + 实际渲染背景门禁与含立绘整页的图积/耗时实测。

> **审核意见落地的三条展示规则**（2026-10-15，见 `D:\Downloads\QQ\Meta-污染消息与UI美化-审核意见.md` §4.3/4.4）：
> ① 参考项必须保留**方向**（`输出向`/`辅助向`，跨方向同值合并成 `输出向/辅助向` 一条），稳定键 `panel:<方向>:<attr>`，
>    参考区两列叫「当前 / 参考目标」，百分比属性两侧都带 `%`；**不要按属性名一刀切去重**。
> ② 整值占位符（`___%`、`——`、空）在展示层 `presentation.ts` 归一（`normalizeMetaValue()` 进 `metaRows`、
>    `normalizeItemText()` 处理 `名称：值`），**图片与文本回退同源**；只认"整值都是占位符"，不误判 `0`/`0%`/区间，
>    且占位值不算攻略内容（`hasContent` 仍按"meta 有非空值"）。
> ③ 长标签（> 6 字符）**独占一行并按 `/` 等语义边界分行**（`mx-guide-row--longlabel` + `labelLines`），
>    不全局加宽标签列；`mx-guide-value` 始终保留 `minmax(0, 1fr)` + `min-width: 0`。

> **0 命中不出空图**（2026-10-15 用户反馈后定）：查询一条都没命中时，`modules/respond.ts` 不渲染、直接走文本回退，
> 且文本里必须带**筛选条件与命中数**（`rankQuery.filterSummary()`，角色档位页的副标题也带上它）——
> 空图只有一句"没有查询到…"，看不出是哪个筛选把结果筛没了（当时 `#dps 七七 48金 视频1` 的 `视频1`
> 被当成"标签"筛选，弹出一张莫名其妙的空图）。

> **引用回复的原文不算参数**（2026-10-15 用户反馈后定；2026-10-28 复审改为**边界判定**）：用户引用机器人上一条回复时，
> 那段文字会跟着进 `e.msg`。`modules/quoteGuard.ts` 的 `stripQuotedBlock()` 只剥离**完整引用块** ——
> 开头块后必须换行 + `#` 命令；结尾块前必须有换行边界，或"空白 + 命中输出指纹的整块回帖"。
> 短词、数字、命令前缀、重复本身都不构成证据（引用「矮灵」不再删 `#危战 矮灵 n7`；引用「2」不改 `#DPS 22金 页2`）。
> 路由与档位用 `isolatedText()`（自身段优先）再解析；`resolveCommandArgs()` 先隔离全文再匹配参数。
> 无自身段且隔离后仍有多个档位（`n7 … n6`）→ 提示重发，不查询、不出图（`hasMultipleTiers()`，两个 handler 入口都有闸门）。
> 另：**隐式标签**（角色名之后的裸词）先与数据集核对（`rankQuery.effectiveTag()`）——真实标签照用、
> 一个都不存在就整段忽略；**显式** `标签:X` 仍原样参与筛选（匹配不到就如实给 0 命中 + 写明标签）。
> `parseRankArgs` 因此比合并前多一个 `tagExplicit` 键（偏差 B18，`test/mhydps-parity.test.mjs` 守着）。

## 文档索引（按需阅读，别一次全读）

| 想了解 / 要改的东西 | 先读 |
|---|---|
| 命令与触发词全集、权限、路由优先级 | [docs/功能与命令.md](./docs/功能与命令.md) |
| 目录分层、构建与产物、运行时写入边界 | [docs/架构.md](./docs/架构.md) |
| 改一处内容要同步哪些消费者、固定验收集、提交正文要求 | [docs/改动传播清单.md](./docs/改动传播清单.md) |
| 角色 JSON 字段、段落与行内强调、完整示例 | [docs/数据-角色字段.md](./docs/数据-角色字段.md) |
| 文档词汇 vs 显示词汇（**改数据前必看**） | [docs/数据-词汇口径.md](./docs/数据-词汇口径.md) |
| 档位词自定义、攻略图（游戏内面板）呈现约定 | [docs/数据-档位与攻略图.md](./docs/数据-档位与攻略图.md) |
| v2 数据结构、备注行、主词条括注、ref 写法 | [docs/数据-文档结构.md](./docs/数据-文档结构.md) |
| 新增/修改角色、每天回写、空档角色、行文约定 | [docs/数据-写作与回写.md](./docs/数据-写作与回写.md) |
| Word→JSON、图鉴索引脚本 | [docs/脚本-文档与索引.md](./docs/脚本-文档与索引.md) |
| 图形化编辑器、保存即发布（含「预览 = bot 实发页面」） | [docs/脚本-编辑器与发布.md](./docs/脚本-编辑器与发布.md) |
| 解析告警（防呆，不静默） | [docs/脚本-解析告警.md](./docs/脚本-解析告警.md) |
| 测试命令、前置与跳过 | [docs/测试.md](./docs/测试.md) |
| 许可、字体、版权声明、数据来源 | [docs/许可与来源.md](./docs/许可与来源.md) |
| 待办与规划（含 Atlas 导出清单） | [docs/待办与规划.md](./docs/待办与规划.md) |
| 盘符映射、部署机、本机工作区 | `docs/private/`（**不入库，新克隆上不存在**） |

## 约定

1. **文档入库范围** — 本文件与 `docs/`（除 `docs/private/`）**入库**，与代码一同评审提交；`docs/private/` 放盘符、部署机与本机工作区，**不入库**，因此入库文档只写占位（`<插件根>` / `<bot根>` / `<主文档>`）且**不得依赖**它（新克隆上没有）；`CLAUDE.md`、`.claude/` 与本地工作区目录**仍忽略**（用途见 `docs/private/本机工作区.md`）。
2. **文档必须同步** — 功能 / 命令 / 配置变更时同批更新：`docs/` 对应册、`README.md`（面向使用者）、本文件（快速参考）、`src/components/constants.ts`（命令文案）、帮助页配置、`docs/测试.md` 的套件数。
3. **一轮一份提交摘要；发之前先判定工作区状态** — 摘要只写代码侧改动（文档与配置更新单列一行说明）；会话内不执行任何 git 写操作（提交由维护者手动做）。
   **每次出摘要前必须实际跑一遍 `git log --oneline -1`、`git status --porcelain`、`git diff --stat`，按工作区真实内容决定「合并」还是「单发」**（2026-10-17 用户定，不许凭记忆判断）：
   - 上一轮改动**已被提交**（HEAD 就是上一轮那次提交，工作区只剩本轮改动）→ **单独一份**，不重复上一轮已发过的条目；
   - 上一轮改动**仍未提交**（工作区里混着两轮及以上）→ **合并成一份**，并在标题下注明「合并上一轮：<上一轮标题>」；
   - 工作区**为空**（本轮没有未提交改动）→ 只说明「本轮无未提交改动」，**不得**把已提交轮次的摘要重发一遍；
   - **判定失败**（非 git 仓库 / 机器无 git）→ 按「单独一份」发，并在摘要里注明「工作区判定失败」。
   摘要条目必须与 `git diff --stat` 对得上：已提交过的轮次不再列条目，工作区里没改的文件不得写进摘要。
4. **中文、可复现** — 文档用简体中文，命令与字段名保持原文；不写"见本机某脚本"这类新克隆上无法复现的引用（只允许存在性提示）。

## 硬约束速查（改前必读；细节见各册）

### 页面/样式改动的强制流程（2026-10-16 用户定为**硬约束**）

改任何页面或样式之前，必须按顺序完成下面四步，缺一不可，**不许把没自审的东西交出去**：

1. **只读排查**：先把相关模板与 CSS **读出来**，逐条列出现值与出处（文件:行号），不得凭印象或"大概是"改；
2. **自己渲染成图**：在本地把该页渲染成 PNG（可用 `%TEMP%` 下的镜像树 + headless 浏览器），不得以"本地渲染不可信"为由跳过这一步；
3. **自己审核**：拿参照物（miao 面板页 `character/profile-detail.html`、本插件练度页等）逐项核对尺寸/位置/字体/配色，发现偏差**自己先修**；
4. **再交付**：交付内容 = 渲染图 + 自审结论（哪些一致、哪些仍有差异及原因），然后才是提交摘要。

**照抄类改动的定义**（避免"画蛇添足"）：
- "逐字照抄" = 取值一字不改；若某条必须适配，**只允许改那一条**，并在注释里写明"唯一适配点"；
- 不得顺手改类名、结构、容器、间距、字号等未被点名的地方；
- 与参照实现**同名类冲突**时，优先用"同结构 + 更高优先级的选择器"，而不是加 `!important`。

**已发生的反例（禁止重演）**：凭印象改值/改结构/改容器；按"行区间"删除导致误删 `</style>` 与相邻规则；把 miao 原始类名与自有类名混用导致两套样式互相覆盖；未渲染即交付。

1. **抢占优先级写死** — 攻略类走 `PREEMPT_PRIORITY = -100000`，**不做成配置项**；`accept()` 只认领 `攻略` / `攻略帮助` / `攻略说明`（+ `#meta`），其余一律放行，保证 Atlas 图鉴行为逐字不变。子项：**`#设置默认攻略N` 不接管**，`CODEX_SUFFIX_RULE` 的负向断言 `(?!.*设置默认攻略)` 必须保留，否则会吞掉 genshin 的设置命令。
2. **攻略入口只留后缀式** — `#<角色>攻略`；`#攻略 <角色>`、`#攻略 <角色> <模块>`、`#攻略 <武器> <名>` 已按要求移除，**不得加回**。
3. **命令表单一来源** — 所有命令正则只在 `src/components/constants.ts` 的 `RULES` 定义一处，元数据（插件名 / 文案 / 权限 / 优先级偏移 / 模块键）只在 `COMMANDS`，判定只在 `matchCommand`；app 里只允许 `reg: RULES.x` + `COMMANDS.find(...)`。改命令必须同轮更新 `COMMANDS.dsc`、帮助页（`resources/help/help-cfg.js`）、README、[docs/功能与命令.md](./docs/功能与命令.md) 与相关套件。
   **所有命令必须带 `#`**（2026-10-27 用户定：全部规则从 `^#?` 收紧为 `^#`，裸词不再认领；`#DPS榜` 同批废除、统一为 `#DPS`）。
   历史：合并前的 `DPS_RULES` 冻结面已按用户 2026-10-15 的决定**整体废除**（偏差 **B17**，`test/constants-parity.test.mjs` 守着"旧名一个都不许复活"）；快照仍守着**非命令**常量（标量 / 映射表 / 纯函数）与合并前逐字一致。
   子项：**帮助页只写使用者向内容**（`resources/help/help-cfg.js`）——不得出现配置键、文件名、"改配置"这类要开发者/管理员处理的说明；**不展示需要管理员先配置的非默认序号轴**（只写 `#队伍伤害 四人名`）；标题过长靠 CSS 换行（`resources/{codex,dps}/help.html` 的 `.entry-cmd` 已去掉 `nowrap`+`ellipsis`）。`test/dps-help-config.test.mjs` 三个门禁守着这三点。
13. **练度评分口径（2026-10-29 用户确认：独立攻略预设）** — 查询先解析角色（标准名 → Atlas 正式别名门面 → miao 别名 → 唯一包含），再读取 miao 面板当前规则选择预设；手动指定优先，其次预设规则精确名/正则、规则标题方向、属性权重；歧义不猜，提示指定预设。
    `schema:3` 的 `presets` 各自独立保存 `meta/v2/freeModules/topConstellations/match/weights`；选中后投影再提取目标，禁止混用其它预设。
    输出默认 `artifact:30,panel:30,weapon:20,talent:20`；辅助默认 `artifact:0,panel:50,weapon:25,talent:25`；每份预设可覆盖权重，0 不计分。缺目标不计分、关键玩家数据缺失待评；证据与建议必须采用相同判定。
    miao 圣遗物评分及规则标题仍取当前激活规则（“西风纯辅”等辅助名称优先于属性比例）；旧三维评分仅保留无 preset 参数的 API 兼容，不用于新练度查询。
    **条件型目标（命座）三处同判**（2026-10-27 复审）：计分 / 证据行 / 建议统一走 `condSatisfied()`；命座不足的目标不参与计分、不生成未达标证据，只在参考区保留条件标注。**套装组合行**按 `sep` 解析：`/` 备选、`+` 组合（两个 `2` 前缀条目合成一条 pair，其余为备选）；**文本回退的「差在哪」**按维度状态写（below / unknown / 全部达标），不得只凭 rows 为空就宣称达标。
    **新预设路径**中输出面板参与评分，辅助圣遗物默认不参与总分；被关闭维度只作参考，不能生成未达标建议。旧三维 API 保留原配置读取，不得在新预设路径中将 `panel` 与 `artifact` 再合并。
   页面宽度与立绘行（2026-10-15 用户定：**照抄 miao，不许自己发挥**）：**立绘行已定稿 —— 保持 miao 同款，任何会话不得再改**（结构 / 尺寸 / 字号 / 层级 / 配色 / 图标 / 文字，一律不动；连"顺手优化"也不行，要改必须先问用户）。它现在的样子就是 miao `resources/character/profile-detail.{html,css}` 的逐条复制（只加 `gd-` 前缀、**数值一字不改**）：练度页整页 **600px**（= miao 面板 `body{width:600px}`），立绘行以下分区随 600px 自适应；`.basic`→`.gd-basic`、`.main-pic`(1400×500/`margin-left:-545px`)→`.gd-main-pic`、`.detail`(right/top 20px)→`.gd-detail`（内含 `.char-name`50px / `.char-lv` / `.char-talents` / `.char-attr`）、`.char-cons`(250px/bottom 5/left 20)→`.gd-char-cons`；面板 = `.char-attr li`（**300×32**、斑马行、五列 `.icon`26/`.title`75/`.weight`36/`.value`100/`.value2`70（白字基础值 + 绿字 `+加成`），图标精灵图 `character/imgs/icon.png` + `.i-*` 偏移；`.value`/`.value2` 的文本**直接调 miao 的 `Format.comma`/`Format.pct`**（照抄 `apps/profile/ProfileDetail.js:216-242`：`hp` 取整 + 千分位、其余 1 位小数，`phy > dmg` 时 `dmg` 行显示物伤），权重取 `getArtisMark(true).charWeight`），**只写属性名与数值**（不加目标、不加达标条）；天赋图标**照抄 `CharImg.getImgs()`**：`talentCons[key]>0` 用命座图标 `icons/cons-N.webp`，否则 `icons/talent-{key}.webp`；`level > original` 加 `talent-plus`（深底金字）、`original >= 10` 叠 `character/imgs/crown.png`（`top:0`）；图标圆环按元素（`<body>` 挂 `gd-elem-{elem}`，照抄 `common.css:208-266` 的 `common/bg/talent-{elem}.webp`），`.gd-talent-icon` **必须带 `z-index: 90`**，否则左下角命座行会被 `z-index:2` 的立绘盖住；命座行条目是 `.cons-item`（不参与 flex 均分）；命座徽章照抄 `.char-lv .cons` + `common/css/common.css` 的 `.cons`/`.cons-N`（0 `#666`/1 `#5cbac2`/2 `#339d61`/3 `#3e95b9`/4 `#3955b7`/5 `#531ba9cf`/6 `#ff5722`，白字）；立绘图**取图逻辑照抄 miao**（`src/model/ProfileImgRes.ts`；只读 miao 的配置与图库目录，**不写它的配置、也不复制图片**）：图库源 = `CharImg.getProfileImgSrc()`（`config/profile.js` → `config/system/profile_system.js` → `['profile']`，**第一个非空生效**，相对路径以 miao `resources` 为基准、绝对路径原样）→ 候选池 = `getProfileImgPool/Files()`（`super-character` 彩蛋层 / `normal-character` 普通层 **+ 平铺 `{源}/{角色}/`**，同层多源合并，只认 webp/png/jpg/jpeg）→ 选图 = `ProfileAvatar.getCostumeSplash()`（`#练度查询 胡桃 面板图N` 按 `{角色}_{序号}_…` 取第 N 张、彩蛋层优先，否则层内随机；彩蛋判据 = C6 / 圣遗物 ACE·MAX / 天赋原始等级 `101010`）→ 兜底 miao 自带 `imgs/splash0.webp`（彩蛋）·`splash.webp`；bot 内用 5 级相对前缀引用、跨盘走 `file://`。**不许**改成"复制到 out/"或另起一套源列表 → 结论（档位 + 三维条）→ **当前配装**（武器 → 套装 + miao 评分与有效词条数，不列单件与伤害；等级/命座与天赋都已在立绘行）→ 未达标项 → 提升建议 → **参考 DPS**（当前金数向下取 4 的倍数、步长 4、最多 3 档，每档取含该角色的最高伤害）→ 脚注**口径一行 + 版权，合计不超过 2 行**。套装只写 4 件套 / 2+2 / 2 件套，凑不出就写「散件」；圣遗物行右侧显示 `评分 246.4 ACE　词条数：42.4` —— 词条数只累加 miao `charWeight[key] > 0` 的有效词条 `eff`（**无效词条不计**；也不是数条目数，那是 20）。
   改这套口径必须同轮更新 `resources/dps/grade.html` 的口径行、`docs/功能与命令.md` 的「练度评分口径」与相关套件（`grade` / `grade-guide-targets` / `dps-template` / `portrait-gallery`）。
   配色：**档位颜色与 miao 同款**（MAX/ACE 红 `#e85656`、SSS/SS 金 `#ffe699`、S/A 紫 `#d699ff`、B 以下默认色），综合档位与圣遗物评分同样上色，**未达标项用同一红色**。
   当前配装的**圣遗物行**：`gd-row-artis`（`flex-wrap: wrap`）+ 评分块 `gd-verdict-wide`（`flex:0 0 100%`、`white-space:nowrap`）—— 套装名独占一行、`评分 X.Y SSS　词条数：N` 换到下一行右对齐；**不要**再把评分块做成固定宽度的同行列（那会把「晨星与月的晓歌×4」这种长套装名挤成两行，整行看起来错位）。
4. **`lib/` 入库** — 改 `src/` 后必须 `pnpm build` 并一并提交 `lib/`（`test/lib-fresh.test.mjs` 按 mtime 判断"lib 是否落后于 src"）。
5. **运行时只写 `out/` 与 `config/`** — 绝不写 `data/`、`lib/`、`resources/`、`scripts/`、`tool/`（写了会挡住 bot 侧的 `#更新`）。
6. **测试不得写 `data/`** — 路径一律走 `test/.test-tmp/` 自建子目录或环境变量覆盖（`META_CONFIG_FILE` / `META_MIAO_DIR` / `META_ATLAS_DIR`）。
7. **miao 必需、Atlas 可选** — 缺 miao 给可读提示；Atlas 缺失或异常**只降级不报错**，且**不 import 它的内部模块**（走稳定导出，见 [docs/待办与规划.md](./docs/待办与规划.md)）。
   读面板必须走 miao 的对象契约：`Avatar.artis` 是 **`Artis` 实例**（`getArtisDetail()` 按部位 1..5、`artis.sets` 给件数、`artis.hasAttr` 判词条、`getArtisMark()` 给评分），**不要 `Array.isArray`、不要用 `names` 计件**；刷新成功只看**目标角色**（别拿账号级 `player.hasProfile` 当成功）。
8. **联网默认关（查询联网层）** — 仓库侧 `networkEnabled` 默认 `false`，用于控制 DPS、危战、练度查询等业务查询中的远程数据访问与刷新；相关远程刷新点（mhydps / miao 面板 / 队伍）都要先读开关，关闭时不得发起受该开关管理的远程请求。**该开关不是整个插件的全局联网禁令**，不自动限制别名服务、可选插件探测、依赖安装及其他非上述业务查询的网络操作；这些操作仍须遵守各自的安全与错误处理约束。榜单 / 危战 / 练度需代理（国内直连 `mhydps.cn` 会在 TLS 握手阶段失败）；米游社 ck 由 miao 保存，本插件不保存任何凭据。
    子项：判定统一走 `isQueryNetworkEnabled()`（**别再散写** `loadConfig().networkEnabled`），关闭文案统一用 `QUERY_NETWORK_OFF_HINT`（含"只管辖查询类远程访问"这句，不得自创措辞）；`AvatarStore` 的榜单头像下载属查询类资源、同样受管。两层开关的划分见第 12 条。
9. **锅巴模板替换必须用回调** — `template.replace(re, () => String(value))`：直接传字符串会把值里的 `$&` / `$1` 当替换语法（`src/guoba/index.ts`）。
10. **编辑器静默陷阱** — 事件委托必须 `closest('[data-act]')` 往上找（行尾图标是内联 SVG，`e.target` 常是 `<path>`）；保存失败（`res` 为 `null`）时**先返回**，否则会清掉未落盘草稿；`git diff --cached` 必须带 `-z`（默认 `quotePath` 会把中文路径转义，逐行比较会把自己人判成"范围外"而阻止提交）；改过共享层**必须重启编辑器进程**（长驻进程会缓存旧模块）。
11. **框架截图契约** — `runtime.render(plugin, path, data, cfg)` 的 `retType` 属于**第 4 参**；本版 `puppeteer.screenshot` 返回**图片消息段**（不是 base64），拿到段要直接 `e.reply` 发送；只有当框架已经自己发图（返回 `true`）或我们确实拿到图时才 `return true`，否则一律 `false` 交同源文本回退。
12. **两层开关正交** — 配置里两组开关各管一段，**不得互相替代**：`modules.*`（**功能层**，9 个模块，默认全开、`teamDamage` 默认关闭：关闭时命令不响应）｜`networkEnabled`（**查询联网层**，见第 8 条）。模块开关的接入方式：非接管类在 handler 首行 `if (await moduleGateReply('<key>', e)) return true`；接管类（攻略 / 帮助）在 `accept` 与 handler 两处都判 `moduleOff('<key>')` 并返回 `false`（**框架的 `accept` 只影响认领，不会跳过本插件自己的 rule**，只改一处会变成"不认领却照样吃掉消息"）。新增命令模块必须同轮登记 `MODULE_KEYS` / `MODULE_LABELS` 与 [docs/功能与命令.md](./docs/功能与命令.md) 的开关表。

## 测试

```bash
pnpm build && pnpm test     # 59 套；任意 cwd 可跑、不发真实网络、缺前置自动跳过
```

- 缺 bot / miao 时渲染类套件自动跳过；设 `META_MIAO_DIR` / `META_ATLAS_DIR` 指向真实资源可启用更严断言。
- 冻结门禁：`mhydps-parity`（与合并前逐字等价）、`constants-parity`（常量快照）、`codex-parity`（131/131 逐字段）。
- **行为级契约套件**（用假对象/真实构建器驱动编译产物，不查源码正则）：
  `miao-artis-contract`（`Artis` 实例形状、`sets` 件数）、`miao-damage-rows`（`{ret}` 伤害结果契约与三种失败口径）、
  `grade-guide-targets`（`kind` 分桶、组合候选、建议口径）、
  `modules-switch`（模块开关的默认值、深合并、闸门拦截与放行、非接管类 app 的接线（7 个））、
  `render-fallback`（`retType` 第 4 参、图片消息段返回、失败一律回退）。
- 维护者区自检（不在 `pnpm test` 内）：`node scripts/editor-selftest.mjs`（258/258）、`display-selftest.mjs`、`display-audit.mjs`、`audit-guide-html.mjs`。`node scripts/scan-portrait-padding.mjs` 是**按需**跑的白边扫描（生成 `out/portrait-padding.json`，攻略页立绘据此跳过白边图；图库变动后重跑）。
- 细节与固定验收集见 [docs/测试.md](./docs/测试.md) 与 [docs/改动传播清单.md](./docs/改动传播清单.md)。

## 待办（摘要）

1. **两轮复核的 C 批（工程债）未做**：`lib-fresh` 改内容门禁、`accept()` 对已移除前缀的认领清理、状态页明示联网/代理口径、迁移等价措辞修正。
2. **Atlas 别名正式门面已接入**：`modules/aliasApi.js` 的 `resolveAlias(name,'gi')`，双向候选须结合本仓库角色集合裁决；图标路径 / 实体信息 / codex 旧资产移交仍待接口落地。
3. **Atlas 侧移除 `syncCodexRepo()`**：旧仓库改名后 bot 日志里仍在 502。
4. **`Mhydps-Plugin` 远端仓库**是否 Archive / 删除待确认（本地两处副本已清空）。
5. 真机验证补跑：`#胡桃攻略`（图 / 文本回退）、编辑器四项（重命名 / 同秒连续替换撤销 / 同名删除 / 他人暂存提交）。

细节见 [docs/待办与规划.md](./docs/待办与规划.md)。
