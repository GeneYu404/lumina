# 项目概述

拾光 Lumina — Windows 11 风格的图片与视频查看器，单仓库双形态：

- **网页版**：纯前端 React，跑在浏览器里
- **桌面版**：Tauri 2 + WebView2，免安装目录（`lumina.exe` 约 6 MB + `ffmpeg.exe`
  解码兜底 sidecar），不生成安装包

技术栈：React 19 · Vite 8 · TypeScript 7 · Tauri 2 · Rust · Zustand · Tailwind 4 · Bun 1.4。

## 目录布局

```
src/                    前端（React + TS）
src-tauri/              Rust 外壳
  src/                  main.rs、asset.rs、media_info.rs、ffmpeg_sidecar.rs…
  bin/                  ffmpeg sidecar（不入库，gitignore）
  ffmpeg/               gyan 预编译发行包解压目录（不入库）
  ffmpeg-sc/            ffmpeg 源码树（不入库，自编译用）
  target/               mbx 缓存 symlink —— 绝对不能手工删建，见 mbx-target.md
docs/                   工程文档（本目录）
tools/                  构建/运维脚本（make-icons、fetch-ffmpeg、build-sidecar）
```

## 形态与体积

| 文件 | 体积 | 说明 |
| --- | --- | --- |
| `lumina.exe` | 约 6.3 MB | 主程序 |
| `ffmpeg.exe` | 约 6.2 MB | 解码兜底 sidecar（自编译最小构建，LGPL 2.1+） |

详见 [build-windows.md](build-windows.md)。

## 已知边界

- **WebView2 必需**：Win10 1803+ / Win11 默认自带；Win10 早期版本没装会启动失败
- **exe 未签名**：SmartScreen 第一次运行会提示"未知发布者"
- **Rust 代码只在 Windows 验证过**：注册表 / 壁纸接口是 Windows 专用
- **TypeScript 7 已 GA**，但很多生态包还在适配 5/6，遇到类型报错先看是不是包的问题
- **音视频解码能力因机而异**：HEVC 取决于是否装了「HEVC 视频扩展」，Dolby 系音轨同样
  需要现场探测。软件内的「设置 → 关于 → 开源许可」有实时自检表，
  决策机制见 [video-decoding.md](video-decoding.md)。
