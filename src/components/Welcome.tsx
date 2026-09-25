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
    <div className="win-scroll relative flex h-full flex-col items-center overflow-y-auto bg-viewer px-6 py-10 text-center">
      <div className="my-auto flex flex-col items-center">
        <div className="relative mb-6">
          <div className="absolute inset-0 -z-0 scale-[1.8] rounded-full bg-accent opacity-25 blur-3xl" />
          <AppIcon size={96} className="relative drop-shadow-xl" />
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight text-fg">欢迎使用拾光</h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-fg2">
          把图片、视频或整个文件夹拖放到窗口里，或用下面的按钮开始。所有文件只在本机处理，不会上传。
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          <Button variant="accent" className="h-9 px-5" onClick={() => openFiles(true)}>
            <Plus size={16} /> 打开文件
          </Button>
          <Button className="h-9 px-5" onClick={() => openFolder(true)}>
            <FolderOpen size={16} /> 打开文件夹
          </Button>
          <Button className="h-9 px-5" onClick={() => pasteFromClipboard()}>
            <ClipboardPaste size={16} /> 粘贴图片
          </Button>
        </div>
        <div className="mt-3 text-xs text-fg3">
          <kbd className="kbd">Ctrl</kbd> + <kbd className="kbd">O</kbd> 打开文件 · <kbd className="kbd">Ctrl</kbd> +{' '}
          <kbd className="kbd">Shift</kbd> + <kbd className="kbd">O</kbd> 打开文件夹
        </div>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => loadSamples()}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-accent hover:bg-accent-soft disabled:opacity-50"
        >
          <Sparkles size={15} /> 先看看效果？加载示例图片
        </button>
        {busy && (
          <div className="animate-fade-in mt-4 flex items-center gap-2.5 text-sm text-fg2">
            <Spinner size={20} /> {busy}
          </div>
        )}
        <div className="mt-10 grid w-full max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-lg border border-stroke bg-card p-3 text-left">
              <f.icon size={18} strokeWidth={1.6} className="text-accent" />
              <div className="mt-2 text-[13px] font-medium text-fg">{f.title}</div>
              <div className="mt-0.5 text-xs leading-5 text-fg3">{f.desc}</div>
            </div>
          ))}
        </div>
        <p className="mt-8 max-w-xl text-xs leading-5 text-fg3">
          图片：JPG · PNG · GIF · WebP · AVIF · BMP · TIFF · SVG · ICO
          <br />
          视频：MP4 · MOV · WebM · MKV（播放能力取决于系统解码器）· 按 <kbd className="kbd">?</kbd> 查看全部快捷键
        </p>
      </div>
    </div>
  );
}
