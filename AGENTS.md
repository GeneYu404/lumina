# AGENTS.md

> AI agent / 协作者的工作守则。**先读这页，再动手改东西。**
> 本文件只放规则；背景说明、恢复步骤、设计决策全部在 [docs/](docs/README.md)。

## 文档索引

| 想了解 | 看 |
| --- | --- |
| 项目是什么、技术栈、目录布局、已知边界 | [docs/project.md](docs/project.md) |
| Windows 构建、便携版、FFmpeg sidecar 编译、数据管线 | [docs/build-windows.md](docs/build-windows.md) |
| 音视频解码选型（WebView2 能力、为何 sidecar 不是 FFI、播放管线） | [docs/video-decoding.md](docs/video-decoding.md) |
| `src-tauri/target` symlink 机制与故障恢复（mbx） | [docs/mbx-target.md](docs/mbx-target.md) |

## 1. 运行时与包管理器

**只用 Bun**（1.4+，Rust 重写版）。

- `bun install` / `bun run dev` / `bun run build` / `bun run tauri dev` / `bun run tauri build`
- 锁文件是 `bun.lock`，**不要**生成 / 提交 `package-lock.json`
- 不要主动 `npm install`；Node 24 只在 CI 缺 Bun 时允许降级
- 如果看到 `npm install` 输出，立即停掉并改回 bun

## 2. `src-tauri/target` —— 绝对不能动

它是 **mbx 缓存 symlink**（mode `120000` → `D:/mbx/targets/v1/<hash>`，hash 来自
`Cargo.lock`）。完整机制、四种故障的恢复命令、mbx 命令表在
**[docs/mbx-target.md](docs/mbx-target.md)**。这里只记禁止项：

- ❌ `rm -rf` / `rmdir` / `mkdir` 这个路径
- ❌ `git rm` / `git update-index --remove` 它
- ❌ 在 `.gitignore` 里写错规则导致它被解引用
- ❌ 改 `Cargo.lock` 后让 symlink 与索引不一致

自查：`git ls-files -s src-tauri/target` 必须是 `120000`。不对就按
[docs/mbx-target.md](docs/mbx-target.md) 恢复，不要手工删建。

## 3. 提交与推送

- **本地分支**：`main`；**远端**：`https://github.com/GeneYu404/lumina.git`
- **身份**：用 gh CLI 登录的账号 `GeneYu404`；不要写死别的 user.name / email
- **commit 信息**：英文或中文都行，格式 `<scope>: <一句话>`（例：`fix:`, `feat:`, `docs:`, `chore:`）
- **force push** 默认禁止；只有用户明确说"覆盖远端 / 强制推送"才允许，且必须用
  `--force-with-lease`（不是 `--force`）；绝不要 force-push 别人的 commit / 删别人的分支
- **本地与远端无共同祖先时**（init 完第一次 push），用 `git push --force-with-lease origin main`，
  不要拉 rebase（会产生几十个 add/add 冲突）

## 4. 文件与目录

- **删除前先问用户**：`.github/`、`tools/`、`docs/`、`*.md`、`.gitignore`
- **可自行重建**：`src-tauri/icons/`（`bun run icons`）
- **必须提交**：`bun.lock`（唯一锁文件）
- **已排除**：`dist/`、`node_modules/`（gitignore）
- **大文件不入库**（gitignore 已覆盖）：`src-tauri/bin/ffmpeg-*.exe`、
  `src-tauri/ffmpeg/`、`src-tauri/ffmpeg-sc/`
- **`src-tauri/target/`**：见 §2

## 5. 改动前先核对清单

1. 它会被 `git push` 上传到公共仓库吗？ → 见 §3 的禁止项
2. 它依赖 `src-tauri/target` 吗？ → 见 §2
3. 它会动到 `.gitignore` 吗？ → 改完检查 `src-tauri/target` 仍是 `120000`
4. 它会改 `Cargo.lock` 吗？ → 检查 mbx 缓存 hash 仍能用
5. 改了文档（`*.md`）吗？ → `git grep` 确认没有指向已删除的文件 / 脚本

## 6. 验证步骤

完成代码改动后按顺序验证，**不要省掉 `bun run typecheck`**（TypeScript 7 比 5 严格得多）：

```bash
bun install                   # 增量应该 < 1s
bun run typecheck             # TS 7 通过
bun run build                 # vite build 几百毫秒
bun run tauri build           # lumina.exe + ffmpeg sidecar，2 分钟左右
```

改到 Rust 或 sidecar 时追加：

```bash
cd src-tauri && cargo test --bin lumina    # sidecar 接缝、WAV 解析、缩略图 round-trip
```

改到 sidecar 编译本身（`tools/build-ffmpeg-sidecar.sh`）时：
`bun run build:sidecar`（需 MSYS2 MINGW64，构建参数与三个坑见
[docs/build-windows.md](docs/build-windows.md) 的「自编译 sidecar」一节）。

## 7. 紧急联系

发现以下情况**立即停下问用户**，不要自作主张修复（写错一次 cost 半小时）：

- 远端 commit 被覆盖 / 丢失
- `src-tauri/target` 真的被删了
- `Cargo.lock` 冲突导致所有依赖重编
- `bun install` 之后 `bun.lock` 出现意外的包
