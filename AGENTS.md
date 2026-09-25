# AGENTS.md

> 给 AI agent / 协作者的工作守则。**先读这页，再动手改东西。**

## 1. 这个项目是什么

拾光 Lumina — Windows 11 风格的图片与视频查看器，单仓库双形态：

- **网页版**：纯前端 React，跑在浏览器里
- **桌面版**：Tauri 2 + WebView2，单文件 `.exe`（约 6 MB，便携，免安装）

技术栈：React 19 · Vite 8 · TypeScript 7 · Tauri 2 · Rust · Zustand · Tailwind 4 · Bun 1.4。

## 2. 运行时与包管理器

**只用 Bun**（1.4+，Rust 重写版）。

- `bun install` / `bun run dev` / `bun run build` / `bun run tauri dev` / `bun run tauri build`
- 锁文件是 `bun.lock`，**不要**生成 / 提交 `package-lock.json`
- 全局 npm 缓存可清，但本仓库一旦切走就回不去了；不要主动 `npm install`
- Node 24 仍可用，但只在 CI 缺失 Bun 时才允许降级

如果看到 `npm install` 输出，立即停掉并改回 bun。

## 3. `src-tauri/target` —— 绝对不能动

这是 **mbx 缓存 symlink**（mode `120000`，内容指向 `D:/mbx/targets/v1/<hash>`，
hash 来自 `Cargo.lock`）。它让 cargo 编译在不同项目间共享增量缓存。

**禁止**：

- ❌ `rm -rf src-tauri/target` / `rmdir /s /q src-tauri/target` —— 会破坏缓存
- ❌ `mkdir src-tauri/target` —— 会把 symlink 变成空目录
- ❌ `git rm src-tauri/target` / `git update-index --remove` —— 会从仓库里删掉
- ❌ 在 `.gitignore` 里写错规则导致 symlink 被解引用为普通目录
- ❌ 修改 Cargo.lock 后忘记重建 symlink（mbx 会按新 hash 自动建，但 symlink 仍要保留）

**允许 / 已知状态与恢复**：

本机 `core.symlinks=false`（`git config core.symlinks` 查看），所以工作树里的形态
和 git 索引里的形态**天然不一致**，这是正常状态：

| 位置 | 形态 | 说明 |
| --- | --- | --- |
| git 索引 / HEAD | `120000` symlink → `D:/mbx/targets/v1/<hash>` | 唯一正确的入库形态 |
| 工作树（clone 出来） | 82 字节普通文件，内容是路径 | git 的占位形式；**会挡构建** |
| 工作树（构建可用态） | 真实目录 | mbx 报 `not a directory` 时就切到这个 |

**故障恢复（按实际验证过的步骤）**：

1. **mbx 报 `could not inspect Cargo target directory ...: not a directory`**
   （工作树是占位文件）→ 删掉占位文件、`mkdir src-tauri\target`、重跑
   `bun run tauri build`。本机创建真 symlink 需要管理员权限，所以用真实目录；
   mbx 通过 shims 缓存编译，目录形态不影响命中（构建日志 `mbx[...hits]` 可验证）。
2. **`git status` 出现 ` D src-tauri/target`**（真实目录 vs 索引 symlink 条目）
   → 这是上面说的形态差异，**不是误删**。绝不要 `git add` / `git rm` 这个路径。
   要让 status 干净：`git update-index --skip-worktree src-tauri/target`
   （只影响本机，不入库）。若索引条目真的丢了，从 `git cat-file -p HEAD:src-tauri/target`
   取 blob hash 后 `git update-index --add --cacheinfo 120000,<hash>,src-tauri/target` 加回。
3. **索引 symlink 条目丢失**（`git ls-files -s src-tauri/target` 无输出）
   → 用上面的 `cacheinfo` 加回，hash 也可靠 `git ls-tree origin/main src-tauri/target` 取。

**怎么判断自己没破坏它**：

```bash
git ls-tree HEAD src-tauri/target
# 应该输出: 120000 blob <hash>  src-tauri/target

git ls-files -s src-tauri/target
# 索引里必须是 120000；工作树是普通文件或目录都算正常（见上表）
```

如果索引里变成了 `100644` 或干脆没了，立刻按第 3 条恢复。

## 4. 提交与推送

- **本地分支**：`main`
- **远端**：`git@github.com:GeneYu404/lumina.git`（已配 origin）
- **身份**：用 gh CLI 登录的账号 `GeneYu404`；不要写死别的 user.name / email
- **commit 信息**：英文或中文都行，格式 `<scope>: <一句话>`（例：`fix:`, `feat:`, `docs:`, `chore:`）
- **force push**：默认禁止。只有当用户明确说"覆盖远端 / 强制推送"时才允许，且必须用 `--force-with-lease`（不是 `--force`）
- **绝不要** force-push 别人的 commit / 删别人的分支
- **冲突解决**：本地和远端无共同祖先时（init 完第一次 push），用 `git push --force-with-lease origin main`，不要拉 rebase（会产生几十个 add/add 冲突）

## 5. 文件与目录

- **删除前先问用户**：`.github/`、`tools/`、`portable/`、`docs/`、`*.md`、`.gitignore`
- **src-tauri/icons/**：可以删后用 `bun run icons` 重新生成
- **src-tauri/target/**：见 §3
- **bun.lock**：是唯一的锁文件，必须提交
- **dist/**：vite 构建产物，gitignore 已排除
- **node_modules/**：gitignore 已排除
- **out/**：已删除（不再有 portable 打包产物）

## 6. 改动前先核对清单

每改一个文件，问自己：

1. 它会被 `git push` 上传到公共仓库吗？ → 见 §4 的禁止项
2. 它依赖 `src-tauri/target` 吗？ → 见 §3
3. 它会动到 `.gitignore` 吗？ → 检查 `src-tauri/target` 仍是 symlink
4. 它会改 `Cargo.lock` 吗？ → 检查 mbx 缓存的 hash 仍能用
5. 改了文档（`*.md`）吗？ → 跑 `git grep` 确认没有指向已删除的目录 / 脚本

## 7. 验证步骤

完成代码改动后，按这个顺序验证：

```bash
bun install                   # 增量应该 < 1s
bun run typecheck             # TS 7 通过
bun run build                 # vite build 几百毫秒
bun run tauri build           # 单 exe，2 分钟左右（首次全量）
```

不要省掉 `bun run typecheck` —— TypeScript 7 比 5 严格得多，新代码里写错 `tsconfig.json` 兼容项会立刻挂。

## 8. 已知边界

- WebView2 必需：Win10 1803+ / Win11 默认自带；Win10 早期版本没装会启动失败
- exe 未签名：SmartScreen 第一次运行会提示"未知发布者"
- Rust 代码只在 Windows 验证过；注册表 / 壁纸接口是 Windows 专用
- TypeScript 7 已 GA，但很多生态包还在适配 5/6，遇到类型报错先看是不是包的问题

## 9. 紧急联系

发现以下情况立即停下问用户：

- 远端 commit 被覆盖 / 丢失
- `src-tauri/target` 真的被删了
- `Cargo.lock` 冲突导致所有依赖重编
- `bun install` 之后 `bun.lock` 出现意外的包

不要"自作主张修复" —— 写错一次 cost 半小时。