# Meta-Plugin — 维护者指令

TRSS-Yunzai v3 插件：**原神攻略 · 强度榜单 · 练度查询**。
原数据仓库 `Character-Codex-Data`；2026-10 改造为独立插件，并整体并入 `Mhydps-Plugin`（后者已废弃）。

本文件与 `docs/`（除 `docs/private/`）**入库**、与代码一同评审；盘符、部署机与本机工作区在 `docs/private/`（**不入库，新克隆上不存在**）。

## 项目概况

- **入口**：`index.js` → `lib/index.js`；框架实际加载 `lib/`（**`lib/` 入库**，因 bot 侧只允许 `git pull`）。
- **源码**：`src/` → `tsc` → `lib/`（目录结构一致）。
- **分层**：`src/apps/`（命令薄壳）→ `src/modules/`（业务与查询）→ `src/model/`（外部适配：miao / mhydps / akasha / 本仓库商店 / Atlas 探测）→ `src/components/`（纯函数与常量，零 I/O，套件直接 import 编译产物）。
- **维护者区**（ESM JS，不参与编译）：`data/`（攻略数据本体 + `_index.json` / `_order.json`）、`scripts/`（Word→JSON→页面流水线、编辑器服务、自检）、`templates/`、`resources/`（页面模板、编辑器前端、字体、背景图）、`tool/`（背景图裁剪与对比度脚本）。
- **常用命令**：`pnpm build`、`pnpm test`（55 套）、`pnpm check`。
- **数据准备**：主文档 → `node scripts/parse-docx.mjs`；索引 `node scripts/build-index.mjs`；页面 `build-html.mjs` / `build-doc.mjs`。

### 快速参考

| 功能 | 入口（priority） | 触发 | 说明 |
|---|---|---|---|
| 角色攻略 | `Meta攻略`（**-100000**，写死） | `#胡桃攻略` / `#胡桃攻略2` / `#胡桃指南` | 后缀式；早于 Atlas 快捷入口(-99999) 与 genshin 米游社攻略(50) |
| 帮助（两小一大） | `Meta攻略帮助`（-100000） | `#meta`（总）/ `#攻略帮助`（=`#攻略`/`#攻略说明`）/ `#DPS帮助` | 三条规则同一 handler；图失败回落同源文本 |
| DPS 榜 | `MetaDPS榜`（8000+0） | `#DPS榜 [角色] [金数] [标签] [主C] [绿玩] [页N]` | 兼容别名 |
| 角色档位 | `Meta角色DPS档位`（8000-5） | `#胡桃dps [金数]` | v3 入口 |
| 危战榜 | `Meta危战榜`（8000-20） | `#DPS危战榜 [版本] [首领] [角色] [金数] [页N]` | |
| 危战档位 | `Meta危战档位`（8000-5） | `#危战 [版本/首领/角色]` | v3；n6 / n7 两档 |
| 练度查询 | `Meta练度查询`（8000-50） | `#DPS练度查询 [角色] [UID]` | 阿卡莎名次面板 |
| 练度提升指南 | `Meta练度提升指南`（8000-5） | `#练度查询 胡桃` | v3；攻略目标 × 当前配装（**不带 UID**） |
| 队伍伤害 | `Meta队伍伤害`（8000-5） | `#队伍伤害 A B C D [轴:] [词条:]` | v3；要求四个角色名 |
| 榜上配装 | `Meta榜上配装`（8000-5） | `#配装 胡桃 [名次]` | v3；需浏览器会话与代理 |
| 视频 | `Meta视频查询`（8000-100） | `#DPS视频 <名次>` / `#DPS危战视频 <名次>` | |
| 状态 | `Meta状态`（8000-10） | `#DPS状态` | |
| 数据管理 | `Meta数据管理`（8000-10，master） | `#DPS更新` / `#DPS强制更新` / `#DPS刷新` | 仅主人 |

> `#DPS…` 与 v3 新入口的 priority = `config.priority`（默认 8000）+ 各命令偏移；偏移与文案的唯一来源是 `src/components/constants.ts`。

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
| 图形化编辑器、保存即发布 | [docs/脚本-编辑器与发布.md](./docs/脚本-编辑器与发布.md) |
| 解析告警（防呆，不静默） | [docs/脚本-解析告警.md](./docs/脚本-解析告警.md) |
| 测试命令、前置与跳过 | [docs/测试.md](./docs/测试.md) |
| 许可、字体、版权声明、数据来源 | [docs/许可与来源.md](./docs/许可与来源.md) |
| 待办与规划（含 Atlas 导出清单） | [docs/待办与规划.md](./docs/待办与规划.md) |
| 盘符映射、部署机、本机工作区 | `docs/private/`（**不入库，新克隆上不存在**） |

## 约定

1. **文档入库范围** — 本文件与 `docs/`（除 `docs/private/`）**入库**，与代码一同评审提交；`docs/private/` 放盘符、部署机与本机工作区，**不入库**，因此入库文档只写占位（`<插件根>` / `<bot根>` / `<主文档>`）且**不得依赖**它（新克隆上没有）；`CLAUDE.md`、`.claude/` 与本地工作区目录**仍忽略**（用途见 `docs/private/本机工作区.md`）。
2. **文档必须同步** — 功能 / 命令 / 配置变更时同批更新：`docs/` 对应册、`README.md`（面向使用者）、本文件（快速参考）、`src/components/constants.ts`（命令文案）、帮助页配置、`docs/测试.md` 的套件数。
3. **一轮一份提交摘要，只写代码侧改动** — 文档与配置更新单列一行说明；会话内不执行任何 git 写操作（提交由维护者手动做）。
4. **中文、可复现** — 文档用简体中文，命令与字段名保持原文；不写"见本机某脚本"这类新克隆上无法复现的引用（只允许存在性提示）。

## 硬约束速查（改前必读；细节见各册）

1. **抢占优先级写死** — 攻略类走 `PREEMPT_PRIORITY = -100000`，**不做成配置项**；`accept()` 只认领 `攻略` / `攻略帮助` / `攻略说明`（+ `#meta`），其余一律放行，保证 Atlas 图鉴行为逐字不变。子项：**`#设置默认攻略N` 不接管**，`CODEX_SUFFIX_RULE` 的负向断言 `(?!.*设置默认攻略)` 必须保留，否则会吞掉 genshin 的设置命令。
2. **攻略入口只留后缀式** — `#<角色>攻略`；`#攻略 <角色>`、`#攻略 <角色> <模块>`、`#攻略 <武器> <名>` 已按要求移除，**不得加回**。
3. **合并前常量值冻结** — `DPS_RULES` 等值与 `Mhydps-Plugin` 合并前**逐字一致**（`test/constants-parity.test.mjs` 快照守着）；v3 新入口用 `ENTRY_RULES` 分开维护，不要混进去。
4. **`lib/` 入库** — 改 `src/` 后必须 `pnpm build` 并一并提交 `lib/`（`test/lib-fresh.test.mjs` 按 mtime 判断"lib 是否落后于 src"）。
5. **运行时只写 `out/` 与 `config/`** — 绝不写 `data/`、`lib/`、`resources/`、`scripts/`、`tool/`（写了会挡住 bot 侧的 `#更新`）。
6. **测试不得写 `data/`** — 路径一律走 `test/.test-tmp/` 自建子目录或环境变量覆盖（`META_CONFIG_FILE` / `META_MIAO_DIR` / `META_ATLAS_DIR`）。
7. **miao 必需、Atlas 可选** — 缺 miao 给可读提示；Atlas 缺失或异常**只降级不报错**，且**不 import 它的内部模块**（走稳定导出，见 [docs/待办与规划.md](./docs/待办与规划.md)）。
   读面板必须走 miao 的对象契约：`Avatar.artis` 是 **`Artis` 实例**（`getArtisDetail()` 按部位 1..5、`artis.sets` 给件数、`artis.hasAttr` 判词条、`getArtisMark()` 给评分），**不要 `Array.isArray`、不要用 `names` 计件**；刷新成功只看**目标角色**（别拿账号级 `player.hasProfile` 当成功）。
8. **联网默认关** — 仓库侧 `networkEnabled` 默认 `false`，**所有**远程刷新点（mhydps / akasha / miao 面板 / 队伍）都要先读开关；榜单 / 危战 / 练度需代理（国内直连 `mhydps.cn` 会在 TLS 握手阶段失败）；米游社 ck 由 miao 保存，本插件不保存任何凭据。
9. **锅巴模板替换必须用回调** — `template.replace(re, () => String(value))`：直接传字符串会把值里的 `$&` / `$1` 当替换语法（`src/guoba/index.ts`）。
10. **编辑器静默陷阱** — 事件委托必须 `closest('[data-act]')` 往上找（行尾图标是内联 SVG，`e.target` 常是 `<path>`）；保存失败（`res` 为 `null`）时**先返回**，否则会清掉未落盘草稿；`git diff --cached` 必须带 `-z`（默认 `quotePath` 会把中文路径转义，逐行比较会把自己人判成"范围外"而阻止提交）；改过共享层**必须重启编辑器进程**（长驻进程会缓存旧模块）。
11. **框架截图契约** — `runtime.render(plugin, path, data, cfg)` 的 `retType` 属于**第 4 参**；本版 `puppeteer.screenshot` 返回**图片消息段**（不是 base64），拿到段要直接 `e.reply` 发送；只有当框架已经自己发图（返回 `true`）或我们确实拿到图时才 `return true`，否则一律 `false` 交同源文本回退。

## 测试

```bash
pnpm build && pnpm test     # 55 套；任意 cwd 可跑、不发真实网络、缺前置自动跳过
```

- 缺 bot / miao 时渲染类套件自动跳过；设 `META_MIAO_DIR` / `META_ATLAS_DIR` 指向真实资源可启用更严断言。
- 冻结门禁：`mhydps-parity`（与合并前逐字等价）、`constants-parity`（常量快照）、`codex-parity`（131/131 逐字段）。
- **行为级契约套件**（用假对象/真实构建器驱动编译产物，不查源码正则）：
  `miao-artis-contract`（`Artis` 实例形状、`sets` 件数）、`grade-guide-targets`（`kind` 分桶、组合候选、建议口径）、
  `render-fallback`（`retType` 第 4 参、图片消息段返回、失败一律回退）。
- 维护者区自检（不在 `pnpm test` 内）：`node scripts/editor-selftest.mjs`（241/241）、`display-selftest.mjs`、`display-audit.mjs`、`audit-guide-html.mjs`。
- 细节与固定验收集见 [docs/测试.md](./docs/测试.md) 与 [docs/改动传播清单.md](./docs/改动传播清单.md)。

## 待办（摘要）

1. **miao 面板取数通道**：已按 2026-10-15 外部复核落实（`Artis` 对象契约、目标级完整性、`kind` 分桶、`networkEnabled` 闸门、`render` 第 4 参、编辑器草稿与中文路径、`akashaProxy`、`notes` 合并、比较表与建议口径）——**待真机复测** `#练度查询 哥伦比娅`（能否真出圣遗物主词条与评分）。
2. **复核报告 C 批（工程债）未做**：`lib-fresh` 改内容门禁、`accept()` 对已移除前缀的认领清理、状态页明示联网/代理口径、迁移等价措辞修正。
3. **Atlas 四项稳定导出**待作者落地：别名解析 / 图标路径 / 实体信息 / codex 旧资产移交（适配层已预留 `icon()` / `entityOf()`）。
4. **Atlas 侧移除 `syncCodexRepo()`**：旧仓库改名后 bot 日志里仍在 502。
5. **`Mhydps-Plugin` 远端仓库**是否 Archive / 删除待确认（本地两处副本已清空）。
6. 真机验证补跑：`#胡桃攻略`（图 / 文本回退）、编辑器四项（重命名 / 同秒连续替换撤销 / 同名删除 / 他人暂存提交）。

细节见 [docs/待办与规划.md](./docs/待办与规划.md)。
