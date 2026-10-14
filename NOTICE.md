# 第三方组件与许可（NOTICE）

本仓库（Meta-Plugin）在实现中复用/移植了以下第三方组件。按各自许可保留声明。
**本文件是人读的说明性文档**；实际代码里也有对应的文件头注释与出处标注。

---

## 1. miao-plugin —— 图鉴版式、字体与图标资源；面板数据与伤害计算

- **用途**：
  1. `resources/codex/codex.html`（原神攻略页）**沿用 miao 的角色图鉴页版式与类名**，
     并通过框架注入的 `{{_miao_path}}` / `{{extend elemLayout}}` 在**运行时**引用 miao 的
     样式（`common/tpl.css`、`character/profile-detail.css`、`wiki/character-wiki.css`）、
     字体与图标资源；本仓库**不复制也不再分发** miao 的 CSS 与字体资产。
  2. 角色立绘 / 命座 / 天赋 / 武器 / 圣遗物图标与**别名**解析（`src/model/MiaoRes.ts`）。
  3. 练度查询页复用 miao 的面板模型渲染（`src/model/MiaoPanel.ts`：动态 import 其 `models` 与 `Format`）。
- **许可**：MIT License，Copyright (c) 2023 Yoimiya（上游 [yoimiya-kokomi/miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin)）。
  本机部署的是 **AxiuCN 维护的 fork 改版**（其 README 首段声明）。
- **依赖关系**：miao-plugin 是本插件的**必需依赖**（另见角色立绘 / 别名解析）。缺失时攻略页会失去样式，
  但插件不会报错（状态页会显示资源来源）。
- **边界**：只**读取** miao 的模型与资源，不修改、不复制其资产；用户的取数凭据（cookie / token）始终留在 miao 自己的配置里。

## 2. Atlas-Plugin —— v2 行构造器（移植）

- **用途**：`scripts/lib/v2-sections.mjs` 的 v2 → sections 行构造器
  （`v2WeaponRows` / `v2ArtifactRows` / `v2TalentRows` / `v2PanelRows` / `v2ConstellationRows` / `v2TeamRows`
  及 `gapSeps` / `rankItem` / `inlineLabel` / `splitTop` / `isBlankText` 等辅助）
  **移植自** `Atlas-Plugin` 的 `model/codexIndex/parse.js`。
- **许可与授权**：Atlas-Plugin 作者 AxiuCN；经作者同意复用其插件内部模块（其口径：给出必要理由即可导出/适配）。
- **验证**：`test/codex-parity.test.mjs` 会对抽样角色与 Atlas 同名实现逐字段对照
  （开发机存在 Atlas 时全库 131/131 一致）。

## 3. Mhydps-Plugin —— 榜单/危战/练度侧的整体合并（迁移，作者即本仓库维护者）

- **迁入内容**：
  - 代码（TS 端口化）：`src/model/{TeamStore,MhydpsClient,AvatarStore,CharacterIndex,AkashaClient,AkashaBrowser,MiaoPanel}`、
    `src/modules/{queryArgs,teamView,rankQuery,raidQuery,akashaQuery,formatText,respond}`、
    `src/apps/{rank,raid,status,video,admin,build}`、`src/components/{config,constants,pluginVersion,render}` 的相关部分
  - **v3 P1 新增**（2026-10-14，仍属本插件自研）：`src/modules/{charDpsQuery,raidTiersQuery}.ts`
    （`#xx dps` 的金档分组、`#危战` 的 n6/n7 分档）、`src/apps/{charDps,raidTiers}.ts`、
    `resources/dps/{char-dps,tiers}.html`（复用已有 4 张底图）、`test/{char-dps,raid-tiers}.test.mjs`
  - **v3 P2 新增**（2026-10-14，本插件自研）：`src/modules/grade.ts`（纯函数评分器）、
    `src/model/MiaoProfile.ts`（miao 面板薄桥）、`src/apps/grade.ts`、`resources/dps/grade.html`、
    `test/{grade,level-query}.test.mjs`
  - **v3 P3 新增**（2026-10-14，本插件自研）：`src/modules/teamDamage.ts`（金数估算 / 同阵容匹配）、
    `src/model/MiaoProfile.ts` 的 `readTeamDamage`（复用 miao 的 `avatar.calcDmg`）、`src/apps/teamDamage.ts`、
    `resources/dps/team-damage.html`、`test/team-damage.test.mjs`
  - **复用 miao 的伤害引擎**：`models/ProfileDmg.js` + `resources/meta-gs/character/<名>/calc.js`
    （129 个角色），通过 `avatar.calcDmg({ enemyLv: 103, mode: 'profile' })` 调用；本插件不复制其规则文件
  - 资源：`resources/dps/*.html`（榜单 / 危战 / 状态 / 帮助模板）、`resources/common/bg-*.jpg`（4 张插画底）、
    `resources/common/font/*`、`resources/common/{base,components}.css`、`resources/data/{characters,bosses}.json`
  - 测试：16 个套件迁入本仓库（`test/*.test.mjs`），并冻结了与合并前**逐字等价**的快照
  - 工具：`tool/background/`（`crop-background.ps1` 按出图宽高比裁底图、`fullpage-contrast.ps1` 对真实底图复核对比度、说明文档）
- **作者与许可**：作者即本仓库维护者（Hyposelenia），随本次合并一并迁入，非第三方代码。
- **上游**：`Mhydps-Plugin` 仓库在合并完成后废弃（工作区副本 / bot 侧目录 / GitHub 远端三处）。

## 4. https-proxy-agent —— 代理支持

- **用途**：`src/model/MhydpsClient.ts` 访问 mhydps.cn 时按需走本地代理（国内直连会在 TLS 握手阶段失败）。
- **许可**：MIT。

## 5. 字体

- 攻略页与帮助页使用的字体（汉仪文黑等）**不随本仓库分发**：攻略页运行时引用 miao-plugin 的字体资源，
  帮助页在缺少字体时回落系统字体；`.gitignore` 排除 `*.ttf` / `*.otf`。
- **例外**：`resources/common/font/` 下的 `HYWH-65W.woff`、`tttgbnumber.ttf`、`tttgbnumber.woff`
  随 `Mhydps-Plugin` 迁入（榜单 / 危战 / 状态页的 `@font-face` 依赖它们），故对 `*.ttf` 加了
  `!resources/common/font/*.ttf` 例外。若上游对这些字体文件有异议，删除后页面会回落系统字体，功能不受影响。

---

## 与其他文档的关系

- **现行设计文档**（工作区外）：`D:\Downloads\设计草案-Meta-Plugin-v3（角色方案中心·待与阿修确认）.md`
  —— v3 的四个入口、评分体系与 P1–P5 分期。
- **v2 设计文档**（工作区外）：`D:\Downloads\设计草案-新插件（待与阿修确认）.md`，§6 / §8 记录了
  「攻略页与 miao 图鉴一致」这一决策及其许可约束。
- v2 的交接文档（`D:\Downloads\Meta-Plugin-交接文档.md`）在 v2 收尾后按约定删除；其中的口径已并入
  本文件、`README.md` 与上面两份设计文档。
