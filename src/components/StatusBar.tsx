import { Film, Image as ImageIcon, Minus, Plus, Scan, Shrink } from 'lucide-react';
import { effScale, getVisible, useCurrent, useStore, ZOOM_MAX, ZOOM_MIN } from '../store';
import { cn } from '../utils/cn';
import { formatBytes, formatZoom } from '../utils/format';
import { isEdited } from '../utils/image';
import { Sep, ToolButton } from './ui/Button';
import { Segmented, Slider } from './ui/Controls';
import { Menu, useMenuState, type MenuEntry } from './ui/Menu';

const S = useStore.getState;
const LMIN = Math.log(ZOOM_MIN);
const LMAX = Math.log(ZOOM_MAX);
const toSlider = (sc: number) => Math.round(((Math.log(Math.max(sc, ZOOM_MIN)) - LMIN) / (LMAX - LMIN)) * 1000);
const fromSlider = (v: number) => {
  const s = Math.exp(LMIN + (v / 1000) * (LMAX - LMIN));
  return Math.abs(s - 1) < 0.04 ? 1 : s;
};

function Dot() {
  return <span className="h-1 w-1 shrink-0 rounded-full bg-fg3" />;
}

export default function StatusBar() {
  const mode = useStore((s) => s.mode);
  const item = useCurrent();
  const total = useStore((s) => getVisible(s).length);
  const index = useStore((s) => getVisible(s).findIndex((i) => i.id === s.currentId));
  const scale = useStore((s) => effScale(s));
  const fit = useStore((s) => s.view.fit);
  const showFilm = useStore((s) => s.settings.showFilmstrip);
  const favCount = useStore((s) => s.images.reduce((n, i) => n + (i.favorite ? 1 : 0), 0));
  const allCount = useStore((s) => s.images.length);
  const thumbSize = useStore((s) => s.settings.thumbSize);
  const cover = useStore((s) => s.settings.galleryCover);
  const zoomMenu = useMenuState();

  const presets: MenuEntry[] = [
    { label: '适应窗口', shortcut: '0', checked: fit, onSelect: () => S().fitToWindow() },
    { kind: 'separator' },
    ...[0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8].map(
      (z): MenuEntry => ({
        label: `${Math.round(z * 100)}%`,
        shortcut: z === 1 ? '1' : undefined,
        checked: !fit && Math.abs(scale - z) < 0.001,
        onSelect: () => S().zoomTo(z),
      }),
    ),
  ];

  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-t border-stroke bg-app px-3 text-xs text-fg2">
      {mode === 'viewer' && item ? (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 tabular-nums text-fg">
            {index + 1} / {total}
          </span>
          {item.width > 0 && (
            <>
              <Dot />
              <span className="shrink-0 tabular-nums">
                {item.width} × {item.height}
              </span>
            </>
          )}
          {item.size > 0 && (
            <span className="hidden shrink-0 items-center gap-2.5 sm:flex">
              <Dot />
              {formatBytes(item.size)}
            </span>
          )}
          <span className="hidden min-w-0 items-center gap-2.5 lg:flex">
            <Dot />
            <span className="truncate">{item.path}</span>
          </span>
          {isEdited(item) && (
            <span className="hidden shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent md:inline">已编辑</span>
          )}
        </div>
      ) : (
        <span className="truncate">
          {total} 项{mode === 'gallery' && total !== allCount ? `（共 ${allCount} 项）` : ''}
          {favCount ? ` · ${favCount} 个收藏` : ''}
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {mode === 'viewer' ? (
          <>
            <ToolButton
              icon={Film}
              label={showFilm ? '隐藏胶片栏' : '显示胶片栏'}
              shortcut="T"
              size="sm"
              tipSide="top"
              active={showFilm}
              onClick={() => S().setSetting('showFilmstrip', !showFilm)}
            />
            <Sep />
            <ToolButton icon={Minus} label="缩小" size="sm" tipSide="top" onClick={() => S().zoomStep(-1)} />
            <Slider
              ariaLabel="缩放"
              className="hidden w-28 sm:block"
              min={0}
              max={1000}
              value={toSlider(scale)}
              onChange={(v) => S().zoomTo(fromSlider(v), undefined, false)}
            />
            <ToolButton icon={Plus} label="放大" size="sm" tipSide="top" onClick={() => S().zoomStep(1)} />
            <button
              type="button"
              onClick={(e) => zoomMenu.toggle(e.currentTarget)}
              className={cn('h-7 min-w-[56px] rounded-md px-1.5 tabular-nums text-fg hover:bg-subtle', zoomMenu.open && 'bg-subtle')}
            >
              {formatZoom(scale)}
            </button>
            <ToolButton
              icon={fit ? Scan : Shrink}
              label={fit ? '实际大小' : '适应窗口'}
              size="sm"
              tipSide="top"
              tipAlign="end"
              onClick={() => (fit ? S().actualSize() : S().fitToWindow())}
            />
          </>
        ) : (
          <>
            <Segmented
              className="hidden sm:inline-flex"
              value={cover ? 'cover' : 'contain'}
              options={[
                { value: 'cover', label: '方形' },
                { value: 'contain', label: '完整' },
              ]}
              onChange={(v) => S().setSetting('galleryCover', v === 'cover')}
            />
            <Sep className="hidden sm:block" />
            <ImageIcon size={12} className="text-fg3" />
            <Slider
              ariaLabel="缩略图大小"
              className="w-28"
              min={96}
              max={320}
              step={8}
              value={thumbSize}
              onChange={(v) => S().setSetting('thumbSize', v)}
            />
            <ImageIcon size={17} className="text-fg3" />
          </>
        )}
      </div>
      <Menu open={zoomMenu.open} anchor={zoomMenu.anchor} onClose={zoomMenu.close} items={presets} align="end" minWidth={180} />
    </div>
  );
}
