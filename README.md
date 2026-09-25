# 拾光 Lumina

一款 Windows 11 风格的**图片与视频查看器**，一套代码两种形态：

- **网页版**：纯前端 React 应用，直接在浏览器里打开本地图片。
- **Windows 桌面版**：用 Tauri 2 打包，界面运行在系统自带的 WebView2 中，
  外壳是 Rust；安装包仅数 MB，支持文件关联、右键菜单、壁纸设置等系统能力。

## 功能

- 图片查看：缩放、平移、旋转、翻转、裁剪、调色（亮度/对比度/饱和/色温/暗角等）、一键滤镜。
- 视频播放：MP4 / MOV / WebM / MKV 等，走系统硬件解码；海报帧由同一解码器生成。
- 动图：GIF / APNG / 动态 WebP 通过 WebCodecs 逐帧解码，循环不再反复解码，播放不卡顿。
- 图库：图片/视频分区、文件名/类型/时间/文件夹搜索、缩略图网格。
- 拼图：多图拼合，支持行/列/网格/主角布局，可调间距、圆角、背景，导出 PNG/JPG/WebP。
- 打印与导出：纸张、边距、每页多张（联系表）、页眉页码、份数，可调用系统打印机或导出 PDF。
- 批量管理：收藏、幻灯片放映、EXIF/直方图/主色调分析、设置桌面壁纸。
- 桌面端：双击图片直接进入、启动恢复上次位置、资源管理器右键菜单、系统文件关联。

所有文件都只在本机处理，不上传任何服务器。

## 快速开始（网页版）

```bash
npm install
npm run dev        # 开发
npm run build      # 生产构建，输出到 dist/
npm run typecheck  # TypeScript 全量类型检查
```

## 桌面版（Tauri）

构建步骤、系统集成说明和数据管线见 [WINDOWS.md](WINDOWS.md)；
视频解码的技术选型见 [docs/video-decoding.md](docs/video-decoding.md)。

## 目录结构

```
src/
  components/        界面组件
    dialogs/         各类弹窗（设置、打印、拼图、另存为、壁纸……）
    ui/              基础 UI 控件（按钮、菜单、对话框、开关……）
  hooks/             全局快捷键等 React hooks
  utils/             文件识别、图片处理、缩略图、视频海报、打印排版
  actions.ts         业务动作（打开、保存、打印、壁纸、全屏……）
  store.ts           Zustand 状态与缩略图队列
  desktop.ts         Tauri 桥接（IPC、asset 协议、原生文件选择）
  native.ts          Windows shell 集成与会话恢复
src-tauri/src/main.rs   Rust 外壳：文件扫描、缩略图批处理、注册表、壁纸
tools/make-icons.mjs    生成应用图标
```

## 快捷键

应用内按 `?` 可查看完整快捷键，常用：`Ctrl+O` 打开、`Ctrl+Shift+O` 打开文件夹、
`R`/`Shift+R` 旋转、`C` 裁剪、`E` 编辑、`I` 文件信息、`F5` 幻灯片、`F11` 全屏、`G` 图库。
