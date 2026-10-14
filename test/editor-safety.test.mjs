/**
 * 编辑器数据保全四项（2026-10-15 审核 P2 #3/#4/#5/#6）
 *
 * 这四项分别在 `resources/editor/app.js`（浏览器端）与 `scripts/editor.mjs`（HTTP 脚本）里，
 * 开发工作区无法直接 import（前者是浏览器脚本、后者带 HTTP 服务与入口守卫），
 * 因此这里做**源码级断言**（锁住修复不被回退），行为侧由 `scripts/editor-selftest.mjs` 与真机流程覆盖。
 */
import path from 'node:path'
import { createChecks, pluginRoot, readText } from './_helper.mjs'

const { ok, push, report } = createChecks('编辑器数据保全（审核 #3/#4/#5/#6）')

const editor = readText(path.join(pluginRoot, 'scripts', 'editor.mjs'))
const app = readText(path.join(pluginRoot, 'resources', 'editor', 'app.js'))

// ---------- #4 同秒批量替换不再覆盖备份 ----------
ok('#4 备份目录独占创建（mkdirSync 不带 recursive）', /fs\.mkdirSync\(dir\)\s*\/\/ 不带 recursive/.test(editor) || /try \{\s*\n\s*fs\.mkdirSync\(dir\)/.test(editor))
ok('#4 撞名加 -2/-3 后缀而非覆盖', /name = `\$\{stamp\}-\$\{i\}`/.test(editor))
ok('#4 通过 EEXIST 判定冲突（其它错误照抛）', /err\?\.code !== 'EEXIST'/.test(editor))
ok('#4 备份函数返回真实目录名', /return \{ dir, name \}/.test(editor))
ok('#4 响应/撤销用真实 stamp（不再用请求时的时间戳）', /const backupName = backup\.name/.test(editor) && /return \{ stamp: backupName,/.test(editor) && /stamp: backupName, createdAt/.test(editor))
ok('#4 撤销接口用 findStampDir 校验（允许 -N 后缀）', /findStampDir\(stamp\)/.test(editor) && /\(-\\d\+\)\?/.test(editor))

// ---------- #5 回收站不再覆盖历史版本 ----------
ok('#5 删除前检查回收站是否已有同名版本', /const trashedFile = path\.join\(trashDir, `\$\{name\}\.json`\)/.test(editor) && /if \(fs\.existsSync\(trashedFile\)\)/.test(editor))
ok('#5 已有版本时明确拒绝（409 + 可读提示）', /sendError\(res, 409, `回收站里已有/.test(editor))
ok('#5 通过后才 rename 且响应复用同一路径', /fs\.renameSync\(file, trashedFile\)/.test(editor) && /trashed: path\.relative\(root, trashedFile\)/.test(editor))

// ---------- #6 指定路径提交不得混入范围外暂存 ----------
ok('#6 提交前读取暂存清单', /const staged = await gitRun\(\['diff', '--cached', '--name-only'\]\)/.test(editor))
ok('#6 计算范围外暂存并阻止提交', /const foreign = stagedPaths\.filter/.test(editor) && /暂存区里有本次范围外的文件/.test(editor) && /executed: false/.test(editor))
ok('#6 阻止时不提交、不改动暂存状态（不调用 reset）', !/gitRun\(\['reset'/.test(editor.slice(editor.indexOf('const foreign')) || ''))

// ---------- #3 重命名不再丢草稿 ----------
ok('#3 重命名前先保存草稿', /return Promise\.resolve\(dirtyCount\(\) > 0 \? save\(\) : true\)\.then\(function \(\) \{/.test(app))
ok('#3 保存后仍有改动则中止', /if \(dirtyCount\(\) > 0\) \{\s*\n\s*showStatus\('有改动未保存成功，已取消重命名'/.test(app))
ok('#3 中止后不打开目标角色', /if \(!res\) return\s+\/\/ 上面因保存失败中止/.test(app))
ok('#3 仍作废旧名字的 pending（避免幽灵角色）', /delete state\.pending\[from\]/.test(app) && /delete state\.pending\[to\]/.test(app))

const bad = report()
process.exit(bad ? 1 : 0)