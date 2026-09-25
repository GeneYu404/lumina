import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Crop,
  ExternalLink,
  FileText,
  FlipHorizontal2,
  FlipVertical2,
  Heart,
  Image as ImageIcon,
  ImageOff,
  Images,
  Info,
  Printer,
  RotateCcw,
  RotateCw,
  Save,
  Scan,
  Shrink,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as RMouseEvent,
  type PointerEvent as RPointerEvent,
} from 'react';
import { copyFileName, copyImage, openInNewTab, requestRemove, startCrop } from '../actions';
import { readOrientationIfFile } from '../utils/orientation';
import {
  computeFitScale,
  getCurrent,
  effScale,
  fitPad,
  getVisible,
  isPannable,
  useCurrent,
  useStore,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../store';
import type { ImageItem, Point, ViewerBg } from '../types';
import { isDesktop, readItemBytes } from '../desktop';
import { cn } from '../utils/cn';
import { clamp, extOf, formatZoom } from '../utils/format';
import { blurNatural, cssFilter, temperatureColor, vignetteGradient, visualSize } from '../utils/image';
import CropOverlay from './CropOverlay';
import AnimatedImage, { animatedMime } from './AnimatedImage';
import { Spinner } from './ui/Icons';
import { Menu, type MenuEntry } from './ui/Menu';

const S = useStore.getState;

export default function Viewer() {
  const item = useCurrent();
  const view = useStore((s) => s.view);
  const viewport = useStore((s) => s.viewport);
  const settings = useStore((s) => s.settings);
  const immersive = useStore((s) => s.immersive);
  const cropMode = useStore((s) => s.cropMode);
  const comparing = useStore((s) => s.comparing);
  const total = useStore((s) => getVisible(s).length);
  const index = useStore((s) => getVisible(s).findIndex((i) => i.id === s.currentId));
  const pad = useStore((s) => fitPad(s));

  const ref = useRef<HTMLDivElement>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [animFailedUrl, setAnimFailedUrl] = useState<string | null>(null);
  const slideshow = useStore((s) => s.slideshow);
  const [grabbing, setGrabbing] = useState(false);
  const [swipeDx, setSwipeDx] = useState(0);
  const [menu, setMenu] = useState<Point | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ sx: number; sy: number; lx: number; ly: number; pan: boolean } | null>(null);
  const pinch = useRef<{ d0: number; s0: number; m0: Point; o0: Point } | null>(null);
  const lastNav = useRef(0);

  /* viewport size */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      S().setViewport(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* mouse wheel: zoom around the cursor, or navigate */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = S();
      if (s.cropMode || !getVisible(s).length) return;
      if (getCurrent(s)?.kind === 'video') return;
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 };
      let dy = e.deltaY;
      let dx = e.deltaX;
      if (e.deltaMode === 1) {
        dy *= 16;
        dx *= 16;
      } else if (e.deltaMode === 2) {
        dy *= rect.height;
        dx *= rect.width;
      }
      if (e.ctrlKey || e.metaKey || s.settings.wheelAction === 'zoom') {
        if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy) * 1.5) {
          s.panBy(-dx, 0);
          return;
        }
        s.wheelZoom(dy, anchor);
      } else {
        const now = Date.now();
        if (now - lastNav.current < 220) return;
        const d = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
        if (Math.abs(d) < 3) return;
        lastNav.current = now;
        s.step(d > 0 ? 1 : -1);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* zoom indicator */
  const prev = useRef({ tick: view.tick, id: item?.id });
  useEffect(() => {
    const p = prev.current;
    if (p.tick !== view.tick && p.id === item?.id) setFlashKey((k) => k + 1);
    prev.current = { tick: view.tick, id: item?.id };
  }, [view.tick, item?.id]);

  /* preload neighbours */
  useEffect(() => {
    if (!item) return;
    const list = getVisible(S());
    const i = list.findIndex((x) => x.id === item.id);
    [list[i + 1], list[i - 1]].forEach((n) => {
      if (n && !n.error && n.id !== item.id) {
        const im = new Image();
        im.decoding = 'async';
        im.src = n.url;
      }
    });
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeMenu = useCallback(() => setMenu(null), []);

  const toLocal = (el: HTMLElement, cx: number, cy: number): Point => {
    const rect = el.getBoundingClientRect();
    return { x: cx - rect.left - rect.width / 2, y: cy - rect.top - rect.height / 2 };
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (S().cropMode) return;
    if ((e.target as HTMLElement).closest('[data-no-pan]')) return;
    // Let the video element own its pointer (controls, seek bar); dragging the
    // letterbox around it still swipes between files.
    if (item?.kind === 'video' && (e.target as HTMLElement).closest('video')) return;
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const s = S();
      pinch.current = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        s0: effScale(s),
        m0: toLocal(el, (a.x + b.x) / 2, (a.y + b.y) / 2),
        o0: { x: s.view.fit ? 0 : s.view.ox, y: s.view.fit ? 0 : s.view.oy },
      };
      drag.current = null;
      setSwipeDx(0);
      return;
    }
    drag.current = {
      sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY,
      pan: isPannable(S()) && item?.kind !== 'video',
    };
    setGrabbing(true);
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = S();
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const p = pinch.current;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const ns = clamp(p.s0 * (d / p.d0), ZOOM_MIN, ZOOM_MAX);
      const m = toLocal(e.currentTarget, (a.x + b.x) / 2, (a.y + b.y) / 2);
      const k = ns / p.s0;
      s.setView(ns, m.x - (p.m0.x - p.o0.x) * k, m.y - (p.m0.y - p.o0.y) * k, false);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.lx;
    const dy = e.clientY - d.ly;
    d.lx = e.clientX;
    d.ly = e.clientY;
    if (d.pan) s.panBy(dx, dy);
    else if (getVisible(s).length > 1) setSwipeDx(e.clientX - d.sx);
  };

  const endPointer = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) {
        pinch.current = null;
        const rest = [...pointers.current.values()][0];
        if (rest) drag.current = { sx: rest.x, sy: rest.y, lx: rest.x, ly: rest.y, pan: isPannable(S()) };
        else {
          drag.current = null;
          setGrabbing(false);
        }
      }
      return;
    }
    if (pointers.current.size === 0) {
      const d = drag.current;
      drag.current = null;
      setGrabbing(false);
      if (d && !d.pan && e.type === 'pointerup') {
        const dist = e.clientX - d.sx;
        if (Math.abs(dist) > 70 && Math.abs(e.clientY - d.sy) < 120) S().step(dist < 0 ? 1 : -1);
      }
      setSwipeDx(0);
    }
  };

  const onDoubleClick = (e: RMouseEvent<HTMLDivElement>) => {
    if (S().cropMode) return;
    if (item?.kind === 'video') return;
    if ((e.target as HTMLElement).closest('[data-no-pan]')) return;
    S().toggleFitActual(toLocal(e.currentTarget, e.clientX, e.clientY));
  };

  const onContextMenu = (e: RMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (S().cropMode || !item) return;
    setMenu({ x: e.clientX, y: e.clientY });
  };

  /* ---------------------------- render ---------------------------- */

  const fitScale = item ? computeFitScale(item, viewport, settings.upscaleSmall, pad) : 1;
  const scale = view.fit ? fitScale : view.zoom;
  const hasDims = !!item && item.width > 0 && item.height > 0;
  const loaded = !!item && loadedUrl === item.url;
  const vis = item && hasDims ? visualSize(item) : { w: 0, h: 0 };
  const pannable = hasDims && (vis.w * scale > viewport.w + 1 || vis.h * scale > viewport.h + 1);
  const bgMode: ViewerBg = settings.viewerBg === 'theme' && immersive ? 'black' : settings.viewerBg;

  // Animated GIF/APNG/WebP play through WebCodecs (see AnimatedImage) unless
  // the image was edited (then it is a still PNG) or the decoder failed.
  const animMime =
    item && !item.error && item.url === item.originalUrl && animFailedUrl !== item.url
      ? animatedMime(item.name, item.type)
      : null;
  const animated = !!animMime;

  const handleLoaded = (w: number, h: number) => {
    if (!item) return;
    const cur = S().images.find((i) => i.id === item.id);
    if (cur && !cur.width) {
      // Desktop path items arrive with dimensions Rust already adjusted for
      // EXIF orientation. File objects opened from the web picker don't, so we
      // patch orientation once on first paint and store the *visual* size.
      const file = cur.file;
      if (file) {
        void readOrientationIfFile(file).then((rot) => {
          if (!rot || rot === 1) {
            S().setMeta(item.id, { width: w || 1024, height: h || 1024, origWidth: w, origHeight: h });
          } else {
            const swap = rot >= 5;
            const vw = swap ? h : w;
            const vh = swap ? w : h;
            S().setMeta(item.id, { width: vw || 1024, height: vh || 1024, origWidth: vw, origHeight: vh });
          }
        });
      } else {
        S().setMeta(item.id, { width: w || 1024, height: h || 1024, origWidth: w, origHeight: h });
      }
    }
    setLoadedUrl(item.url);
  };

  let wrapperStyle: CSSProperties = { position: 'absolute', left: 0, top: 0, visibility: 'hidden' };
  if (item && hasDims) {
    const dw = item.width * scale;
    const dh = item.height * scale;
    const ox = (view.fit ? 0 : view.ox) + swipeDx * 0.5;
    const oy = view.fit ? 0 : view.oy;
    const ease = 'cubic-bezier(.2,.8,.2,1)';
    wrapperStyle = {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: dw,
      height: dh,
      marginLeft: -dw / 2,
      marginTop: -dh / 2,
      transform: `translate(${ox}px, ${oy}px) rotate(${item.rotation}deg) scale(${item.flipH ? -1 : 1}, ${item.flipV ? -1 : 1})`,
      transition:
        view.anim && !grabbing
          ? `transform .28s ${ease}, width .28s ${ease}, height .28s ${ease}, margin .28s ${ease}, opacity .2s ease`
          : 'opacity .2s ease',
      opacity: loaded ? 1 : 0,
      isolation: 'isolate',
      // An animation repaints every frame: give it its own compositor layer
      // so frames never repaint the toolbar, overlays or background.
      ...(animated ? { willChange: 'transform', contain: 'layout paint' } : {}),
    };
  }

  const tc = item && !comparing ? temperatureColor(item.adjust.temperature) : null;
  const vg = item && !comparing ? vignetteGradient(item.adjust.vignette) : null;
  // The mask would be yet another decoder of the same animation: skip it for animations.
  const maskStyle: CSSProperties =
    item && !item.remote && !animated
      ? {
          WebkitMaskImage: `url("${item.url}")`,
          maskImage: `url("${item.url}")`,
          WebkitMaskSize: '100% 100%',
          maskSize: '100% 100%',
        }
      : {};

  const isVideo = !!item && item.kind === 'video';
  const menuItems: MenuEntry[] = item
    ? [
        // 文件
        { kind: 'header', label: '文件' },
        { label: '复制', icon: Copy, shortcut: 'Ctrl+C', onSelect: () => copyImage(), hidden: isVideo },
        { label: '另存为…', icon: Save, shortcut: 'Ctrl+S', onSelect: () => S().setDialog('saveAs'), hidden: isVideo },
        { label: '打印…', icon: Printer, shortcut: 'Ctrl+P', onSelect: () => S().setDialog('print'), hidden: isVideo },
        { label: '拼图…', icon: Images, onSelect: () => S().setDialog('collage'), hidden: isVideo },
        { label: '在新标签页中打开', icon: ExternalLink, onSelect: () => openInNewTab(), hidden: isDesktop },
        { label: '复制文件名', icon: FileText, onSelect: () => copyFileName() },
        { kind: 'separator' },
        // 编辑（视频没有编辑能力，整组隐藏）
        { kind: 'header', label: '编辑', hidden: isVideo },
        { label: '向左旋转', icon: RotateCcw, shortcut: 'Shift+R', onSelect: () => S().rotate(item.id, -90), hidden: isVideo },
        { label: '向右旋转', icon: RotateCw, shortcut: 'R', onSelect: () => S().rotate(item.id, 90), hidden: isVideo },
        { label: '水平翻转', icon: FlipHorizontal2, shortcut: 'H', onSelect: () => S().flip(item.id, 'h'), hidden: isVideo },
        { label: '垂直翻转', icon: FlipVertical2, shortcut: 'V', onSelect: () => S().flip(item.id, 'v'), hidden: isVideo },
        { label: '裁剪', icon: Crop, shortcut: 'C', onSelect: startCrop, hidden: isVideo },
        { label: '编辑与调整', icon: SlidersHorizontal, shortcut: 'E', onSelect: () => S().setPanel('edit'), hidden: isVideo },
        { label: '设为桌面背景…', icon: ImageIcon, onSelect: () => S().setDialog('wallpaper'), hidden: isVideo || !isDesktop },
        { kind: 'separator', hidden: isVideo },
        // 查看
        { kind: 'header', label: '查看' },
        { label: '适应窗口', icon: Shrink, shortcut: '0', onSelect: () => S().fitToWindow(), hidden: isVideo },
        { label: '实际大小 (100%)', icon: Scan, shortcut: '1', onSelect: () => S().actualSize(), hidden: isVideo },
        { label: '文件信息', icon: Info, shortcut: 'I', onSelect: () => S().setPanel('info') },
        {
          label: item.favorite ? '取消收藏' : '添加到收藏',
          icon: Heart,
          shortcut: 'Ctrl+D',
          onSelect: () => S().toggleFavorite(item.id),
        },
        // 危险操作
        { kind: 'separator' },
        { label: '从列表中移除', icon: Trash2, shortcut: 'Delete', danger: true, onSelect: () => requestRemove(item.id) },
      ]
    : [];

  return (
    <div
      ref={ref}
      className={cn(
        'group/viewer absolute inset-0 touch-none select-none overflow-hidden',
        pannable && !cropMode && (grabbing ? 'cursor-grabbing' : 'cursor-grab'),
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <ViewerBackground mode={bgMode} thumb={item?.thumb ?? null} />

      {item && !item.error && item.kind === 'video' && (
        <div key={`${item.id}|${item.url}`} className="absolute inset-0 flex items-center justify-center p-4">
          <video
            id="pv-video"
            src={item.url}
            controls
            playsInline
            preload="metadata"
            className="max-h-full max-w-full rounded-md shadow-2xl outline-none"
            style={{ opacity: loaded ? 1 : 0, transition: 'opacity .2s ease' }}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && !item.width) {
                S().setMeta(item.id, {
                  width: v.videoWidth, height: v.videoHeight,
                  origWidth: v.videoWidth, origHeight: v.videoHeight,
                });
              }
              setLoadedUrl(item.url);
            }}
            onLoadedData={() => setLoadedUrl(item.url)}
            onError={() => {
              // Same one-shot byte fallback as <img>: an asset-protocol hiccup
              // must not kill playback.
              if (isDesktop && item.path && item.url.startsWith('http')) {
                void (async () => {
                  try {
                    const blob = await readItemBytes(item.path);
                    const url = URL.createObjectURL(blob);
                    S().setMeta(item.id, { url, originalUrl: url, error: false });
                  } catch {
                    S().setMeta(item.id, { error: true });
                  }
                })();
                return;
              }
              S().setMeta(item.id, { error: true });
            }}
          />
        </div>
      )}

      {item && !item.error && item.kind !== 'video' && (
        <div key={`${item.id}|${item.url}`} style={wrapperStyle}>
          {animMime ? (
            <AnimatedImage
              key={item.url}
              src={item.url}
              mime={animMime}
              paused={slideshow || cropMode}
              className={cn('block max-w-none', hasDims && 'h-full w-full')}
              style={{
                filter: comparing ? 'none' : cssFilter(item.adjust, blurNatural(item.adjust, item.width, item.height) * scale),
                imageRendering: settings.pixelated && scale >= 3 ? 'pixelated' : 'auto',
              }}
              onReady={handleLoaded}
              onFail={() => setAnimFailedUrl(item.url)}
            />
          ) : (
          <img
            src={item.url}
            alt={item.name}
            draggable={false}
            className={cn('block max-w-none', hasDims && 'h-full w-full')}
            style={{
              filter: comparing ? 'none' : cssFilter(item.adjust, blurNatural(item.adjust, item.width, item.height) * scale),
              imageRendering: settings.pixelated && scale >= 3 ? 'pixelated' : 'auto',
              // Chromium/WebView2 rotates images according to EXIF Orientation
              // by default; pair that with a raw pixel size and the container
              // ends up rotated against its content. We report the visual size
              // ourselves (Rust for path items, `handleLoaded` for File
              // objects), so tell the engine not to also apply Orientation.
              imageOrientation: 'none',
            }}
            onLoad={(e) => handleLoaded(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
            onError={() => {
              // Asset-protocol URL can be out of scope (rare): fall back to one
              // allow-listed byte fetch instead of failing the image.
              if (isDesktop && item.path && item.url.startsWith('http')) {
                void (async () => {
                  try {
                    const blob = await readItemBytes(item.path);
                    const url = URL.createObjectURL(blob);
                    S().setMeta(item.id, { url, originalUrl: url, error: false });
                  } catch {
                    S().setMeta(item.id, { error: true });
                  }
                })();
                return;
              }
              S().setMeta(item.id, { error: true });
            }}
          />
          )}
          {tc && (
            <div className="pointer-events-none absolute inset-0" style={{ background: tc, mixBlendMode: 'soft-light', ...maskStyle }} />
          )}
          {vg && <div className="pointer-events-none absolute inset-0" style={{ background: vg, ...maskStyle }} />}
        </div>
      )}

      {item && !loaded && !item.error && (
        <div className="animate-fade-in pointer-events-none absolute inset-0 flex items-center justify-center" style={{ animationDelay: '250ms' }}>
          <Spinner size={36} />
        </div>
      )}

      {item?.error && <ErrorState item={item} />}

      {total > 1 && !cropMode && (
        <>
          {(settings.loop || index > 0) && <NavArrow side="left" solid={animated} onClick={() => S().step(-1)} />}
          {(settings.loop || index < total - 1) && <NavArrow side="right" solid={animated} onClick={() => S().step(1)} />}
        </>
      )}

      {item && hasDims && loaded && pannable && settings.showMinimap && !cropMode && (
        <Minimap item={item} scale={scale} vp={viewport} ox={view.ox} oy={view.oy} solid={animated} />
      )}

      {flashKey > 0 && item && hasDims && (
        <div key={flashKey} className="animate-zoom-flash pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg bg-black/65 px-4 py-2 text-lg font-semibold tabular-nums text-white shadow-lg backdrop-blur">
            {formatZoom(scale)}
          </div>
        </div>
      )}

      {cropMode && item && hasDims && loaded && <CropOverlay item={item} scale={scale} vp={viewport} />}

      <Menu open={!!menu} point={menu} onClose={closeMenu} items={menuItems} />
    </div>
  );
}

function ViewerBackground({ mode, thumb }: { mode: ViewerBg; thumb: string | null }) {
  if (mode === 'black') return <div className="absolute inset-0 bg-black" />;
  if (mode === 'white') return <div className="absolute inset-0 bg-white" />;
  if (mode === 'checker') return <div className="bg-checker absolute inset-0" />;
  return (
    <div className="absolute inset-0 overflow-hidden bg-viewer">
      {mode === 'ambient' && thumb && (
        <img
          src={thumb}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 h-full w-full max-w-none scale-125 object-cover opacity-55 blur-[80px] saturate-150"
        />
      )}
    </div>
  );
}

function NavArrow({ side, onClick, solid }: { side: 'left' | 'right'; onClick: () => void; solid?: boolean }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      data-no-pan
      type="button"
      aria-label={side === 'left' ? '上一张' : '下一张'}
      title={side === 'left' ? '上一张 (←)' : '下一张 (→)'}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'absolute top-1/2 z-10 flex h-16 w-10 -translate-y-1/2 items-center justify-center rounded-md border border-stroke text-fg opacity-0 shadow-flyout transition-opacity duration-200 hover:bg-card-hover focus-visible:opacity-100 group-hover/viewer:opacity-100',
        // Over an animation a backdrop blur is re-computed every frame: go solid.
        solid ? 'bg-card' : 'bg-acrylic backdrop-blur-xl',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      <Icon size={22} strokeWidth={1.5} />
    </button>
  );
}

function ErrorState({ item }: { item: ImageItem }) {
  const ext = extOf(item.name);
  const special = ['heic', 'heif', 'tif', 'tiff', 'jxl'].includes(ext);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-fg2">
      <ImageOff size={52} strokeWidth={1.1} />
      <div className="text-base font-medium text-fg">无法显示此图片</div>
      <div className="max-w-sm text-xs leading-5">
        “{item.name}” 可能已损坏，或者当前浏览器不支持此格式
        {special ? `（.${ext} 格式需要浏览器原生支持）` : ''}。
      </div>
    </div>
  );
}

function Minimap({
  item,
  scale,
  vp,
  ox,
  oy,
  solid,
}: {
  item: ImageItem;
  scale: number;
  vp: { w: number; h: number };
  ox: number;
  oy: number;
  solid?: boolean;
}) {
  const { w: ew, h: eh } = visualSize(item);
  const W = ew * scale;
  const H = eh * scale;
  const m = 160 / Math.max(ew, eh);
  const mw = ew * m;
  const mh = eh * m;
  const k = m / scale;
  const left = W / 2 - ox - vp.w / 2;
  const top = H / 2 - oy - vp.h / 2;
  const x0 = Math.max(0, left);
  const y0 = Math.max(0, top);
  const x1 = Math.min(W, left + vp.w);
  const y1 = Math.min(H, top + vp.h);
  const rect = { x: x0 * k, y: y0 * k, w: Math.max(4, (x1 - x0) * k), h: Math.max(4, (y1 - y0) * k) };
  const iw = item.width * m;
  const ih = item.height * m;

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget;
    const box = el.getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    const go = (cx: number, cy: number) => {
      const px = clamp(cx - box.left, 0, mw) / k;
      const py = clamp(cy - box.top, 0, mh) / k;
      const s = S();
      s.setView(effScale(s), W / 2 - px, H / 2 - py, false);
    };
    go(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => go(ev.clientX, ev.clientY);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <div
      data-no-pan
      className={cn(
        'animate-fade-in absolute bottom-3 right-3 z-10 rounded-lg border border-stroke p-1.5 shadow-flyout',
        solid ? 'bg-card' : 'bg-acrylic backdrop-blur-xl',
      )}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="relative cursor-crosshair overflow-hidden rounded bg-subtle" style={{ width: mw, height: mh }} onPointerDown={onPointerDown}>
        {/* Static thumbnail only — the original would be one more decoder of an animation. */}
        {item.thumb && (
        <img
          src={item.thumb}
          alt=""
          draggable={false}
          className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
          style={{
            width: iw,
            height: ih,
            marginLeft: -iw / 2,
            marginTop: -ih / 2,
            transform: `rotate(${item.rotation}deg) scale(${item.flipH ? -1 : 1}, ${item.flipV ? -1 : 1})`,
          }}
        />
        )}
        <div
          className="pointer-events-none absolute rounded-[2px] border-2 border-accent"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, boxShadow: '0 0 0 999px rgba(0,0,0,0.45)' }}
        />
      </div>
    </div>
  );
}
