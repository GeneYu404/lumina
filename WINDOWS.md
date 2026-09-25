# Windows 桌面版（Tauri 2）— 拾光 Lumina

桌面版用 **Tauri 2** 打包：界面运行在 Windows 自带的 **WebView2**（与 Edge 同一内核）
中，外壳是 Rust 原生程序。

| | Tauri（本项目） | Electron |
| --- | --- | --- |
| 安装包体积 | 约 **6 MB** 单文件（便携版）| 约 80–120 MB |
| 空闲内存 | 低（共享系统 WebView2）| 高（自带 Chromium + Node） |
| 界面效果 | 与网页版一致 | 与网页版一致 |
| 系统能力 | 文件关联、右键菜单、壁纸、会话恢复 | 同 |

## 便携版（单文件 exe）

只有一个产物：`src-tauri\target\release\lumina.exe`，约 6 MB。
需要系统已装 WebView2（Win10 1803+ / Win11 默认自带）。

命令行参数：

```powershell
lumina.exe                                # 启动（欢迎页）
lumina.exe path\to\picture.jpg            # 打开指定图片/视频
lumina.exe --register                     # 注册资源管理器右键菜单「用拾光打开」
lumina.exe --set-default                  # 把图片/视频格式设为默认打开方式
lumina.exe --status                       # 查看当前注册状态
lumina.exe --unregister                   # 清除以上注册项
lumina.exe --help                         # 全部选项
```

注册机制：

- 全部只写 `HKEY_CURRENT_USER`（`Software\Classes`、`Software\RegisteredApplications`），
  不需要管理员权限，不写 HKLM，`--unregister` 可完全清除。
- 右键菜单「用拾光打开」：Windows 11 的新版菜单不允许第三方直接插入，
  该条目显示在「**显示更多选项**」（`Shift+F10`）里。
- 注册 ProgID `Lumina.Image` / `Lumina.Video`（打开命令 + 图标）、17 个扩展名的
  `OpenWithProgids`、`Applications\lumina.exe`（出现在「选择其他应用」），
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
- **Rust ≥ 1.79**（安装 [rustup](https://rustup.rs/）时勾选 MSVC）
- **Visual Studio 生成工具 2022**（C++ 桌面开发工作负载）

> npm 仍可用（`npm` 命令兼容），但本项目以 Bun 为日常工具；如果你已装 Node，
> 直接用 Node 也可以，Bun 不是硬依赖。

### 第一次构建

```bash
bun install                          # 安装依赖（首次约 4s；增量 1s 内）
bun run icons                        # 生成 src-tauri/icons（图标方案变化时才需要）
bun run tauri dev                    # 开发模式：Rust + WebView2 + Vite 热更新
bun run tauri build                  # 产出 src-tauri\target\release\lumina.exe
```

### 构建产物

```
src-tauri\target\release\
  lumina.exe                          ← 唯一交付物
```

（NSIS 安装包不再生成——单文件 exe 已经是便携版。）

### Vite 在 Windows 上的 watch 限制

Tauri 2 + Vite 8 在 Windows 上首次构建时，Vite 的递归 watcher 会尝试监听
`src-tauri\target\debug\deps\lumina.exe`，与 Cargo 链接时锁住的文件冲突（EBUSY）。
`vite.config.ts` 已通过 `server.watch.ignored: ["**/src-tauri/**"]` 排除 Rust 工程
目录，绕过此问题。

## 支持的文件

- 图片：jpg/jpeg/jfif/png/apng/gif/webp/avif/bmp/ico/svg/tif/tiff/heic/heif/jxl。
- 视频：mp4/m4v/mov/webm/mkv/avi/wmv/flv，由系统 WebView 硬件解码。
  - HEVC（H.265，iPhone 默认"高效"视频）需要系统安装「HEVC 视频扩展」并具备硬件解码。
  - 视频缩略图由同一解码器截取海报帧；解码不了时显示胶片占位图。
- 动图（GIF/APNG/动态 WebP）用 WebCodecs `ImageDecoder` 逐帧绘制（见下）。

## 桌面端独有行为

- **双击/右键"打开方式"直接进入文件**：Rust 在创建窗口前把启动文件信息通过
  `initialization_script`（`window.__PV_BOOT__`）注入页面，首帧渲染即是查看器，
  窗口先隐藏、首帧后再显示，避免白屏和欢迎页闪烁。
- **整棵子树扫描**：从资源管理器打开一张图片时，Rust 端递归扫描
  所在目录的整棵子树（深度 ≤ 12，文件数 ≤ 2000，按路径排序）；
  这对按年份/月份组织的手机图库尤其重要——以前只能看到同目录兄弟文件。
- **EXIF Orientation 自动旋转**：手机竖屏照片带 EXIF Orientation 标签，
  Rust 端读取后立即把 `Entry.width/height` 调整为视觉方向（O(1)），
  浏览器通过 `image-orientation: none` 关掉二次自动旋转，避免容器和内容方向
  不一致导致的拉伸。web 模式拖入的图片由 JS 端 `utils/orientation.ts`
  补做一次 EXIF 读取。
- **启动恢复**：设置中可开启"启动时恢复上次打开位置"；记录失效（文件被删/移动/
  磁盘不可用）时自然回退到欢迎页。
- **动图播放**：内存允许时缓存全部帧，第二轮起零解码；按帧时长计时，落后只丢帧、
  不拖慢；窗口隐藏、幻灯片、裁剪时自动暂停；不支持时回退为 `<img>`。
- **缩略图流水线**：导入时只读 header 探测尺寸；缩略图批量在 Rust 端用 4 线程池
  解码/缩放/编码，整批打包成一次 IPC `ArrayBuffer` 返回。JS 端的解码完成事件
  在下一个 microtask 合并，一次 `patchMany` 写回 store。
- **系统集成**（HKCU 注册表，无需管理员）：资源管理器右键"用拾光打开"、
  文件类型关联。Windows 11 不允许程序自行成为"默认应用"，设置页会引导到系统
  默认应用页面。
- **设为桌面背景**：填充/适应/拉伸/平铺/居中五种方式。
- **屏蔽网页行为**：F5、Ctrl+R、浏览器原生右键菜单、Alt+← 后退等；
  "在新标签页中打开"隐藏。

## 图片数据管线（性能设计）

图片字节尽量不经过 JavaScript：

1. **导入**：文件选择、拖放、启动参数都只传路径。Rust 端 `import_paths`
   递归收集、rayon 并行探测尺寸；`thumb_batch` 用 4 线程池解码/缩放/编码，
   缩略图缓存在 `%LOCALAPPDATA%\Lumina\thumbs`，整批打包成一次 `ArrayBuffer`
   返回。视频不走 Rust，由 JS 侧用系统解码器截海报帧。
2. **显示**：原图走 Tauri asset 协议（`https://asset.localhost/...`，支持 HTTP
   Range），字节直接交给 WebView 解码器在非主线程解码。视频也走同一协议流式播放。
3. **编辑/导出**：只有需要画进 canvas 的那一张会调用一次 `read_image` 取同源 Blob
   （asset URL 跨源会污染画布）；加载失败时也用它兜底。

安全模型：Rust 维护一个"允许读取路径集合"，仅导入/启动时登记；`read_image`、
`thumb_batch`、`set_wallpaper` 都会校验，前端无法读取任意文件。

## 已知边界

- exe 未签名，首次运行 SmartScreen 可能提示"未知发布者"，选择"仍要运行"即可。
- 打印"导出 PDF"复用系统打印对话框中的「Microsoft Print to PDF」，没有内置 PDF 引擎。
- Rust 代码未在非 Windows 上验证；注册表与壁纸接口是 Windows 专用。
- 项目已从 npm 切换到 Bun；旧 `package-lock.json` 可删除（`bun install` 走 `bun.lock`）。

更多视频相关的技术决策见 [docs/video-decoding.md](docs/video-decoding.md)。