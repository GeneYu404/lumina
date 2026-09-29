import { CircleHelp, ExternalLink, FileText, Gauge, Scale } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isDesktop } from '../../desktop';
import { Dialog } from '../ui/Dialog';

/* ------------------------------------------------------------------ */
/* Codec capability self-check                                         */
/* ------------------------------------------------------------------ */

interface CodecProbe {
  id: string;
  label: string;
  type: string;
  /** What plays it today, for context in the list. */
  note: string;
}

/**
 * Probed against the *running* WebView2, not a hard-coded table: HEVC depends on
 * whether the HEVC Video Extension is installed on this machine, and the Dolby
 * question is exactly the one we had to get right before shipping an FFmpeg
 * sidecar. `canPlayType` answers what the media pipeline will accept.
 */
const CODECS: CodecProbe[] = [
  // video
  { id: 'avc1', label: 'H.264 / AVC', type: 'video/mp4; codecs="avc1.640028"', note: 'MP4 / MOV，手机与相机主力' },
  { id: 'hev1', label: 'HEVC / H.265', type: 'video/mp4; codecs="hvc1.1.6.L153.B0"', note: 'iPhone 默认格式，需系统 HEVC 扩展' },
  { id: 'vp09', label: 'VP9', type: 'video/webm; codecs="vp09.00.51.08"', note: 'WebM' },
  { id: 'vp8', label: 'VP8', type: 'video/webm; codecs="vp8"', note: 'WebM' },
  { id: 'av01', label: 'AV1', type: 'video/mp4; codecs="av01.0.08M.08"', note: '新显卡可硬解' },
  { id: 'mp4v', label: 'MPEG-4 Part 2', type: 'video/mp4; codecs="mp4v.20.8"', note: '老式 DivX / 早期 MP4' },
  { id: 'avc1-mkv', label: 'H.264 in MKV', type: 'video/x-matroska; codecs="avc1.640028"', note: 'Matroska 容器（Chromium 只正式支持 WebM 子集）' },
  // audio
  { id: 'mp4a', label: 'AAC', type: 'audio/mp4; codecs="mp4a.40.2"', note: 'MP4 / MOV 默认音轨' },
  { id: 'mp3', label: 'MP3', type: 'audio/mpeg', note: '' },
  { id: 'opus', label: 'Opus', type: 'audio/webm; codecs="opus"', note: 'WebM / MKV' },
  { id: 'flac', label: 'FLAC', type: 'audio/flac', note: '' },
  { id: 'alac', label: 'Apple Lossless', type: 'audio/mp4; codecs="alac"', note: 'iTunes / MOV' },
  { id: 'ac3', label: 'Dolby Digital (AC-3)', type: 'audio/mp4; codecs="ac-3"', note: 'DVD / 老片' },
  { id: 'eac3', label: 'Dolby Digital Plus (E-AC-3)', type: 'audio/mp4; codecs="ec-3"', note: '流媒体 / 蓝光，兜底解码的目标' },
  { id: 'dtsc', label: 'DTS', type: 'audio/mp4; codecs="dtsc"', note: '' },
];

type Verdict = 'yes' | 'maybe' | 'no';

function probe(type: string): Verdict {
  if (typeof document === 'undefined') return 'no';
  const v = document.createElement('video');
  const r = v.canPlayType(type) || (type.startsWith('audio') ? v.canPlayType(type) : '');
  if (r === 'probably') return 'yes';
  if (r === 'maybe') return 'maybe';
  return 'no';
}

const VERDICT_STYLE: Record<Verdict, { dot: string; text: string; label: string }> = {
  yes: { dot: 'bg-[#10893E]', text: 'text-[#10893E]', label: '支持' },
  maybe: { dot: 'bg-[#FFB900]', text: 'text-[#986f0b]', label: '可能' },
  no: { dot: 'bg-fg3', text: 'text-fg3', label: '不支持' },
};

function CodecTable() {
  const rows = useMemo(() => CODECS.map((c) => ({ ...c, verdict: probe(c.type) })), []);
  const missing = rows.filter((r) => r.verdict === 'no' && r.id !== 'dtsc' && r.id !== 'mp4v');

  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h4 className="text-[13px] font-semibold">本机解码能力</h4>
        <span className="text-[11px] text-fg3">由当前 WebView2 实测，不是写死的表格</span>
      </div>
      <p className="mt-1.5 text-[12px] leading-5 text-fg2">
        视频与音频优先走系统硬件解码器（Media Foundation / D3D11），没有硬件时退回软件解码。
        HEVC 是否可用取决于本机是否安装了微软的「HEVC 视频扩展」，所以每台机器都不一样。
      </p>

      <div className="mt-3 overflow-hidden rounded-md border border-stroke">
        <div className="grid grid-cols-[1fr_88px] gap-2 border-b border-stroke bg-card px-3 py-1.5 text-[11px] font-medium text-fg2">
          <span>编码</span>
          <span className="text-right">WebView2</span>
        </div>
        <div className="win-scroll max-h-[280px] overflow-y-auto">
          {rows.map((r) => {
            const s = VERDICT_STYLE[r.verdict];
            return (
              <div key={r.id} className="grid grid-cols-[1fr_88px] gap-2 border-b border-stroke/60 px-3 py-1.5 last:border-b-0">
                <div className="min-w-0">
                  <div className="text-[12.5px] text-fg">{r.label}</div>
                  {r.note && <div className="truncate text-[11px] text-fg3">{r.note}</div>}
                </div>
                <span className={`flex items-center justify-end gap-1.5 text-[12px] ${s.text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-2.5 text-[12px] leading-5 text-fg2">
        {missing.length === 0 ? (
          <>上表全部可用，<span className="text-fg">随包的 ffmpeg 目前没有用武之地</span>，可以移除。</>
        ) : (
          <>
            本机缺：{missing.map((m) => m.label).join('、')}。这些由随包的{' '}
            <span className="text-fg">ffmpeg.exe</span>（LGPL 2.1+）兜底解码，
            仅在遇到对应音轨时才会启动，不影响其余文件的零开销播放。
          </>
        )}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Third-party notices                                                 */
/* ------------------------------------------------------------------ */

interface Notice {
  name: string;
  license: string;
  why: string;
  url?: string;
  /** Full license text to show inline instead of just linking. */
  text?: string;
}

const FFMPEG_NOTICE: Notice = {
  name: 'FFmpeg',
  license: 'LGPL-2.1-or-later',
  why: '随包分发的 ffmpeg.exe：只解码 WebView2 不支持的音轨（如 E-AC-3），以独立进程运行，不与本程序链接。',
  url: 'https://ffmpeg.org/legal.html',
};

const GROUPS: { title: string; items: Notice[] }[] = [
  {
    title: '随包分发的可执行文件',
    items: [FFMPEG_NOTICE],
  },
  {
    title: '前端依赖（打包进 lumina.exe）',
    items: [
      { name: 'React · React DOM', license: 'MIT', why: '界面框架', url: 'https://github.com/facebook/react/blob/main/LICENSE' },
      { name: 'Vite', license: 'MIT', why: '构建工具（仅开发期，运行时不包含）', url: 'https://github.com/vitejs/vite/blob/main/LICENSE' },
      { name: 'TypeScript', license: 'Apache-2.0', why: '类型检查（仅开发期）', url: 'https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt' },
      { name: 'Tailwind CSS', license: 'MIT', why: '样式', url: 'https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE' },
      { name: 'Zustand', license: 'MIT', why: '状态管理', url: 'https://github.com/pmndrs/zustand/blob/main/LICENSE' },
      { name: 'lucide-react', license: 'ISC', why: '图标', url: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE' },
      { name: 'exifr', license: 'MIT', why: '读取 EXIF（拍摄参数、方向）', url: 'https://github.com/MikeKovarik/exifr/blob/master/LICENSE' },
      { name: 'clsx · tailwind-merge', license: 'MIT', why: '类名合并', url: 'https://github.com/lukeed/clsx/blob/master/LICENSE' },
    ],
  },
  {
    title: 'Rust 依赖（编译进 lumina.exe）',
    items: [
      { name: 'Tauri', license: 'MIT OR Apache-2.0', why: '桌面外壳、窗口与 IPC', url: 'https://github.com/tauri-apps/tauri/blob/dev/LICENSE' },
      { name: 'serde · serde_json', license: 'MIT OR Apache-2.0', why: 'IPC 数据序列化', url: 'https://github.com/serde-rs/serde/blob/master/LICENSE' },
      { name: 'image', license: 'MIT OR Apache-2.0', why: '缩略图解码与缩放', url: 'https://github.com/image-rs/image/blob/master/LICENSE' },
      { name: 'rayon', license: 'MIT OR Apache-2.0', why: '并行解码缩略图', url: 'https://github.com/rayon-rs/rayon/blob/master/LICENSE' },
      { name: 'kamadak-exif', license: 'MIT', why: 'EXIF 方向（竖屏照片不再被压扁）', url: 'https://github.com/kamadak-exif/kamadak-exif/blob/master/LICENSE' },
      { name: 'winreg', license: 'MIT', why: '资源管理器右键菜单、文件关联', url: 'https://github.com/rust-lang/winreg-rs/blob/master/LICENSE' },
      { name: 'windows-sys', license: 'MIT OR Apache-2.0', why: '调用 Win32 API', url: 'https://github.com/microsoft/windows-rs/blob/master/license-mit' },
    ],
  },
  {
    title: '运行时（未打包，由系统提供）',
    items: [
      {
        name: 'Microsoft Edge WebView2 Runtime',
        license: '专有（随 Windows 分发）',
        why: '界面渲染与音视频解码。需 Win10 1803+ / Win11，Win11 默认自带。',
        url: 'https://developer.microsoft.com/microsoft-edge/webview2/',
      },
    ],
  },
];

function NoticeRow({ n }: { n: Notice }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-stroke/60 last:border-b-0">
      <div className="flex items-baseline gap-2 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] text-fg">{n.name}</div>
          <div className="text-[11px] text-fg3">{n.why}</div>
        </div>
        <span className="shrink-0 rounded border border-stroke px-1.5 py-0.5 text-[10.5px] text-fg2">{n.license}</span>
        {n.url && (
          <a
            href={n.url}
            target="_blank"
            rel="noreferrer noopener"
            title={n.url}
            className="shrink-0 text-fg3 transition-colors hover:text-accent"
          >
            <ExternalLink size={13} />
          </a>
        )}
      </div>
      {n.text && open && (
        <pre className="win-scroll mb-2 max-h-48 overflow-auto rounded border border-stroke bg-card p-2 text-[10.5px] leading-4 text-fg2">
          {n.text}
        </pre>
      )}
      {n.text && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mb-1.5 flex items-center gap-1 text-[11px] text-accent hover:underline"
        >
          <FileText size={12} />
          {open ? '收起许可证全文' : '查看许可证全文'}
        </button>
      )}
    </li>
  );
}

export function LicensesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={620}
      title="关于与开源许可"
      footer={
        <p className="col-span-2 self-center text-[11px] leading-4 text-fg3">
          拾光 Lumina {isDesktop ? '1.0.0' : '（网页版）'} · 本程序不收集任何数据，图片全部在本地处理
        </p>
      }
    >
      <section className="mb-5">
        <div className="flex items-center gap-2">
          <Scale size={15} className="text-fg2" />
          <h4 className="text-[13px] font-semibold">许可与来源</h4>
        </div>
        <p className="mt-1.5 text-[12px] leading-5 text-fg2">
          本程序使用了下列开源软件。FFmpeg 以独立可执行文件的形式随包分发，
          LGPL 允许用户自由替换该文件；其完整许可证文本见分发目录中的{' '}
          <span className="font-medium text-fg">LICENSE.ffmpeg.txt</span>，
          构建参数（configure 选项）保存在仓库的 <span className="font-medium text-fg">tools/build-ffmpeg-sidecar.sh</span>，
          可据此复现同一构建。
        </p>
      </section>

      <CodecTable />

      <section className="mt-6">
        <div className="flex items-center gap-2">
          <CircleHelp size={15} className="text-fg2" />
          <h4 className="text-[13px] font-semibold">第三方组件</h4>
        </div>
        <div className="mt-2 space-y-4">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="text-[11px] font-medium uppercase tracking-wide text-fg3">{g.title}</div>
              <ul className="mt-1 border-t border-stroke">
                {g.items.map((n) => (
                  <NoticeRow key={n.name} n={n} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 flex items-start gap-2 rounded-md border border-stroke bg-card px-3 py-2.5">
        <Gauge size={14} className="mt-0.5 shrink-0 text-fg3" />
        <p className="text-[11.5px] leading-5 text-fg2">
          许可证全文随源码分发：前端依赖见 <span className="text-fg">node_modules/*/LICENSE</span>，
          Rust 依赖见 <span className="text-fg">~/.cargo/registry</span> 下各 crate 的 LICENSE-MIT / LICENSE-APACHE。
        </p>
      </section>
    </Dialog>
  );
}
