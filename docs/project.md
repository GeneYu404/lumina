# 项目概述

拾光 Lumina — Windows 11 风格的图片与视频查看器，单仓库双形态：

- **网页版**：纯前端 React，跑在浏览器里
- **桌面版**：Go 1.27 + MyGo 3 + WebView2，单文件 `Lumina.exe` 约 10 MB +
  `ffmpeg.exe` 解码兜底 sidecar（按需分发），另有安装包可选

> 桌面外壳 2026-10-10 从 Tauri 2 + Rust 重写为 Go + MyGo，Rust 版已删除。
> 架构、命令映射与 `lumina://` 协议见 [go-shell.md](go-shell.md)。

技术栈：React 19（跑在 Preact 兼容层）· Vite 8 · TypeScript 7 · Zustand 5 ·
Go 1.27 + MyGo 3（桌面外壳，纯 Go 零 cgo）· Bun 1.4 · 手写原生 CSS（无 Tailwind）。

## 目录布局

```
src/                    前端（React + TS）
main.go                 Go 外壳入口：窗口、启动数据、单实例、CLI 开关
mygo.config.ts          MyGo 构建配置
internal/               Go 外壳实现
  media/                格式清单、EXIF、纯 Go 解码、缩略图缓存、容器头解析
  sidecar/              外部 FFmpeg 进程接缝
  asset/                lumina:// 本地文件协议（Range + 响应上限）
  winos/                Windows 注册表集成（非 Windows 空实现）
  app/                  绑定给前端的服务层
resources/              打包资源：图标源、FFmpeg 许可证、sidecar
ffmpeg/                 gyan 预编译发行包解压目录（不入库）
ffmpeg-sc/              ffmpeg 源码树（不入库，自编译用）
docs/                   工程文档（本目录）
tools/                  构建/运维脚本（make-icons、fetch-ffmpeg、build-sidecar、build-portable）
```

## 形态与体积

| 文件 | 体积 | 说明 |
| --- | --- | --- |
| `Lumina.exe` | 约 9.8 MB | 主程序（Go 运行时 + 嵌入前端） |
| `ffmpeg-x86_64-pc-windows-msvc.exe` | 约 6.2 MB | 解码兜底 sidecar（自编译最小构建，LGPL 2.1+） |

详见 [build-windows.md](build-windows.md)。

## 已知边界

- **WebView2 必需**：Win10 1803+ / Win11 默认自带；Win10 早期版本没装会启动失败
- **exe 未签名**：SmartScreen 第一次运行会提示"未知发布者"
- **Go 代码只在 Windows 验证过**：注册表 / 壁纸接口是 Windows 专用
- **零 CGO 的代价**：AVIF / HEIC 没有解码器，缩略图只覆盖 jpg/png/gif/webp/bmp/ico/tif
  （与旧 Rust 版一致）；不过尺寸探测读 ISOBMFF 的 `ispe` box 和 SVG 的 `viewBox`，
  这两种格式在图库里的布局尺寸是对的。
- **TypeScript 7 已 GA**，但很多生态包还在适配 5/6，遇到类型报错先看是不是包的问题
- **音视频解码能力因机而异**：HEVC 取决于是否装了「HEVC 视频扩展」，Dolby 系音轨同样
  需要现场探测。软件内的「设置 → 关于 → 开源许可」有实时自检表，
  决策机制见 [video-decoding.md](video-decoding.md)。
