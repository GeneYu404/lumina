# AGENTS.md

> AI agent / 协作者的工作守则。**先读这页，再动手改东西。**
> 本文件只放规则；背景说明、恢复步骤、设计决策全部在 [docs/](docs/README.md)。

## 文档索引

| 想了解 | 看 |
| --- | --- |
| 项目是什么、技术栈、目录布局、已知边界 | [docs/project.md](docs/project.md) |
| Go + MyGo 外壳架构、命令映射、lumina:// 协议 | [docs/go-shell.md](docs/go-shell.md) |
| Windows 构建、便携版、FFmpeg sidecar 编译、数据管线 | [docs/build-windows.md](docs/build-windows.md) |
| 音视频解码选型（WebView2 能力、为何 sidecar 不是 FFI、播放管线） | [docs/video-decoding.md](docs/video-decoding.md) |

## 1. 运行时与包管理器

**前端只用 Bun**（1.4+）。**Go 侧用 Go 1.27+**，`go.mod` 在仓库根。

- `bun install` / `bun run typecheck` / `bun run dev`（= `mygo dev`）/ `bun run build:portable`
- 锁文件是 `bun.lock`，**不要**生成 / 提交 `package-lock.json`
- 不要主动 `npm install`；Node 24 只在 CI 缺 Bun 时允许降级
- 如果看到 `npm install` 输出，立即停掉并改回 bun

### 1.1 桌面外壳是 Go

外壳是 **Go 1.27 + MyGo 3**（2026-10-10 从 Tauri + Rust 重写，Rust 版已删除）。
**零 CGO**，不装 Rust、不装 VS 生成工具、不装 cargo。

- Go 侧代码在 `main.go` + `internal/`，见 [docs/go-shell.md](docs/go-shell.md)。
- `src/mygo.ts` 由 `mygo generate` 生成，**不要手改**；改了 Go 方法签名后重新生成。
- 前端只有四个文件与外壳耦合：`src/desktop.ts`、`src/native.ts`、
  `src/utils/pcmPlayer.ts`、`src/components/Gallery.tsx`。其余 12,000
  多行前端与外壳无关。改这几个文件时**保持对外导出的函数签名不变**。
- **不要**在任何前端文件里写 `invoke(...)` 或 `from '@tauri-apps/api'`。一律走
  `src/mygo.ts` 生成的客户端；二进制在 JS 侧是 **base64**，不是 `ArrayBuffer`。

### 1.2 Go 侧的硬约束

- **零 CGO**：`CGO_ENABLED=0` 必须能编译。MyGo 的设计前提，不要引入需要 cgo 的库。
- 系统调用走 `golang.org/x/sys/windows` 或 `syscall.NewLazyDLL`，**绝不 `import "C"`**。
- 缩略图可解码格式**保持十种**（jpg/png/gif/webp/bmp/ico/tif 及 jfif 变体），
  与 Rust 版一致。AVIF/HEIC/JXL/SVG 不解码，前端回退到原图 —— 别为了「补全」
  去引入解码库，那会把 cgo 拖回来。
- 跨平台代码用构建标签分文件（`*_windows.go` / `*_other.go`），照 MyGo 自己的惯例。
- `internal/media/mediainfo.go`、`internal/winos/register_windows.go`、
  `internal/sidecar/sidecar.go` 是从 Rust 逐函数移植的，**注释解释了非显然的取舍，
  移植它们时把注释一起搬过去**。

### 1.3 前端栈（2026-10-03 起）

React 19 源码跑在 **Preact 兼容层**上（`vite.config.ts` 的
`resolve.alias`；`react-dom` / `react/jsx-runtime` 必须排在 `react` **前面**，否则前缀匹配会
生成不存在的 `preact/compat/jsx-runtime`）。样式是**手写原生 CSS**，`index.css` 2,134 行
（`@layer base` + `@layer components`，531 个语义类），`tailwindcss` / `@tailwindcss/vite` /
`tailwind-merge` 已移除，`cn()` 只剩 `clsx`。

⚠️ `body` 的 `background:#06122e` 是**字面量不是 `var(--bg)`** —— 查看器衬底不跟随主题，
改主题时别顺手把它改成变量。`html[data-desktop] body{background:var(--bg)}`（桌面版路径）
才是跟随主题的那条。

## 2. 提交与推送

- **本地分支**：`main`；**远端**：`https://github.com/GeneYu404/lumina.git`
- **身份**：用 gh CLI 登录的账号 `GeneYu404`；不要写死别的 user.name / email
- **commit 信息**：英文或中文都行，格式 `<scope>: <一句话>`（例：`fix:`, `feat:`, `docs:`, `chore:`）
- **force push** 默认禁止；只有用户明确说"覆盖远端 / 强制推送"才允许，且必须用
  `--force-with-lease`（不是 `--force`）；绝不要 force-push 别人的 commit / 删别人的分支
- **本地与远端无共同祖先时**（init 完第一次 push），用 `git push --force-with-lease origin main`，
  不要拉 rebase（会产生几十个 add/add 冲突）

## 3. 文件与目录

- **删除前先问用户**：`.github/`、`tools/`、`docs/`、`*.md`、`.gitignore`
- **必须提交**：`bun.lock`（唯一锁文件）、`go.mod`、`go.sum`（Go 外壳的锁文件）
- **已排除**：`dist/`、`node_modules/`、`build/`、`.mygo/`（gitignore）
- **大文件不入库**（gitignore 已覆盖）：`resources/ffmpeg*.exe`、`ffmpeg/`、`ffmpeg-sc/`
- **`resources/` 会被 `mygo build` 原样复制到应用目录**（与 exe 并排），
  所以它只放「运行期确实要分发的东西」：图标源文件、FFmpeg 许可证、sidecar。
  往里塞无关文件会跟着进每一个分发包。

## 4. 改动前先核对清单

1. 它会被 `git push` 上传到公共仓库吗？ → 见 §2 的禁止项
2. 它会动到 `.gitignore` 吗？ → 确认 `resources/ffmpeg*.exe` 仍被排除
3. 它往 `resources/` 里加东西了吗？ → 那个目录会进每个分发包，只放确实要分发的
4. 它引入了需要 cgo 的 Go 依赖吗？ → `CGO_ENABLED=0 go build ./...` 必须通过
5. 它在前端里留了 `invoke(` 或 `@tauri-apps` 吗？ → 一律走 `src/mygo.ts`
6. 改了文档（`*.md`）吗？ → `git grep` 确认没有指向已删除的文件 / 脚本
7. **交付前扫一遍过时词汇**：`Tauri` / `Rust` / `Tailwind` / `lumina.exe` /
   `@tauri-apps` / `src-tauri`。外壳换过一次，这几个词最容易漏（曾经漏在
   「关于」页的标题行和许可对话框里）。

## 5. 验证步骤

完成代码改动后按顺序验证，**不要省掉 `bun run typecheck`**（TypeScript 7 比 5 严格得多）：

```bash
bun install                   # 增量应该 < 1s
bun run typecheck             # TS 7 通过
go vet ./... && gofmt -l .    # Go 侧：vet 无输出、gofmt 无输出
CGO_ENABLED=0 go build ./...  # 零 cgo 必须能编译
go test ./...                 # Go 侧纯逻辑
bun run build:portable        # → build/portable/Lumina.exe，约 15s
```

改了绑定方法的签名还要重新生成客户端：

```bash
bun run generate              # 重写 src/mygo.ts
```

改到 sidecar 编译本身（`tools/build-sidecar.ps1`）时：
`bun run build:sidecar`（需 MSYS2 MINGW64，构建参数与三个坑见
[docs/build-windows.md](docs/build-windows.md) 的「自编译 sidecar」一节）。

### 构建产物统一归档到 `D:\Tool`

打包好的可执行文件**一律放进 `D:\Tool`**，不要留在项目目录里散落：

- `bun run build:portable` 产出后，把 `build\portable\` 整个目录复制到 `D:\Tool\`
- 交付给用户的文件是 `D:\Tool\` 里的那份
- `build\` 属构建缓存（每次构建整个覆盖），**不是**交付物

## 6. 紧急联系

发现以下情况**立即停下问用户**，不要自作主张修复（写错一次 cost 半小时）：

- 远端 commit 被覆盖 / 丢失
- `go.mod` / `go.sum` 冲突导致所有依赖重编
- `bun install` 之后 `bun.lock` 出现意外的包
- 用户装的 FFmpeg / sidecar 消失
