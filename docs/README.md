# 文档目录

拾光 Lumina 的工程文档。AI agent 的工作规则在根目录 [AGENTS.md](../AGENTS.md)，
它只保留规则本身，背景说明全部指向这里。

| 文档 | 内容 |
| --- | --- |
| [project.md](project.md) | 项目是什么、技术栈、已知边界 |
| [go-shell.md](go-shell.md) | Go + MyGo 外壳架构、命令映射、`lumina://` 协议 |
| [build-windows.md](build-windows.md) | Windows 构建与便携版、FFmpeg sidecar 编译、数据管线设计 |
| [video-decoding.md](video-decoding.md) | 音视频解码选型：WebView2 能力、为什么用 sidecar 而不是 FFI/DLL、按需播放管线 |

阅读顺序建议：新人看 `project.md` → `build-windows.md`；改外壳前看 `go-shell.md`；
改音视频功能前看 `video-decoding.md`。
