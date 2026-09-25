# 视频解码技术选型

> 状态：第一阶段已落地并随应用发布。mp4/m4v/mov/webm/mkv/avi/wmv/flv 经 asset 协议
> 交给 `<video>` 硬件解码；视频海报帧由同一解码器截取（`src/utils/videoThumb.ts`、
> Rust 端 `import_paths`/`thumb_batch`）；无解码器时显示胶片占位图。以下为决策依据。

结论：**用 WebView2 自带的 `<video>` 硬件解码，不打包 FFmpeg**，安装包体积增量约为 0，
能覆盖绝大多数手机和相机拍摄的视频。第二阶段（按需转码）见文末。

## 1. 现成能力：WebView2（Edge 内核）

| 格式 | 能否播放 | 说明 |
| --- | --- | --- |
| MP4 / M4V（H.264 + AAC） | ✅ | Edge 自带专有编解码器，通过 Media Foundation 硬件解码 |
| MOV（H.264） | ✅（实际可用） | 与 MP4 同属 ISO BMFF 容器，并非官方承诺 |
| WebM（VP8 / VP9 / AV1） | ✅ | AV1 优先硬件解码，否则软解 |
| **HEVC / H.265**（iPhone 默认"高效"格式） | ⚠️ 视设备而定 | 需要**硬件解码支持**并安装 **HEVC 视频扩展**（Microsoft Store），很多 OEM 机器已预装 |
| MKV | ⚠️ 部分可播 | Chromium 只把 WebM 这个子集作为正式支持 |
| AVI / WMV / FLV / RMVB / ProRes | ❌ | 不支持 |

已核对 Tauri 源码（`crates/tauri/src/protocol/asset.rs`）：asset 协议支持 **HTTP Range** 请求（单次响应最多约 1 MB，浏览器会连续请求），因此 `<video src={asset URL}>` 可以流式播放和拖动进度。协议还会返回 `Access-Control-Allow-Origin`，设置 `crossOrigin="anonymous"` 后可以把视频帧画到 canvas 上（例如截取封面）。

## 2. 为什么不打包 FFmpeg / libmpv

- **体积**：LGPL 版 libav* 的 DLL 约 20–60 MB，会把 6 MB 的便携版放大 5–10 倍，
  抵消选择 Tauri 的主要收益。
- **授权**：使用 GPL 组件（x264/x265）会让整个程序受 GPL 约束；自行分发 HEVC 解码器
  还涉及专利授权，这也是微软对 HEVC 扩展收费的原因。
- **画面怎么送到界面**：
  - 把原始帧经 IPC 传给 WebView：1080p30 RGBA 约 250 MB/s，不可行；
  - 实时转码成 H.264 fMP4 再用 MSE 播放：CPU 占用高、耗电，工程复杂；
  - 在 WebView 上叠一个原生窗口（libmpv）：存在"空域"问题，界面元素无法盖在视频上，
    与现有 UI 冲突。

## 3. 当前实现

- 媒体条目 `kind: 'image' | 'video'`，扩展名白名单加入 `mp4 m4v mov webm mkv`；
  Rust 的 `import_paths` 和文件关联同步支持。
- 查看器对视频使用原生 `<video controls>`，地址走 asset 协议；空格键在视频上
  改为暂停/播放。裁剪、调色、EXIF 对视频禁用。
- 视频缩略图：JS 端用 `<video>` 加载后截第一帧；Rust 端不参与（成本高、无解码器时反而失败）。
- 播放失败时（`error` 事件，或 `canPlayType` 判断不支持）给出明确提示：HEVC
  提示安装"HEVC 视频扩展"，其他格式提示"此格式不受支持，可用其他播放器打开"，
  并提供"用默认应用打开"。

## 4. 上线前要测的指标

- 4K H.264 / HEVC 60fps 播放时的丢帧率（WebView2 的 `getVideoPlaybackQuality()`）
- 播放时 GPU 视频解码引擎占用（任务管理器 → GPU → Video Decode），用来确认走的是硬件解码
- 拖动进度条到画面出现的延迟（验证 Range 请求路径）
- 1000 个视频的文件夹生成缩略图的总耗时（JS 截帧，冷缓存 / 热缓存分别测）

## 5. 第二阶段（按需）

若用户数据表明 HEVC / MKV 缺码器问题严重，再考虑：

- 不放进主可执行文件，按需下载的 FFmpeg 组件（运行期探测 + 引导下载）
- 或自带 libav* 的 HEVC 解码子集（约 5–10 MB，可承受）

时机判断：等上线 ≥ 30 天后再看用户反馈决定。