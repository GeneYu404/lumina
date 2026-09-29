# 文档目录

拾光 Lumina 的工程文档。AI agent 的工作规则在根目录 [AGENTS.md](../AGENTS.md)，
它只保留规则本身，背景说明全部指向这里。

| 文档 | 内容 |
| --- | --- |
| [project.md](project.md) | 项目是什么、技术栈、已知边界 |
| [build-windows.md](build-windows.md) | Windows 构建与便携版、FFmpeg sidecar 编译、数据管线设计 |
| [video-decoding.md](video-decoding.md) | 音视频解码选型：WebView2 能力、为什么用 sidecar 而不是 FFI/DLL、按需播放管线 |
| [mbx-target.md](mbx-target.md) | `src-tauri/target` symlink 的机制、故障恢复、mbx 命令 |

阅读顺序建议：新人看 `project.md` → `build-windows.md`；改 Rust 构建前看 `mbx-target.md`；
改音视频功能前看 `video-decoding.md`。
