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

**允许**：

- ✅ `git status` 显示 `D src-tauri/target` 时 → 这是误删，用 `git update-index --add --cacheinfo 120000,<hash>,src-tauri/target` 加回；hash 从 `git ls-tree origin/main src-tauri/target` 或 `git cat-file -p HEAD:src-tauri/target` 取
- ✅ 编译时 cargo / tauri 命令会**自动**通过 symlink 使用 mbx 缓存
- ✅ 移动 / 删除整个项目后，mbx 缓存仍在 `D:\mbx\targets\v1\`，可复用

**怎么判断自己没破坏它**：

```bash
git ls-tree HEAD src-tauri/target
# 应该输出: 120000 blob <hash>  src-tauri/target

git ls-files -s src-tauri/target
# 工作树里也应该是 120000，不是普通文件或目录
```

如果是 `100644` 或 `<DIR>`，说明 symlink 没了，立刻停下恢复。

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