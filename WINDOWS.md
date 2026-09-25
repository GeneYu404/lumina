# Windows 桌面版（Tauri 2）— 拾光 Lumina

安装包产物名为 `Lumina`（`Lumina_1.0.0_x64-setup.exe`），窗口与托盘标题为「拾光」。

桌面版用 **Tauri 2** 打包：界面运行在 Windows 自带的 **WebView2**（与 Edge 同一内核）
中，外壳是 Rust 原生程序。

| | Tauri（本项目） | Electron |
| --- | --- | --- |
| 安装包体积 | 约 3–6 MB | 约 80–120 MB |
| 空闲内存 | 低（共享系统 WebView2） | 高（自带 Chromium + Node） |
| 界面效果 | 与网页版一致 | 与网页版一致 |

## 获取安装包（GitHub Actions）

1. 推送代码到 GitHub。
2. 在 **Actions → Tauri Windows → Run workflow** 启动构建；推送 `v*` 标签会自动构建。
3. 工作流会依次执行依赖安装、`npm run typecheck`、图标生成、`tauri build`。
4. 完成后下载 `Lumina-Windows-x64`：
   - `Lumina_1.0.0_x64-setup.exe`：安装程序（当前用户安装，无需管理员）；
   - `Lumina.exe`：免安装版（需要系统已有 WebView2，Win10/11 通常自带）。

## 在 Windows 本机构建

需要 Node.js 22 与 [Rust / MSVC 工具链](https://rustup.rs/)（安装 Rust 时会提示
安装 Visual Studio C++ 生成工具）。

```powershell
npm install
npm run icons                # 生成 src-tauri/icons（图标方案变化时才需要）
npx tauri dev                # 开发调试（热更新）
npx tauri build              # 生成安装包
npm run package:portable     # 生成安装包 + 组装便携版到 out\
```

安装包位于 `src-tauri/target/release/bundle/nsis/`。

`npm run package:portable`（`tools\package-portable.ps1`）在 `npx tauri build` 之后，
把新的 `lumina.exe` 和 `portable\` 目录里的文档、注册脚本一起组装到 `out\`，
生成一个可直接分发的便携版文件夹；`out\` 只是输出目录，不入库。

## 便携版（免安装）：右键菜单与默认打开方式

不想用安装程序时，直接拿 `src-tauri/target/release/lumina.exe` 就够了：

```powershell
lumina.exe --register     # 右键菜单 + 「打开方式」+ 默认应用入口
lumina.exe --set-default  # 在上面基础上把图片格式设为默认打开方式
lumina.exe --status       # 查看注册状态与各扩展名的归属
lumina.exe --unregister   # 清除以上注册表项
lumina.exe --help         # 命令行帮助
```

`portable\` 目录里的 `1-register.ps1` / `2-set-default.ps1` / `3-status.ps1` /
`4-unregister.ps1` 只是上述命令的包装，`PORTABLE.md` 是分发说明。

- 全部只写 `HKEY_CURRENT_USER`（`Software\Classes`、`Software\RegisteredApplications`），
  不需要管理员权限，不写 HKLM，`--unregister` 可完全清除。
- 右键菜单「用拾光打开」：Windows 11 的新版菜单不允许第三方直接插入，
  该条目显示在「**显示更多选项**」（`Shift+F10`）里。
- 注册了 ProgID `Lumina.Image` / `Lumina.Video`（打开命令 + 图标）、17 个扩展名的
  `OpenWithProgIds`、`Applications\lumina.exe`（出现在「选择其他应用」）
  以及 `RegisteredApplications` → 默认应用列表。
- 默认打开方式：Windows 8 起用户选定的 `UserChoice` 受哈希保护，微软要求只能通过
  系统设置修改。`--set-default` 对**尚无默认程序**的扩展名直接写 `HKCU\Software\Classes\.ext`
  立即生效；对**已被占用**的扩展名，会用官方深链接
  `ms-settings:defaultapps?registeredAppUser=Lumina Portable` 打开设置页并定位到本程序，
  用户点一次确认即可。
- 注册表记录的是 exe 的绝对路径，移动文件夹后需要重新 `--register`。
- 这套命令行注册与设置页里的「系统集成」开关（应用内的右键菜单 / 文件关联）
  写的是不同位置的表项，可以各自独立开关、互不覆盖。

## 支持的文件

- 图片：jpg/jpeg/png/apng/gif/webp/avif/bmp/ico/svg/tif/tiff/heic/heif/jxl。
- 视频：mp4/m4v/mov/webm/mkv/avi/wmv/flv，由系统 WebView 硬件解码。
  - HEVC（iPhone 默认“高效”视频）需要系统安装「HEVC 视频扩展」并具备硬件解码。
  - 视频缩略图由同一解码器截取海报帧；解码不了时显示胶片占位图。
- 动图（GIF/APNG/动态 WebP）用 WebCodecs `ImageDecoder` 逐帧绘制（见下）。

## 桌面端独有行为

- **双击/右键“打开方式”直接进入文件**：Rust 在创建窗口前把启动文件信息通过
  `initialization_script`（`window.__PV_BOOT__`）注入页面，首帧渲染即是查看器，
  窗口先隐藏、首帧后再显示，避免白屏和欢迎页闪烁。
- **同目录文件后台载入**：打开单个文件后，只扫描**同一文件夹**（不递归子目录，
  上限 2000 个），缩略图从当前文件向两侧分批补齐，不打断正在看的内容。
- **启动恢复**：设置中可开启“启动时恢复上次打开位置”；记录失效（文件被删/移动/
  磁盘不可用）时自然回退到欢迎页。
- **动图播放**：内存允许时缓存全部帧，第二轮起零解码；按帧时长计时，落后只丢帧、
  不拖慢；窗口隐藏、幻灯片、裁剪时自动暂停；不支持时回退为 `<img>`。
- **系统集成**（HKCU 注册表，无需管理员）：资源管理器右键“用拾光打开”、文件类型
  关联。Windows 11 不允许程序自行成为“默认应用”，设置页会引导到系统默认应用页面。
- **设为桌面背景**：填充/适应/拉伸/平铺/居中五种方式。
- 屏蔽网页行为：F5、Ctrl+R、浏览器原生右键菜单、Alt+← 后退等；“在新标签页中打开”隐藏。

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

安全模型：Rust 维护一个“允许读取路径集合”，仅导入/启动时登记；`read_image`、
`thumb_batch`、`set_wallpaper` 都会校验，前端无法读取任意文件。

## 已知边界

- 安装程序未签名，首次运行 SmartScreen 可能提示“未知发布者”，选择“仍要运行”即可。
- 打印“导出 PDF”复用系统打印对话框中的「Microsoft Print to PDF」，没有内置 PDF 引擎。
- Rust 代码未在非 Windows 上验证；注册表与壁纸接口是 Windows 专用。

更多视频相关的技术决策见 [docs/video-decoding.md](docs/video-decoding.md)。
