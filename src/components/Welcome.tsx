import {
  ClipboardPaste,
  Clapperboard,
  FolderOpen,
  Info,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
import { loadSamples, openFiles, openFolder, pasteFromClipboard } from '../actions';
import { useStore } from '../store';
import { Button } from './ui/Button';
import { AppIcon, Spinner } from './ui/Icons';

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: ZoomIn, title: '看图', desc: '滚轮缩放、拖动平移、动图流畅播放' },
  { icon: Clapperboard, title: '看视频', desc: 'MP4 / MOV / WebM 等，硬件解码播放' },
  { icon: SlidersHorizontal, title: '编辑与拼图', desc: '裁剪、旋转、调色，多图拼成一张' },
  { icon: Search, title: '图库与搜索', desc: '图片视频分区，按名称、时间筛选' },
  { icon: Play, title: '幻灯片放映', desc: '全屏自动播放，图片视频混排' },
  { icon: Info, title: '详细信息', desc: 'EXIF、直方图与主色调分析' },
];

export default function Welcome() {
  const busy = useStore((s) => s.busy);
  return (
    <div className="welcome win-scroll">
      <div className="welcome-inner">
        <div className="welcome-mark">
          <div className="glow" />
          <AppIcon size={96} className="welcome-mark-icon" />
        </div>
        <h1 className="welcome-title">欢迎使用拾光</h1>
        <p className="welcome-lead">
          把图片、视频或整个文件夹拖放到窗口里，或用下面的按钮开始。所有文件只在本机处理，不会上传。
        </p>
        <div className="welcome-actions">
          <Button variant="accent" className="btn--tall" onClick={() => openFiles(true)}>
            <Plus size={16} /> 打开文件
          </Button>
          <Button className="btn--tall" onClick={() => openFolder(true)}>
            <FolderOpen size={16} /> 打开文件夹
          </Button>
          <Button className="btn--tall" onClick={() => pasteFromClipboard()}>
            <ClipboardPaste size={16} /> 粘贴图片
          </Button>
        </div>
        <div className="welcome-hint">
          <kbd className="kbd">Ctrl</kbd> + <kbd className="kbd">O</kbd> 打开文件 · <kbd className="kbd">Ctrl</kbd> +{' '}
          <kbd className="kbd">Shift</kbd> + <kbd className="kbd">O</kbd> 打开文件夹
        </div>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => loadSamples()}
          className="welcome-samples"
        >
          <Sparkles size={15} /> 先看看效果？加载示例图片
        </button>
        {busy && (
          <div className="welcome-busy">
            <Spinner size={20} /> {busy}
          </div>
        )}
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature-card">
              <f.icon size={18} strokeWidth={1.6} className="u-accent" />
              <div className="feature-title">{f.title}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
        <p className="welcome-formats">
          图片：JPG · PNG · GIF · WebP · AVIF · BMP · TIFF · SVG · ICO
          <br />
          视频：MP4 · MOV · WebM · MKV（播放能力取决于系统解码器）· 按 <kbd className="kbd">?</kbd> 查看全部快捷键
        </p>
      </div>
    </div>
  );
}
