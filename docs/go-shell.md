# Go 外壳（MyGo）

> 桌面外壳是 **Go 1.27 + MyGo 3**（2026-10-10 从 Tauri 2 + Rust 重写而来，
> Rust 版已移除）。React 前端一行没动，只换了与外壳耦合的四个文件。

## 为什么是 MyGo

两边跑在同一个运行时上：Windows 上都是系统自带的 **WebView2**，页面是同一份
Vite 构建产物。所以这不是「换一个 UI 框架」，而是把外壳那 3090 行 Rust 换成
等价的 Go，编译期合成进同一个二进制，交付物仍然是单个 exe。

| | Tauri 2（已移除） | MyGo（当前） |
| --- | --- | --- |
| 外壳语言 | Rust 3090 行 / 5 文件 | Go |
| 前后端通信 | `@tauri-apps/api` 的 `invoke` | 类型化 IPC，Go 绑定 → 生成的 TS 客户端 |
| 本地文件 | 内置 `asset:` 协议 | 自建 `lumina://` 协议 |
| 构建 | `bun run tauri build` | `bun run build`（即 `mygo build`） |
| 依赖的运行库 | Rust std + crates | 纯 Go，**零 CGO** |

## 目录

```
main.go                  应用入口：CLI 开关、单实例、窗口、启动数据注入
mygo.config.ts           MyGo 配置（窗口、构建命令、文件关联）
go.mod / go.sum          Go 1.27，依赖只有 mygo + x/image + x/sys
internal/
  media/                 平台无关的媒体逻辑
    exts.go              扩展名清单（图片 / 视频 / 可解码）
    exif.go              EXIF Orientation 解析（JPEG APP1 / PNG eXIf / WebP / TIFF）
    decode.go            尺寸探测 + 纯 Go 解码 + 缩放 + 缩略图编码
    thumb.go             缩略图磁盘缓存、并发批处理、打包成线格式
    scan.go              目录遍历、条目探测、启动兄弟文件
    mediainfo.go         MP4/ISOBMFF、MKV/EBML、AVI、FLV、ASF 容器头解析
  sidecar/               外部 FFmpeg 进程接缝（不链接 libavcodec）
  asset/                 lumina:// 协议：带 Range 的本地文件服务
  winos/                 Windows 注册表集成（非 Windows 为空实现）
  app/                   绑定给前端的服务层（对应原 18 个 Tauri command）
    service.go           文件导入、启动数据、路径白名单、窗口控制
    winint.go            注册表 / 壁纸 / 资源管理器 / FFmpeg 方法
    wallpaper_*.go       设置壁纸（Windows 专属，带构建标签）
```

## 命令映射

前端调用的名字变了，能力一一对应。`src/desktop.ts` 和 `src/native.ts` 是唯一
需要改的桥接层，**对外导出的函数签名保持不变**，所以调用方无感。

| 原 Tauri command | MyGo bound method |
| --- | --- |
| `collect_paths` | `Lumina.collectPaths` |
| `describe_batch` | `Lumina.describeBatch` |
| `thumb_batch` | `Lumina.thumbBatch` |
| `read_image` | `Lumina.readImage` |
| `read_media_info` | `Lumina.readMediaInfo` |
| `launch_siblings` | `Lumina.launchSiblings` |
| `open_with_default` | `Lumina.openWithDefault` |
| `reveal_in_folder` | `Lumina.revealInFolder` |
| `ffmpeg_probe` / `ffmpeg_stream` / `ffmpeg_stop` | `Lumina.ffmpegProbe` / `.ffmpegStream` / `.ffmpegStop` |
| `set_wallpaper` | `Lumina.setWallpaper` |
| `shell_menu` / `shell_menu_state` | `Lumina.shellMenu` / `.shellMenuState` |
| `assoc_state` / `assoc_set` | `Lumina.assocState` / `.assocSet` |
| `open_default_apps` | `Lumina.openDefaultApps` |
| （Tauri dialog 插件，前端调用） | `Lumina.pickImages` / `.pickFolder` |

窗口控制（`setFullscreen` / `setTitle` / `setTheme` / `close`）走 MyGo 的
`currentWindow` 与绑定方法。拖放用 `mygo-runtime` 的 `onFileDrop`。

### 两处签名上的差异

1. **二进制以 base64 过桥**。MyGo 的 `[]byte` 序列化成 base64 字符串，Rust 版
   走的是 `ArrayBuffer`。`desktop.ts` 里的 `fromBase64()` 负责转换，缩略图那
   13 字节目录记录格式不变，只是多了一次 base64 编解码（约 +33% 体积）。

2. **媒体信息的空值是 `""` 不是 `null`**。Go 侧用非指针 `string`，没有值时序列
   化成空串；前端 `MediaInfo` 类型是 `string | null`，两者都 falsy，行为一致。

## 格式覆盖

缩略图解码保持与 Rust 版**完全一致**的十种格式（jpg / png / gif / webp / bmp /
ico / tif / jpg 的 jfif 变体）。`avif` / `heic` / `jxl` / `svg` 本来就不在
Rust 的 `DECODABLE` 列表里 —— 前端对它们回退到显示原图，Go 版行为相同。

零 CGO 换来的稳定构建，比补齐全格式解码更重要。**尺寸探测反而比 Rust 版更好**：

- Rust：`image_dimensions` 解不了 AVIF/HEIC，图库里这些格子是 0×0 空白。
- Go：读 ISOBMFF 的 `ispe` box，SVG 读 `width`/`height`/`viewBox` —— 纯解析，
  零依赖，布局尺寸正确。

## lumina:// 协议

替代 Tauri 内置的 `asset:`。URL 形如 `lumina://localhost/C%3A%5Cphotos%5Ca.jpg`。

**每次响应都有上限**，这是重点。原 Rust 版注释里写的「闪退」就是这儿：一个不带
`Range` 头的请求会把整个文件读进内存。`<video>` 会带 `Range`，但 `<img>` 预加载、
`OPTIONS` 预检、`window.open`、CSS `mask-image` 不会 —— 于是一个多 GB 的视频会把
进程内存吃穿，Windows 直接杀掉窗口。

- 带 `Range`：最多返回 1 MB（`206`）。
- 不带 `Range`：文件超过 128 MB 直接 `413` 拒绝；`<img>` 指着视频只会解码失败，
  而不是把整个进程带走。
- 路径白名单：页面没导入过的文件，即使知道绝对路径也读不到。

## 开发与构建

```bash
bun install
bun run typecheck     # TS 全量类型检查
bun run dev           # mygo dev：窗口 + 热更新
go test ./...         # 纯逻辑：解析、扫描、协议、sidecar
bun run build:portable # → build/portable/Lumina.exe（免安装，无安装包）
bun run build         # mygo build，另含 NSIS 安装包
```

改动 Go 侧方法后重新生成 TS 客户端（`mygo dev` / `mygo build` 会自动做）：

```bash
bun run generate
```

## 已知边界

- **产物 9.8 MB**（Go 运行时 + 嵌入的前端 382 KB）。这是纯 Go 单文件的代价。
- **exe 未签名**，SmartScreen 首次运行会提示「未知发布者」。
- **MyGo 0.3.7 无法跳过 Windows 安装包**：`nsisCompiler()` 会无条件下载 NSIS 并生成
  `<name> Setup <version>.exe`，配置和命令行都没有开关。所以 `build:portable` 的做法是
  跑完 `mygo build` 后把安装包剔除。之所以不直接用裸 `go build`，是因为任务的图标、
  DPI 感知清单和版本信息都是 MyGo 编译期生成 `.syso` 链接进 exe 的，换掉会退回
  Go 默认图标。需要连安装包一起留：`powershell -File tools\build-portable.ps1 -KeepInstaller`。
- **FFmpeg sidecar 仍是独立进程**，Go 侧不链接 libavcodec。`resources\` 里的
  `ffmpeg*.exe` 会被 `mygo build` 复制到应用目录、与 exe 并排；开发期还会去
  `resources\`、`bin\` 下找，也认 `LUMINA_FFMPEG` 环境变量。
- **图标是 512×512**，MyGo 建议 1024×1024。当前不影响打包，但换大图会更清晰；
  `bun run icons` 生成的是 1024×1024 的 `build/icons/app-icon.png`，手动拷过去即可。
- **`resources/` 会整体进分发包**，别往里放无关文件（曾经把 16 个 Tauri/MSIX 图标
  带进去，NSIS 直接报错说 `android` 目录为空）。
- Go 侧只在 Windows 上验证过。
- Go 侧只在 Windows 上验证过；`internal/winos` 有非 Windows 空实现，
  `wallpaper_*.go` 靠构建标签隔开，但 macOS / Linux 未实测。
