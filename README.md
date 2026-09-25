# 拾光 Lumina

一款 Windows 11 风格的**图片与视频查看器**，一套代码两种形态：

- **网页版**：纯前端 React 应用，直接在浏览器里打开本地图片。
- **Windows 桌面版**：用 Tauri 2 打包成单文件 `.exe`（便携版，免安装），
  界面运行在系统自带的 WebView2 中，外壳是 Rust。

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
- **EXIF Orientation 自动旋转**：手机竖屏照片不再被压扁。Rust 端读取
  EXIF Orientation 标签，JS 端在 web 模式对 File 对象补做一次方向纠正，
  Chromium 的 `image-orientation: none` 保证容器和内容方向一致。
- **O(1) store 更新**：缩略图、视图状态、收藏等元数据修改都按 id 索引原地替换，
  不再每次 `images.map(...)`。
- **缩略图批量提交**：缩略图解码完成后集中在下一个 microtask 内一次性
  `patchMany` 写回 store，导入 1000 张照片只触发一次 React render。

所有文件只在本机处理，不上传任何服务器。

## 快速开始（开发）

用 **Bun**（项目默认运行时，详见 [WINDOWS.md](WINDOWS.md#开发环境)）：

```bash
bun install
bun run dev          # vite 开发服务器（http://localhost:5173）
bun run build        # 生产构建，输出 dist/
bun run typecheck    # TypeScript 全量类型检查
```

桌面版开发：

```bash
bun run tauri dev    # Tauri 窗口 + 热更新
bun run tauri build  # 生成便携版 exe
```

## 便携版（单文件 exe）

```bash
bun run tauri build
```

产物：`src-tauri\target\release\lumina.exe`（约 6 MB，需要系统已装 WebView2，
Win10 1803 以上 / Win11 默认自带）。

命令行：

```powershell
lumina.exe                # 启动
lumina.exe path\to\pic.jpg  # 打开指定文件
lumina.exe --register     # 注册资源管理器右键菜单「用拾光打开」
lumina.exe --set-default  # 把图片格式设为默认打开方式
lumina.exe --status       # 查看注册状态
lumina.exe --unregister   # 清除注册
lumina.exe --help         # 全部选项
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
  desktop.ts         Tauri 桥接（IPC、asset 协议、原生选择器）
  native.ts          Windows shell 集成 + 会话恢复

src-tauri/           Rust 桌面外壳
  src/main.rs        文件扫描、缩略图批处理、注册表、壁纸、EXIF 读取
  tauri.conf.json    窗口与权限配置

tools/               工具脚本（图标生成）
docs/                视频解码等专项文档
```

## 文档

- [WINDOWS.md](WINDOWS.md) — Windows 桌面版开发、便携版与系统集成说明
- [docs/video-decoding.md](docs/video-decoding.md) — 视频解码技术选型

## 快捷键

应用内按 `?` 查看完整列表，常用：
- `Ctrl+O` 打开 / `Ctrl+Shift+O` 打开文件夹
- `R`/`Shift+R` 旋转 / `C` 裁剪 / `E` 编辑 / `I` 文件信息
- `F5` 幻灯片 / `F11` 全屏 / `G` 图库 / `Delete` 从列表移除