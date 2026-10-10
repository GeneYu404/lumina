# Windows 桌面版（Go + MyGo）— 拾光 Lumina

桌面版用 **Go 1.27 + MyGo 3** 打包：界面运行在 Windows 自带的 **WebView2**（与 Edge
同一内核）中，外壳是纯 Go 程序，**零 CGO**，交叉编译任意平台。

| | MyGo（本项目） | Electron |
| --- | --- | --- |
| 交付形态 | 免安装目录（`Lumina.exe` + FFmpeg sidecar）| 安装包 80–120 MB |
| 体积 | 主程序约 **9.8 MB**（+ sidecar 6.2 MB）| 80–120 MB |
| 空闲内存 | 低（共享系统 WebView2）| 高（自带 Chromium + Node） |
| 界面效果 | 与网页版一致 | 与网页版一致 |
| 构建工具链 | 只需 Go；不装 Rust，不装 VS 生成工具 | Node + 打包器 |
| 系统能力 | 文件关联、右键菜单、壁纸、会话恢复 | 同 |

外壳架构、能力与命令映射见 [go-shell.md](go-shell.md)。

## 便携版（免安装目录）

`bun run build:portable` 产出 `build\portable\`：

| 文件 | 体积 | 说明 |
| --- | --- | --- |
| `Lumina.exe` | 9.8 MB | 主程序 |
| `ffmpeg.exe` | 6.2 MB | 解码兜底 sidecar（自编译最小构建，LGPL 2.1+），只在 WebView2 解不了的音轨（如 E-AC-3）时才会被 spawn |
| `LICENSE.ffmpeg.txt` | 4 KB | 随包许可证 |
| `icon.png` | 28 KB | 源图标（应用内「关于」页不引用，仅备查） |

`Lumina.exe` 与 `ffmpeg*.exe` 必须同目录：`internal/sidecar` 先在「exe 同级目录」
找它。开发期也在 `resources/` 与 `bin/` 下找，可用 `$env:LUMINA_FFMPEG` 覆盖。
需要系统已装 WebView2（Win10 1803+ / Win11 默认自带）。

> **安装包**：MyGo 0.3.7 在 Windows 上**没有跳过安装包的开关** —— `nsisCompiler`
> 会无条件下载 NSIS 并生成 `<name> Setup <version>.exe`（4 秒左右）。所以
> `build:portable` 的做法是：跑完 `mygo build` 后把安装包剔除。之所以仍然走
> `mygo build` 而不是裸 `go build`，是因为任务的图标、DPI 感知清单和版本信息都是
> MyGo 编译期生成 `.syso` 链接进 exe 的，改用 `go build` 会退回 Go 默认图标。
> 需要连安装包一起留，加 `-KeepInstaller`。

命令行参数：

```powershell
Lumina.exe                                # 启动（欢迎页）
Lumina.exe path\to\picture.jpg            # 打开指定图片/视频
Lumina.exe --register                     # 注册资源管理器右键菜单「用拾光打开」
Lumina.exe --set-default                  # 把图片/视频格式设为默认打开方式
Lumina.exe --status                       # 查看当前注册状态
Lumina.exe --unregister                   # 清除以上注册项
Lumina.exe --help                         # 全部选项
```

注册机制：

- 全部只写 `HKEY_CURRENT_USER`（`Software\Classes`、`Software\RegisteredApplications`），
  不需要管理员权限，不写 HKLM，`--unregister` 可完全清除。
- 右键菜单「用拾光打开」：Windows 11 的新版菜单不允许第三方直接插入，
  该条目显示在「**显示更多选项**」（`Shift+F10`）里。
- 注册 ProgID `Lumina.Image` / `Lumina.Video`（打开命令 + 图标）、各扩展名的
  `OpenWithProgids`、`Applications\Lumina.exe`（出现在「选择其他应用」），
  以及 `RegisteredApplications` → 默认应用列表。
- 默认打开方式：Windows 8 起用户选定的 `UserChoice` 受哈希保护。
  `--set-default` 对**尚无默认程序**的扩展名直接写 `HKCU\Software\Classes\.ext`
  立即生效；对**已被占用**的扩展名，会用官方深链接
  `ms-settings:defaultapps?registeredAppUser=Lumina` 打开设置页并定位到本程序，
  用户点一次确认即可。
- 注册表记录的是 exe 的绝对路径，移动文件夹后需要重新 `--register`。
- 这套注册与设置页里的「系统集成」开关（应用内的右键菜单 / 文件关联）
  写的是不同位置的表项，可以各自独立开关、互不覆盖。

## 开发环境

### 工具链

- **Bun ≥ 1.4**（替代 Node.js 作为运行时 + 包管理器；速度约 10×，锁文件用 `bun.lock`）
- **Go ≥ 1.27**（[go.dev/dl](https://go.dev/dl/)）
- **MyGo CLI**（`bun install` 会装上 `mygo-cli`，也可 `go install github.com/egoist/mygo/cmd/mygo@latest`）

外壳**零 CGO**，所以不需要 Visual Studio 生成工具、Rust 工具链或 cargo。
需要 Windows SDK 的只有自编译 FFmpeg sidecar 那一步。

> npm 仍可用（`npm` 命令兼容），但本项目以 Bun 为日常工具。

### 第一次构建

```bash
bun install                          # 安装依赖（首次约 35s；增量 1s 内）
bun run fetch:ffmpeg                 # 拉取 gyan 预编译版到 resources\（100 MB，仅想快速跑通用它）
bun run build:sidecar                # 从源码自编译最小 sidecar（6 MB，推荐）
bun run dev                          # 开发模式：Go 外壳 + WebView2 + Vite 热更新
bun run build:portable               # 产出免安装便携版
bun run build                        # 同上，但额外保留 NSIS 安装包
```

`bun run build:sidecar` 才是产出交付版 sidecar 的命令（需要 MSYS2 + MINGW64 工具链，
见下）。`fetch:ffmpeg` 只是应急通道：它下载的 gyan 预编译版单个 exe 就有 100 MB。

`resources\` 里的文件会被 `mygo build` 原样复制到应用目录、与 exe 并排，所以
sidecar 放这里就能自动随包分发。

### 自编译 sidecar（tools/build-sidecar.ps1）

需要 **MSYS2**（本机在 `D:\MSYS2`）及其 MINGW64 工具链：

```bash
pacman -S --needed make nasm pkgconf git \
  mingw-w64-x86_64-gcc mingw-w64-x86_64-make \
  mingw-w64-x86_64-pkgconf mingw-w64-x86_64-nasm
```

然后在 MINGW64 环境里构建（**必须是 MINGW64，ffmpeg 拒绝 MSYS 构建环境**）：

```powershell
$env:MSYSTEM='MINGW64'
bun run build:sidecar
```

脚本只编真正需要的东西（eac3/ac3/aac 解码、matroska/mov/wav 解封装、pcm_s16le
编码器、wav 复用器），其余全部关闭，产物约 6 MB。三个容易踩的坑已写进脚本注释：

- `--pkg-config-flags=--static` 缺了会动态依赖 MSYS2 的 DLL，目标机器直接
  `STATUS_DLL_NOT_FOUND`
- ffmpeg 程序依赖 `avcodec avfilter avformat threads` + 一批固定 filter
  （`aformat/anull/atrim/crop/format/hflip/null/rotate/transpose/trim/vflip`），
  `--disable-everything` 之后必须显式 `--enable-filter=...`，否则 configure
  **静默**丢掉 ffmpeg 程序，白编 200 个文件
- 脚本自带三层自检：解码器在列表里、`ldd` 无缺失 DLL、真解一次 PCM

### 构建产物

```
build\portable\                 ← bun run build:portable 的交付目录
  Lumina.exe                    ← 主程序（约 9.8 MB）
  ffmpeg-x86_64-pc-windows-msvc.exe  ← 解码兜底 sidecar（装了才有）
  LICENSE.ffmpeg.txt            ← 随包许可证
  icon.png

build\windows-amd64\            ← mygo build 的原始产物（还含 NSIS 安装包）
```

### 验证 sidecar 接缝

```bash
go test ./internal/sidecar/       # 定位 / WAV 头解析 / 未知 id 无害
```

测试自己手写 WAV 夹具，不依赖外部 ffmpeg 可执行文件；用
`$env:LUMINA_FFMPEG` 可指定别的 ffmpeg 路径做端到端验证。

### Vite 在 Windows 上的 watch 限制

Vite 的递归 watcher 会试图监听 MyGo 开发构建正在链接的可执行文件
（`.mygo/dev/...`），Go 链接时锁住该文件会抛 EBUSY。`vite.config.ts` 已通过
`server.watch.ignored: ["**/.mygo/**", "**/build/**"]` 排除，绕过此问题。

## 支持的文件

- 图片：jpg/jpeg/jfif/png/apng/gif/webp/avif/bmp/ico/svg/tif/tiff/heic/heif/jxl。
- 视频：mp4/m4v/mov/webm/mkv/avi/wmv/flv，由系统 WebView 硬件解码。
  - HEVC（H.265，iPhone 默认"高效"视频）需要系统安装「HEVC 视频扩展」并具备硬件解码。
  - 视频缩略图由同一解码器截取海报帧；解码不了时显示胶片占位图。
- 动图（GIF/APNG/动态 WebP）用 WebCodecs `ImageDecoder` 逐帧绘制（见下）。

## 桌面端独有行为

- **双击/右键"打开方式"直接进入文件**：Go 端在创建窗口前把启动文件信息通过
  preload 脚本（`window.__LUMINA_BOOT__`）注入页面，首帧渲染即是查看器，
  窗口先隐藏、首帧后再显示，避免白屏和欢迎页闪烁。
- **整棵子树扫描**：从资源管理器打开一张图片时，Go 端递归扫描
  所在目录的整棵子树（深度 ≤ 12，文件数 ≤ 2000，按路径排序）；
  这对按年份/月份组织的手机图库尤其重要——以前只能看到同目录兄弟文件。
- **EXIF Orientation 自动旋转**：手机竖屏照片带 EXIF Orientation 标签，
  Go 端读取后立即把 `Entry.width/height` 调整为视觉方向（O(1)），
  浏览器通过 `image-orientation: none` 关掉二次自动旋转，避免容器和内容方向
  不一致导致的拉伸。web 模式拖入的图片由 JS 端 `utils/orientation.ts`
  补做一次 EXIF 读取。
- **启动恢复**：设置中可开启"启动时恢复上次打开位置"；记录失效（文件被删/移动/
  磁盘不可用）时自然回退到欢迎页。
- **动图播放**：内存允许时缓存全部帧，第二轮起零解码；按帧时长计时，落后只丢帧、
  不拖慢；窗口隐藏、幻灯片、裁剪时自动暂停；不支持时回退为 `<img>`。
- **缩略图流水线**：导入时只读 header 探测尺寸；缩略图批量在 Go 端用 4 线程池
  解码/缩放/编码，整批打包成一次 IPC 调用返回（13 字节目录记录格式与旧版一致，
  只是经过 MyGo 的 JSON 桥时以 base64 传输，约 +33% 体积）。JS 端的解码完成事件
  在下一个 microtask 合并，一次 `patchMany` 写回 store。
- **系统集成**（HKCU 注册表，无需管理员）：资源管理器右键"用拾光打开"、
  文件类型关联。Windows 11 不允许程序自行成为"默认应用"，设置页会引导到系统
  默认应用页面。
- **设为桌面背景**：填充/适应/拉伸/平铺/居中五种方式。
- **屏蔽网页行为**：F5、Ctrl+R、浏览器原生右键菜单、Alt+← 后退等；
  "在新标签页中打开"隐藏。

## 图片数据管线（性能设计）

图片字节尽量不经过 JavaScript：

1. **导入**：文件选择、拖放、启动参数都只传路径。Go 端 `collectPaths`
   递归收集、并行探测尺寸；`thumbBatch` 用 4 线程池解码/缩放/编码，
   缩略图缓存在 `%LOCALAPPDATA%\Lumina\thumbs`，整批打包成一次调用
   返回。视频不走 Go，由 JS 侧用系统解码器截海报帧。
2. **显示**：原图走 `lumina://` 自定义协议（支持 HTTP Range），字节直接交给
   WebView 解码器在非主线程解码。视频也走同一协议流式播放；协议对每次响应
   都有上限，一个不带 `Range` 的大文件请求会被直接 `413` 拒绝而不是吃穿内存。
3. **编辑/导出**：只有需要画进 canvas 的那一张会调用一次 `readImage` 取同源
   Blob（协议 URL 跨源会污染画布）；加载失败时也用它兜底。

安全模型：Go 端维护一个"允许读取路径集合"，仅导入/启动时登记；`readImage`、
`thumbBatch`、`setWallpaper` 都会校验，`lumina://` 协议也走同一道闸，
前端无法读取任意文件。

## 已知边界

- exe 未签名，首次运行 SmartScreen 可能提示"未知发布者"，选择"仍要运行"即可。
- 打印"导出 PDF"复用系统打印对话框中的「Microsoft Print to PDF」，没有内置 PDF 引擎。
- Go 代码未在非 Windows 上验证；注册表与壁纸接口是 Windows 专用。
  `internal/winos` 有非 Windows 空实现，`wallpaper` 靠构建标签隔开。
- 零 CGO 意味着 AVIF / HEIC 没有解码器，缩略图只覆盖 jpg/png/gif/webp/bmp/ico/tif
  （与旧 Rust 版一致）。不过尺寸探测不受影响：Go 端读 ISOBMFF 的 `ispe` box
  和 SVG 的 `width`/`viewBox`，这些格式在图库里的布局尺寸是正确的。

更多视频相关的技术决策见 [video-decoding.md](video-decoding.md)。
