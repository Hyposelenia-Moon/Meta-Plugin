# 交接文档

> 写于 2026-10-12。本文件是**未入库的会话交接件**（工作区根目录），如需入库/忽略请自行决定。

## 目标

把数据仓库 `Character-Codex-Data`（**已改名为 `Meta-Plugin`**）改造成承接「原神攻略」并**合并 Mhydps-Plugin**（榜单 / 危战 / 练度）的独立 Yunzai 插件；结构为 TS（`src/` → 编译产物 `lib/`，`lib/` 入库）；当前处于**阶段 0（骨架）**。

设计文档（**权威副本，绝对路径**）：`D:\Downloads\设计草案-新插件（待与阿修确认）.md`（v2.5，含 §13 决策记录、§14 可执行实施方案）。

## 已完成

- **仓库改名**：本地 `D:\文件\游戏\原神\Meta-Plugin` ⇄ 远端 `https://github.com/Hyposelenia-Moon/Meta-Plugin.git`（git 工作树干净，HEAD `25efe9b`）。
- **设计定稿**：三方向（解耦 / 合并 Mhydps / 帮助重写）+ 结构选型（TS `src`→`lib`）+ 抢占方案（`priority: -100000`）+ 命令清单；全部决策见设计文档 §13，落地步骤见 §14。
- **阶段 0 第一批骨架**（均已构建 + 自检通过）：
  - `D:\文件\游戏\原神\Meta-Plugin\package.json`（name `meta-plugin`、`type: module`、scripts `build`/`check`/`test`、deps `yaml`、devDeps `typescript`+`@types/node`）
  - `D:\文件\游戏\原神\Meta-Plugin\tsconfig.json`（`strict`、`rootDir: src`、`outDir: lib`、`include` 只含 `src/**/*.ts`）
  - `D:\文件\游戏\原神\Meta-Plugin\index.js`（Yunzai 入口薄壳 → `import('./lib/index.js')` 并 `export { apps }`）
  - `src\dir.ts`（路径常量唯一出处：`pluginRoot`/`libDir`/`dataDir`/`resourcesDir`/`configDir`/`botRoot`）
  - `src\index.ts`（配置初始化 → 启动编排 → `readdir(lib/apps)` 动态加载 → 收集导出类 → `export { apps }`）
  - `src\model\startup.ts`（启动编排空壳，阶段 1 接 `CodexStore`）
  - `src\components\config.ts`（`defaultConfig` + 深合并 + `META_CONFIG_FILE` 覆盖；`networkEnabled` 默认 **false**）
  - `src\types\yunzai.d.ts`（`logger` / 事件对象最小全局声明）
  - `test\_helper.mjs`、`test\run.mjs`、`test\skeleton.test.mjs`（29/29）、`test\lib-fresh.test.mjs`（编译产物新鲜度门禁）
  - `.gitignore` 增补：`config/config.yaml`（example 入库）、`test/.test-tmp/`、`pnpm-lock.yaml`；并注明 **`lib/` 必须入库、不要忽略**
- **验证**：`pnpm install`（yaml 2.9.1 / typescript 5.9.3 / @types/node 22.20.5）→ `pnpm build` 产出 `lib/{dir,index,components/config,model/startup}.js(+map)` → `pnpm check` 退出 0 → `pnpm test` **2/2 套件通过**。

## 未完成 / 下一步

1. **阶段 0 第二批**（可直接开工）：
   - `src/components/render.ts`（照 `Mhydps-Plugin\components\render.js` 的 `puppeteer.screenshot` 用法；**先验证 T1**：框架模块要从 `lib/` 起算写四层 `../`，即 `../../../../lib/puppeteer/puppeteer.js`）
   - `src/apps/help.ts`（最小可用 `#攻略帮助`）+ `resources/codex/help.html` + `resources/help/help-cfg.js`
   - 配置三层：`config/config.yaml.example`、`defSet/config.yaml`（`${meta_*}` 占位符）、`guoba/index.js` + `guoba.support.js`
   - 真机验证：`D:\Program Files\Yunzai\Yunzai` 里 `#更新 Meta-Plugin` 或本地 link，发 `#攻略帮助` 看是否出图
2. **阶段 1–6**：逐文件方案见设计文档 §14.3–§14.7（数据层与渲染 → 资源层 → 命令与抢占 → Mhydps 合并 → 帮助/状态页 → 与 Atlas 收尾）。
3. **落实「不再随 `#图鉴更新`」**：确认 bot 侧目录名 = `Meta-Plugin`（框架按目录名寻址）；请阿修在 Atlas 侧删除 `CODEX_DIR` / `CODEX_REPO_URL` / `syncCodexRepo()`（设计文档 §10 第 6 项）。

## 关键决策与理由

- **TS 结构 `src/` → `lib/`，`lib/` 入库** — bot 侧只允许 `git pull`/`#更新`，`lib/` 不入库就跑不起来；改为双分支（`dev` 写 TS / `main` 只发产物，参考 `ZZZure/ZZZ-Plugin`）被否决：本仓库还背着 `data/` 与维护者流水线，双分支会让数据更新与插件发布长期打架。
- **攻略命令用抢占式接管**（不是兼容） — 实际占用者：`plugins/genshin`「米游社攻略」`priority: 50`（`^#?(更新)?\S+攻略([1-7])?$`、`^#?攻略(说明|帮助)?$`、`^#?设置默认攻略([1-7])?$`）与 `Atlas-Plugin` 快捷入口 `priority: -99999`。本插件取 **`-100000`**（方案 A，Atlas 零改动），`accept()` **只对攻略类后缀**返回 true。
- **接管 `#攻略` / `#攻略帮助` / `#攻略说明`**；**`#设置默认攻略N` 不接管**，正则须带负向断言 `(?!.*设置默认攻略)`，否则会被 `\S+攻略` 吞掉。
- **`#〈角色〉攻略2..7`** 忽略数字，页面注明「仅一套」。
- **miao-plugin = 必要资源依赖**（图片/别名），**不改其上游**（仅重大缺陷提 PR 且须阿修同意）；**Atlas-Plugin = 可选补充**，缺失必须降级不报错。
- **联网部分默认关闭**（`networkEnabled: false`）；配置变量前缀统一 `${meta_*}`（旧 Mhydps 键对照见设计文档 §14.8）。
- **抢占 app 的 `priority: -100000` 不可配置化**（配置化会让用户一改就失效）。
- **更新方式改为框架自带 `#更新Meta-Plugin`（简写 `#更新Meta`）**，**不再随 Atlas 的 `#图鉴更新` 一起更新**（用户 2026-10-12 定）。机制已核实：`<bot>\plugins\other\update.js:124` 的 `getPlugin()` 把输入依次试 `<输入>` / `<输入>-Plugin` / `<输入>-plugin`，所以 `#更新Meta` 能命中 `plugins/Meta-Plugin`；该 handler `priority: -Infinity`、规则 `^#(安?静)?(强制)?更新`（无尾锚点）→ **不要自己注册 `#更新…` 规则**（抢不到也不该抢）。落地要求：① bot 侧目录名必须是 `Meta-Plugin` 且是 git 仓库 ② 运行时依赖写在 `dependencies`（框架检测到 `package.json` 变化后会跑 `pnpm install`）③ 帮助页/文档统一写全名（Linux 上目录名大小写敏感）。Atlas 侧需删 `CODEX_DIR` / `CODEX_REPO_URL` / `syncCodexRepo()`（设计文档 §10 第 6 项）。
- **实际更新请用强制形式：`#强制更新Meta-Plugin`（简写 `#强制更新Meta`）** —— 部署副本里一旦有本地改动，普通 `#更新` 会被 git 拒绝（`error: Your local changes to the following files would be overwritten by merge`），这是**已经踩过的坑**。框架强制路径 = `git reset --hard <远端分支> && git pull --rebase`，只影响 tracked 文件；未跟踪的 `config/config.yaml`、`node_modules/`、`out/` 会保留。
- **配套硬规则：运行时刻只写未跟踪目录** —— `out/`（缓存）与 `config/`（配置）可写；`data/`、`lib/`、`resources/`、`scripts/` **只读**（都是 tracked）。写 tracked 文件既会让 bot 侧 `#更新` 被 git 拒绝，又会被 `#强制更新` 的 `reset --hard` 抹掉。`data/` 只由维护者流水线改。

## 阻塞 / 待外部输入

- **待阿修**（设计文档 §10）：① 四项稳定导出的形式（别名解析 / 图标路径 / 实体信息 / codex 旧资产**是否移交**）② 显示层镜像是否退役 ③ 他剥离 codex 的版本/时间点 ④ 他那边文案改指向 Meta-Plugin ⑤ 接管 `#攻略帮助` 是否需知会 genshin 插件方。
- **待用户**：攻略页版式细节（插画底 + 内容条）需一张参考截图（设计文档 §13.1 B8）。

## 环境事实

- 工作区（重启后）：`D:\文件\游戏\原神\Meta-Plugin`；旧路径 `…\Character-Codex-Data` 已不存在。
- bot 安装：`D:\Program Files\Yunzai\Yunzai`（`plugins\` 下有 `Atlas-Plugin`（HEAD `7d8af0d`）、`Mhydps-Plugin`（HEAD `cd23389`）、`miao-plugin`（HEAD `afe98d50`，**只在 bot 侧**））。
- 框架文件（已核实存在）：`<bot>\lib\plugins\plugin.js`、`<bot>\lib\puppeteer\puppeteer.js`、`<bot>\lib\common\common.js`。
- 工具链：node `v24.21.0`；pnpm `D:\npm-global\pnpm.ps1`（v12.8.1）；`typescript` 只装在本插件 `node_modules`（bot 根与 Mhydps 里都没有）。
- 部署链路：bot 侧副本只接受 `git pull`/`#更新`，**禁止**从工作区拷文件（`Mhydps-Plugin\AGENTS.md` 第六节）。
- 框架更新指令：`D:\Program Files\Yunzai\Yunzai\plugins\other\update.js`（`priority: -Infinity`；规则 `^#(安?静)?(强制)?更新`；`getPlugin()` 试 `X`/`X-Plugin`/`X-plugin`；`package.json` 变化后自动 `pnpm install`）。
- 设计文档权威副本：`D:\Downloads\设计草案-新插件（待与阿修确认）.md`。
- 凭据：本任务不涉及。

## 踩过的坑

- **会话工作区根失效**：目录改名后，本会话 cwd 指向旧路径 → `pwsh` 必须显式带 `workdir` 参数才能启动；`grep`（ripgrep provider）直接失败 → 改用 `Select-String`；文件 `read`/`write`/`edit` 用绝对路径仍可用。**重启会话并把工作区指向新目录**即可根治。
- **块注释里写 `src/**/*.ts` 会炸**：其中的 `*/` 会提前闭合注释 → `SyntaxError: Unexpected token '*'`（`test/lib-fresh.test.mjs` 踩过一次，已修）。写路径通配时要避开这个序列。
- **框架 import 深度**（T1，尚未在运行中验证）：JS 插件写 `../../../lib/…`（从 `components/` 三层到 bot 根）；编译产物在 `lib/` 下**多一层**，必须写 `../../../../lib/…`。tsc **不重写** import 路径。
- **tsc 解析不到框架文件**（T2）：`lib/plugins/plugin.js` 在项目外 → 用 `// @ts-expect-error 框架文件不在 tsc 解析范围，运行时相对 lib/ 解析` + 正确相对路径（备用方案：`src/framework.ts` 动态定位 bot 根）。
- **早前的错误结论**：曾判断"本机没有 bot"——实际 `D:\Program Files\Yunzai\Yunzai` 装着，当时的全盘搜索被 `Program Files` 的权限枚举失败静默跳过（`-ErrorAction SilentlyContinue` 掩盖了）。
- **别用 junction/手拷同步 bot 副本**：会在部署副本里制造本地改动，之后 `git pull` 会被 `local changes would be overwritten` 顶掉（Mhydps AGENTS 明确禁止）。**补救=发 `#强制更新Meta-Plugin`（简写 `#强制更新Meta`）**；根治=运行时绝不写 tracked 文件（见上「关键决策」的配套硬规则）。
- **Workspace 内的 `config/` 曾整目录被 gitignore**：已改成只忽略 `config/config.yaml`，`config.yaml.example` 必须入库。
