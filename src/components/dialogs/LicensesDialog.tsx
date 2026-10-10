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
  yes: { dot: 'lic-dot--yes', text: 'lic-verdict--yes', label: '支持' },
  maybe: { dot: 'lic-dot--maybe', text: 'lic-verdict--maybe', label: '可能' },
  no: { dot: 'lic-dot--no', text: 'lic-verdict--no', label: '不支持' },
};

function CodecTable() {
  const rows = useMemo(() => CODECS.map((c) => ({ ...c, verdict: probe(c.type) })), []);
  const missing = rows.filter((r) => r.verdict === 'no' && r.id !== 'dtsc' && r.id !== 'mp4v');

  return (
    <section>
      <div className="lic-head lic-head--baseline">
        <h4 className="lic-title">本机解码能力</h4>
        <span className="lic-sub">由当前 WebView2 实测，不是写死的表格</span>
      </div>
      <p className="lic-p">
        视频与音频优先走系统硬件解码器（Media Foundation / D3D11），没有硬件时退回软件解码。
        HEVC 是否可用取决于本机是否安装了微软的「HEVC 视频扩展」，所以每台机器都不一样。
      </p>

      <div className="lic-table">
        <div className="lic-table-head">
          <span>编码</span>
          <span>WebView2</span>
        </div>
        <div className="lic-table-body win-scroll">
          {rows.map((r) => {
            const s = VERDICT_STYLE[r.verdict];
            return (
              <div key={r.id} className="lic-table-row">
                <div className="lic-name">
                  <div className="lic-name-main">{r.label}</div>
                  {r.note && <div className="lic-name-note">{r.note}</div>}
                </div>
                <span className={`lic-verdict ${s.text}`}>
                  <span className={`lic-dot ${s.dot}`} />
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="lic-p lic-p--gap">
        {missing.length === 0 ? (
          <>上表全部可用，<span className="lic-strong">随包的 ffmpeg 目前没有用武之地</span>，可以移除。</>
        ) : (
          <>
            本机缺：{missing.map((m) => m.label).join('、')}。这些由随包的{' '}
            <span className="lic-strong">ffmpeg.exe</span>（LGPL 2.1+）兜底解码，
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
    title: '前端依赖（打包进 Lumina.exe）',
    items: [
      { name: 'React · React DOM', license: 'MIT', why: '界面框架（经 Preact 兼容层运行）', url: 'https://github.com/facebook/react/blob/main/LICENSE' },
      { name: 'Preact', license: 'MIT', why: 'React 兼容层，实际承担渲染', url: 'https://github.com/preactjs/preact/blob/main/LICENSE' },
      { name: 'Zustand', license: 'MIT', why: '状态管理', url: 'https://github.com/pmndrs/zustand/blob/main/LICENSE' },
      { name: 'lucide-react', license: 'ISC', why: '图标', url: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE' },
      { name: 'exifr', license: 'MIT', why: '读取 EXIF（拍摄参数、方向）', url: 'https://github.com/MikeKovarik/exifr/blob/master/LICENSE' },
      { name: 'clsx', license: 'MIT', why: '类名合并', url: 'https://github.com/lukeed/clsx/blob/master/LICENSE' },
      { name: 'mygo-runtime', license: 'MIT', why: '页面侧的运行时桥（仅桌面版打包）', url: 'https://github.com/egoist/mygo/blob/master/LICENSE' },
      { name: 'Vite · vite-plugin-singlefile', license: 'MIT', why: '构建工具（仅开发期，运行时不包含）', url: 'https://github.com/vitejs/vite/blob/main/LICENSE' },
      { name: 'TypeScript', license: 'Apache-2.0', why: '类型检查（仅开发期）', url: 'https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt' },
    ],
  },
  {
    title: 'Go 依赖（编译进 Lumina.exe）',
    items: [
      { name: 'MyGo', license: 'MIT', why: '桌面外壳：窗口、WebView2、类型化 IPC', url: 'https://github.com/egoist/mygo/blob/master/LICENSE' },
      { name: 'purego', license: 'MIT', why: 'MyGo 用来在无 cgo 前提下调用系统原生接口', url: 'https://github.com/ebitengine/purego/blob/master/LICENSE' },
      { name: 'golang.org/x/image', license: 'BSD-3-Clause', why: 'WebP / TIFF / BMP 解码与缩放', url: 'https://cs.opensource.google/go/x/image/LICENSE' },
      { name: 'golang.org/x/sys', license: 'BSD-3-Clause', why: 'Windows 注册表与系统调用', url: 'https://cs.opensource.google/go/x/sys/LICENSE' },
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
    <li className="lic-item">
      <div className="lic-item-head">
        <div className="lic-item-body">
          <div className="lic-item-name">{n.name}</div>
          <div className="lic-item-why">{n.why}</div>
        </div>
        <span className="lic-license">{n.license}</span>
        {n.url && (
          <a
            href={n.url}
            target="_blank"
            rel="noreferrer noopener"
            title={n.url}
            className="lic-link"
          >
            <ExternalLink size={13} />
          </a>
        )}
      </div>
      {n.text && open && (
        <pre className="lic-pre win-scroll">
          {n.text}
        </pre>
      )}
      {n.text && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="lic-toggle"
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
        <p className="lic-foot">
          拾光 Lumina {isDesktop ? '1.0.0' : '（网页版）'} · 本程序不收集任何数据，图片全部在本地处理
        </p>
      }
    >
      <section className="lic-section">
        <div className="lic-head">
          <Scale size={15} className="u-fg2" />
          <h4 className="lic-title">许可与来源</h4>
        </div>
        <p className="lic-p">
          本程序使用了下列开源软件。FFmpeg 以独立可执行文件的形式随包分发，
          LGPL 允许用户自由替换该文件；其完整许可证文本见分发目录中的{' '}
          <span className="lic-strong">LICENSE.ffmpeg.txt</span>，
          构建参数（configure 选项）保存在仓库的 <span className="lic-strong">tools/build-ffmpeg-sidecar.sh</span>，
          可据此复现同一构建。
        </p>
      </section>

      <CodecTable />

      <section className="lic-section lic-section--gap">
        <div className="lic-head">
          <CircleHelp size={15} className="u-fg2" />
          <h4 className="lic-title">第三方组件</h4>
        </div>
        <div className="lic-groups">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="lic-group-title">{g.title}</div>
              <ul className="lic-list">
                {g.items.map((n) => (
                  <NoticeRow key={n.name} n={n} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="lic-note">
        <Gauge size={14} className="lic-note-icon" />
        <p>
          许可证全文随源码分发：前端依赖见 <span className="lic-strong">node_modules/*/LICENSE</span>，
          Go 依赖见 <span className="lic-strong">go.sum</span> 列出的各模块，其 LICENSE 随
          Go module 缓存（<span className="lic-strong">$(go env GOMODCACHE)</span>）分发。
          桌面外壳为纯 Go、零 cgo，可在任意机器上交叉编译。
        </p>
      </section>
    </Dialog>
  );
}
