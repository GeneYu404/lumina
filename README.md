# 拾光 Lumina

> ⚠️ **本项目由 AI 协助完成，状态不稳定。** 可能存在尚未发现的缺陷，请自行评估使用风险。

一款 Windows 11 风格的**图片与视频查看器**，一套代码两种形态：

- **网页版**：纯前端 React 应用，直接在浏览器里打开本地图片。
- **Windows 桌面版**：界面跑在系统自带的 WebView2 中，外壳是 **Go 1.27 + MyGo 3**
  （`main.go` + `internal/`），纯 Go、**零 CGO**，单文件交付。
  见 [docs/go-shell.md](docs/go-shell.md)。

两种形态共用同一份 React 前端，只是「桌面能力」由 Go 外壳提供还是降级为空实现。

## 功能

### 浏览
- 图片查看：缩放、平移、旋转、翻转、裁剪、调色（亮度/对比度/饱和/色温/暗角等）。
- 视频播放：MP4 / MOV / WebM / MKV 等，由系统 WebView 硬件解码。
- 动图：GIF / APNG / 动态 WebP 通过 WebCodecs 逐帧解码，循环不再反复解码。
- 图库：图片/视频分区，文件名/类型/时间/文件夹搜索，分页缩略图网格。

### 编辑
- 拼图：多图拼合，行/列/网格/主角布局，可调间距、圆角、背景，导出 PNG/JPG/WebP。
- 打印与导出：纸张、边距、每页多张（联系表）、页眉页码、份数，或导出 PDF。
- 批量管理：收藏、幻灯片放映、EXIF/直方图/主色调分析、设置桌面壁纸。

### 桌面端
- 双击图片直接进入、启动恢复上次位置、资源管理器右键菜单、系统文件关联。
- **整棵子树扫描**：从资源管理器打开一张图片，会把它所在目录的整棵子树
  （默认最多 2000 个文件、最深 12 层）一起加载，手机按年份/月份分类的图库不用再翻。

### 性能与正确性
- **EXIF Orientation 自动旋转**：手机竖屏照片不再被压扁。Go 端读取
  EXIF Orientation 标签，JS 端在 web 模式对 File 对象补做一次方向纠正，
  Chromium 的 `image-orientation: none` 保证容器和内容方向一致。
- **O(1) store 更新**：缩略图、视图状态、收藏等元数据修改都按 id 索引原地替换，
  不再每次 `images.map(...)`。
- **缩略图批量提交**：缩略图解码完成后集中在下一个 microtask 内一次性
  `patchMany` 写回 store，导入 1000 张照片只触发一次 React render。

所有文件只在本机处理，不上传任何服务器。

## 快速开始（开发）

用 **Bun**（项目默认运行时，详见 [docs/build-windows.md](docs/build-windows.md#开发环境)）：

```bash
bun install
bun run dev             # 桌面版开发模式（mygo dev，含热更新）
bun run dev:web         # 只起 vite 开发服务器（http://localhost:5173）
bun run typecheck       # TypeScript 全量类型检查
go test ./...           # Go 侧纯逻辑测试
bun run build:portable  # 打包免安装便携版 → build/portable/
bun run build           # 同上，但额外保留 NSIS 安装包
```

FFmpeg sidecar（解码兜底，可选）：

```bash
bun run build:sidecar   # 从源码编译最小 sidecar（6 MB，需 MSYS2，推荐）
bun run fetch:ffmpeg    # 或直接拉 gyan 预编译版（100 MB，应急）
```

## 便携版（免安装目录）

```bash
bun run build:portable
```

产物在 `build\portable\`，一起分发即可：

| 文件 | 体积 | 说明 |
| --- | --- | --- |
| `Lumina.exe` | 9.8 MB | 主程序 |
| `ffmpeg-x86_64-pc-windows-msvc.exe` | 6.2 MB | 解码兜底，只在 WebView2 解不了的音轨（如 E-AC-3）时才启动 |
| `LICENSE.ffmpeg.txt` | 4 KB | 随包许可证 |

需要系统已装 WebView2（Win10 1803 以上 / Win11 默认自带）。

> MyGo 0.3.7 在 Windows 上没有跳过安装包的开关，`build:portable` 会在 `mygo build`
> 之后把生成的 NSIS 安装包剔除。详见 [docs/build-windows.md](docs/build-windows.md#便携版免安装目录)。

命令行：

```powershell
Lumina.exe                # 启动
Lumina.exe path\to\pic.jpg  # 打开指定文件
Lumina.exe --register     # 注册资源管理器右键菜单「用拾光打开」
Lumina.exe --set-default  # 把图片格式设为默认打开方式
Lumina.exe --status       # 查看注册状态
Lumina.exe --unregister   # 清除注册
Lumina.exe --help         # 全部选项
```

全部只写 `HKEY_CURRENT_USER`，不需要管理员权限。

## 目录结构

```
src/                 React 前端
  components/        界面组件（Viewer, Gallery, Filmstrip, ...）
    dialogs/         设置/打印/拼图/另存为/壁纸等弹窗
    ui/              按钮/菜单/对话框/开关等基础控件
  hooks/             useGlobalKeys 等
  utils/             文件识别、图片处理、缩略图、视频海报、EXIF 方向
  actions.ts         业务动作（打开/保存/打印/壁纸/全屏...）
  store.ts           Zustand 状态 + O(1) setMeta + 缩略图批量队列
  desktop.ts         桌面桥接（IPC、本地文件协议、原生选择器）—— MyGo 客户端
  native.ts          Windows shell 集成 + 会话恢复 —— MyGo 客户端
  mygo.ts            MyGo 生成的类型化客户端（`mygo generate`，勿手改）

main.go              Go 外壳入口：窗口、启动数据、单实例、CLI 开关
mygo.config.ts       MyGo 构建配置
internal/            Go 外壳实现
  media/             格式清单、EXIF、纯 Go 解码、缩略图缓存、容器头解析
  sidecar/           外部 FFmpeg 进程接缝
  asset/             lumina:// 本地文件协议（Range + 响应上限）
  winos/             Windows 注册表集成
  app/               绑定给前端的服务层

resources/             打包资源：图标源文件、FFmpeg 许可证（mygo build 会复制到应用目录）
tools/                 工具脚本（图标生成、FFmpeg 获取与编译、便携版打包）
docs/                  工程文档（构建、解码选型、Go 外壳）
```

## 文档

- [docs/](docs/README.md) — 文档总目录
  - [go-shell.md](docs/go-shell.md) — Go + MyGo 外壳架构与命令映射
  - [project.md](docs/project.md) — 项目概述与已知边界
  - [build-windows.md](docs/build-windows.md) — Windows 构建、便携版、sidecar
  - [video-decoding.md](docs/video-decoding.md) — 视频解码技术选型
- [AGENTS.md](AGENTS.md) — AI agent / 协作者的工作守则

## 快捷键

应用内按 `?` 查看完整列表，常用：
- `Ctrl+O` 打开 / `Ctrl+Shift+O` 打开文件夹
- `R`/`Shift+R` 旋转 / `C` 裁剪 / `E` 编辑 / `I` 文件信息
- `F5` 幻灯片 / `F11` 全屏 / `G` 图库 / `Delete` 从列表移除