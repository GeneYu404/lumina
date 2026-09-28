# 视频解码技术选型

> 状态：**第一阶段**已落地——mp4/m4v/mov/webm/mkv/avi/wmv/flv 经 asset 协议交给
> `<video>` 硬件解码；视频海报帧由同一解码器截取（`src/utils/videoThumb.ts`、Rust 端
> `collect_paths`/`thumb_batch`）。**第二阶段已开工**：随包携带一个 FFmpeg 进程
> （sidecar）为 Media Foundation 解不了的音轨兜底，当前只落地了接缝
> （`src-tauri/src/ffmpeg_sidecar.rs` + `ffmpeg_probe` 命令），播放管线待接。
> 决策依据见下。

结论：**主播放路径用 WebView2 自带的 `<video>` 硬件解码**（体积增量为 0，覆盖绝大多数
手机与相机视频）；**兜底路径随包携带 FFmpeg**（独立进程，非 FFI 链接），只为
WebView 解不了的音轨——首个目标是 **E-AC-3（Dolby Digital Plus）**。

## 0. 为什么兜底用「进程」而不是「DLL」

评估过三种形态：

| 方案 | 体积 | Rust 侧成本 | 结论 |
| --- | --- | --- | --- |
| 只用 WebView2 | 0 | 无 | E-AC-3 直接播不了，放弃 |
| FFmpeg DLL + FFI 链接 | 与 exe 同量级 | 需 `unsafe` FFI + Windows import lib（MSYS2 的 MinGW 产物与 msvc ABI 不通，得走 vcpkg） | 成本高、无体积优势，否决 |
| **FFmpeg exe sidecar** | 最小化构建 6.2 MB（实测）| `spawn` + 管道，零 unsafe | **采用** |

关键认知：**体积由 configure 裁剪决定，与静态/动态无关**。gyan 的 release-essentials
预编译版里单个 `ffmpeg.exe` 就有 100 MB（另含 ffplay/ffprobe 各 100 MB），必须自己
`--disable-everything` 最小化编译才适合随包分发。实测自编译产物 **6.2 MB**，
整个免安装目录 12.5 MB，许可证纯 LGPL 2.1+（比预编译版的 GPL 组件更干净）。
构建脚本见 `tools/build-ffmpeg-sidecar.sh`，入口 `bun run build:sidecar`。

## 1. 现成能力：WebView2（Edge 内核）

| 格式 | 能否播放 | 说明 |
| --- | --- | --- |
| MP4 / M4V（H.264 + AAC） | ✅ | Edge 自带专有编解码器，通过 Media Foundation 硬件解码 |
| MOV（H.264） | ✅（实际可用） | 与 MP4 同属 ISO BMFF 容器，并非官方承诺 |
| WebM（VP8 / VP9 / AV1） | ✅ | AV1 优先硬件解码，否则软解 |
| **HEVC / H.265**（iPhone 默认"高效"格式） | ⚠️ 视设备而定 | 需要**硬件解码支持**并安装 **HEVC 视频扩展**（Microsoft Store），很多 OEM 机器已预装 |
| MKV | ⚠️ 部分可播 | Chromium 只把 WebM 这个子集作为正式支持 |
| AVI / WMV / FLV / RMVB / ProRes | ❌ | 不支持 |
| **E-AC-3 / Dolby Digital Plus** | ❌ | Media Foundation 无内置解码器 → 走 sidecar 兜底 |

已核对 Tauri 源码（`crates/tauri/src/protocol/asset.rs`）：asset 协议支持 **HTTP Range** 请求（单次响应最多约 1 MB，浏览器会连续请求），因此 `<video src={asset URL}>` 可以流式播放和拖动进度。协议还会返回 `Access-Control-Allow-Origin`，设置 `crossOrigin="anonymous"` 后可以把视频帧画到 canvas 上（例如截取封面）。

## 2. 为什么不把 FFmpeg 链进主程序

- **体积**：libav* 全量 DLL 约 20–60 MB。缓解办法是自编译最小构建（只留 eac3
  解码 + mkv/mp4 demux + s16le 输出，实测可压到 5–15 MB），但这要求团队自己维护
  一条 MSYS2 构建链。
- **授权**：以**独立进程**分发时，FFmpeg 自身的 LGPL/GPL 义务与本程序互不牵连
  （不构成衍生作品）；若改成 FFI 链接，合规说明会复杂得多，也是选择 sidecar 的原因之一。
- **画面怎么送到界面**（这仍是不能自研解码器的原因）：
  - 把原始帧经 IPC 传给 WebView：1080p30 RGBA 约 250 MB/s，不可行；
  - 实时转码成 H.264 fMP4 再用 MSE 播放：CPU 占用高、耗电，工程复杂；
  - 在 WebView 上叠一个原生窗口（libmpv）：存在"空域"问题，界面元素无法盖在视频上，
    与现有 UI 冲突。

## 3. 当前实现

### 主路径（WebView2）

- 媒体条目 `kind: 'image' | 'video'`，扩展名白名单加入 `mp4 m4v mov webm mkv`；
  Rust 的 `collect_paths` 和文件关联同步支持。
- 查看器对视频使用原生 `<video controls>`，地址走 asset 协议；空格键在视频上
  改为暂停/播放。裁剪、调色、EXIF 对视频禁用。
- 视频缩略图：JS 端用 `<video>` 加载后截第一帧；Rust 端不参与（成本高、无解码器时反而失败）。
- 播放失败时（`error` 事件，或 `canPlayType` 判断不支持）给出明确提示：HEVC
  提示安装"HEVC 视频扩展"，其他格式提示"此格式不受支持，可用其他播放器打开"，
  并提供"用默认应用打开"。

### 兜底路径（FFmpeg sidecar，接缝已通）

- 随包携带 `ffmpeg-x86_64-pc-windows-msvc.exe`（Tauri `externalBin`，构建时落在
  可执行文件同级）。获取方式：`bun run fetch:ffmpeg`。
- `src-tauri/src/ffmpeg_sidecar.rs` 负责定位（`$LUMINA_FFMPEG` → exe 同级 →
  profile 目录 → `bin/`）、spawn 与解码；解码命令固定为
  `-map 0:a:0 -f s16le -ac 2 -ar 48000 -`，stdout 即 PCM。
- `ffmpeg_probe` 命令对已登记路径做一次接缝检查，返回
  `{ available, hasEac3, pcmBytes, detail }`；读取上限 4 MB 后主动 kill，避免
  把探针变成整片解码。
- 单元测试（`cargo test ffmpeg_sidecar`）由 Rust 手写 1 秒正弦 WAV 当输入，解回 PCM
  并校验 WAV 头里读出的采样率/声道，覆盖「定位 → spawn → 解码 → eac3 解码器存在」
  四件事。这样 fixture 不依赖 lavfi/sine 滤镜，最小构建照样能跑测试。
- **已完成体积目标**：100 MB 预编译版 → 6.2 MB 自编译最小构建（`bun run build:sidecar`）。
- **未完成**：把 PCM 接到前端（WebAudio/AudioWorklet）与视频画面的 A/V 同步。

## 4. 上线前要测的指标

- 4K H.264 / HEVC 60fps 播放时的丢帧率（WebView2 的 `getVideoPlaybackQuality()`）
- 播放时 GPU 视频解码引擎占用（任务管理器 → GPU → Video Decode），用来确认走的是硬件解码
- 拖动进度条到画面出现的延迟（验证 Range 请求路径）
- 1000 个视频的文件夹生成缩略图的总耗时（JS 截帧，冷缓存 / 热缓存分别测）
- E-AC-3 走 sidecar 时的首帧延迟与 CPU 占用（管线接通后补测）

## 5. 待办

- 接通播放：Rust 侧流式输出 PCM → 前端 AudioWorklet 环形缓冲 → 与 `<video muted>`
  的 `currentTime` 对齐；WebCodecs 的 `AudioDecoder` 不支持 eac3，PCM 是唯一接缝。
- 何时启用兜底：仅在 `media_info` 报出 WebView 解不了的音轨时 spawn sidecar，
  正常文件仍走零成本的主路径。
