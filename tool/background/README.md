# tool/background — 背景图生成与对比度审计

4 个页面各有一张**整页插画底**（`background-size: cover`），CSS 里的链路是：

```
插画（原图强度，不抬暗部）→ --scrim 整体压暗 → 文字一律落在 --card 深色内容条上
```

**为什么不让文字直接压插画**：4 张底图的最亮局部亮度都在 254~255（画面里有接近纯白的高光，最暗处则低到 3）。浅色文字压在这类亮部上时，`--muted`（相对亮度 0.44）只有约 **2.1:1**，远低于 AA。加一层 `--card`（`rgba(10,12,20,0.72)`）后，等效底色稳定在 `#2b3037` 附近，**与插画实际内容无关**，因此插画可以保持鲜艳、文字照样达 AA（实测 4 页 0 失败，见下）。

推论：**直接落在插画上的容器必须自己垫 `--card`**（`.body-card` 内的容器才算有垫底）。`.empty-hint` 曾漏垫底（最坏只有 1.4:1），`test/contrast.test.mjs` 现在对这类容器有专门的守门条目。**练度面板不在这批页面里**：它整页交给 miao-plugin 渲染（版式与字号都归 miao），所以没有对应的 `bg-*.jpg`。

两个脚本都用 .NET `System.Drawing`，无需额外依赖，Windows PowerShell 5.1 可直接跑。**脚本一律纯 ASCII**：PS 5.1 按 ANSI 读 `.ps1`，脚本内写中文会解析失败；中文素材路径请作为**参数**传（或把脚本放在插件根目录、用相对路径调用）。

## 1. 生成背景图：`crop-background.ps1`

```powershell
# 按「实际出图长宽比」裁窗口；-ShadowLift 默认 0（深色主题保持插画原亮度，不用抬暗部）
powershell -NoProfile -ExecutionPolicy Bypass -File tool\background\crop-background.ps1 `
  -Src "D:\...\哥伦比娅3.jpeg" -Out "resources\common\bg-rank.jpg" `
  -Aspect 0.73 -Y 1600 -OutWidth 1200 -Quality 80
```

- `-Aspect` 传「宽 / 高」，即目标页面的**出图宽高比**；窗口高度 = `图宽 / Aspect`
- `-Y` 指定窗口顶部（`-1` 自动挑「页头上部最亮」的窗口）；取景要让角色头部落在上部，因为顶部是页头文字区
- `-ShadowLift L`（0~0.8，默认 0）曲线 `out = 255 × (L + (1-L) × (in/255)^0.9)`：只抬暗部、亮部保持 255。**深色主题不需要它**——它当初是给「浅色文字直接压插画」那一版用的；调大后插画会发灰、暗部失去层次
- 输出为 JPEG（`-Quality` 默认 80）；同目录 `bg-*.jpg` 都是 1200 宽一档，体积 110~240 KB

当前素材与参数（换底图时按此表重跑，再跑第 2 步复核）：

| 文件 | 素材 | 窗口 | 出图 |
|------|------|------|------|
| `bg-rank.jpg` | `纯享壁纸\哥伦比娅3.jpeg`（1500×9000 长图） | y=1600 起、Aspect 0.73 | 1200×1644 |
| `bg-raid.jpg` | `哥伦比娅3.jpeg` | y=6300 起、Aspect 1.20 | 1200×1000 |
| `bg-help.jpg` | `纯享壁纸\哥伦比娅4.png`（1080×1920） | y=0 起、Aspect 1.20 | 1080×900 |
| `bg-status.jpg` | `哥伦比娅4.png` | y=820 起、Aspect 1.09 | 1079×990 |

素材不入库（体积大、来源为个人壁纸），仓库里只留裁好的 `bg-*.jpg`。

## 2. 对比度审计：`fullpage-contrast.ps1`

```powershell
# 在插件根目录执行；参数可省（默认读 resources\common\base.css 与 resources\common\bg-*.jpg）
powershell -NoProfile -ExecutionPolicy Bypass -File tool\background\fullpage-contrast.ps1
```

- **令牌直接读 `base.css`**（`--scrim` / `--card` / `--chip` / `--card-2` + 各文字色），不在此重复维护色值
- 按 CSS 同样的顺序做 sRGB 叠加：插画 → `--scrim` → `--card` →（`--chip` 或 `--card-2`）
- 4 张图各降采样到 1/28 再取像素（≈ 重度模糊后的局部均值），取**最亮**像素作为浅色文字的最坏底
- 判定同 WCAG 2.1：正文 ≥4.5:1、大字（≥24px 或 ≥18.66px 粗）≥3:1
- 最近一次结果：rank / raid / help / status **各 0/14 失败**（最坏项 `muted on inner`，status 页 4.95:1）

## 3. 离线守门：`test/contrast.test.mjs`

改配色不必跑上面的脚本：该套件从 `base.css` 现算令牌对比度（最坏情况按**纯白插画**推，比真实底图更严）+ 全项目最小字号（≥14px），随 `pnpm test` 一起跑。只有**换底图或改动 `--scrim` / `--card` 之外的东西**（如新增文字色）时才需要跑第 2 步复核真实底图。

## 令牌现状（与版式相关）

| 令牌 / 规则 | 值 | 作用 |
|------|----|------|
| `--bg` | `#101219` | 插画之下的兜底底色 |
| `--scrim` | `rgba(8,10,18,0.46)` | 整页插画压暗；调低插画更亮、等效底色变亮 |
| `--bg-blur` | `0px` | 插画模糊；内容条已解决可读性，默认不模糊 |
| `--card` | `rgba(10,12,20,0.72)` | 内容条底色，所有文字的对比基准 |
| `--chip` | `rgba(0,0,0,0.34)` | 彩色标签底，比内容条更暗一档 |
| `--radius` | `12px` | 卡片圆角 |
| `body` / `.page-inner` padding | `8px 10px 10px` | 插画四周留边（＝出图可见的画面边框），已收紧到 8~10px 以给内容更多空间 |
