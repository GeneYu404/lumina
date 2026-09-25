import { Check, RotateCcw, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { useStore } from '../store';
import type { ImageItem } from '../types';
import { cn } from '../utils/cn';
import { clamp } from '../utils/format';
import { canvasToBlob, normRot, renderItem, visualSize } from '../utils/image';
import { Button, ToolButton } from './ui/Button';

const S = useStore.getState;

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
interface R {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN = 24;

const ASPECTS: { key: string; label: string; ratio: number | 'original' | null }[] = [
  { key: 'free', label: '自由', ratio: null },
  { key: 'original', label: '原始比例', ratio: 'original' },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
  { key: '3:2', label: '3:2', ratio: 3 / 2 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: '3:4', label: '3:4', ratio: 3 / 4 },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
];

function resolveRatio(key: string, ew: number, eh: number): number | null {
  const a = ASPECTS.find((x) => x.key === key);
  if (!a || a.ratio === null) return null;
  if (a.ratio === 'original') return ew / eh;
  return a.ratio;
}

function computeRect(handle: Handle, r0: R, dx: number, dy: number, W: number, H: number, ratio: number | null): R {
  if (handle === 'move') {
    return { ...r0, x: clamp(r0.x + dx, 0, W - r0.w), y: clamp(r0.y + dy, 0, H - r0.h) };
  }
  const hasW = handle.includes('w');
  const hasE = handle.includes('e');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');
  let left = r0.x;
  let top = r0.y;
  let right = r0.x + r0.w;
  let bottom = r0.y + r0.h;
  if (hasW) left = clamp(left + dx, 0, right - MIN);
  if (hasE) right = clamp(right + dx, left + MIN, W);
  if (hasN) top = clamp(top + dy, 0, bottom - MIN);
  if (hasS) bottom = clamp(bottom + dy, top + MIN, H);
  if (!ratio) return { x: left, y: top, w: right - left, h: bottom - top };

  const horiz = hasW || hasE;
  const vert = hasN || hasS;
  let w = right - left;
  let h = bottom - top;
  if (horiz && !vert) h = w / ratio;
  else if (vert && !horiz) w = h * ratio;
  else if (Math.abs(dx) >= Math.abs(dy)) h = w / ratio;
  else w = h * ratio;

  const cx = r0.x + r0.w / 2;
  const cy = r0.y + r0.h / 2;
  const maxW = horiz ? (hasW ? r0.x + r0.w : W - r0.x) : 2 * Math.min(cx, W - cx);
  const maxH = vert ? (hasN ? r0.y + r0.h : H - r0.y) : 2 * Math.min(cy, H - cy);
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  const x = horiz ? (hasW ? r0.x + r0.w - w : r0.x) : cx - w / 2;
  const y = vert ? (hasN ? r0.y + r0.h - h : r0.y) : cy - h / 2;
  return { x, y, w, h };
}

const HANDLES: { h: Handle; cursor: string; pos: (r: R) => CSSProperties }[] = [
  { h: 'nw', cursor: 'nwse-resize', pos: (r) => ({ left: r.x - 12, top: r.y - 12 }) },
  { h: 'ne', cursor: 'nesw-resize', pos: (r) => ({ left: r.x + r.w - 12, top: r.y - 12 }) },
  { h: 'sw', cursor: 'nesw-resize', pos: (r) => ({ left: r.x - 12, top: r.y + r.h - 12 }) },
  { h: 'se', cursor: 'nwse-resize', pos: (r) => ({ left: r.x + r.w - 12, top: r.y + r.h - 12 }) },
  { h: 'n', cursor: 'ns-resize', pos: (r) => ({ left: r.x + r.w / 2 - 12, top: r.y - 12 }) },
  { h: 's', cursor: 'ns-resize', pos: (r) => ({ left: r.x + r.w / 2 - 12, top: r.y + r.h - 12 }) },
  { h: 'w', cursor: 'ew-resize', pos: (r) => ({ left: r.x - 12, top: r.y + r.h / 2 - 12 }) },
  { h: 'e', cursor: 'ew-resize', pos: (r) => ({ left: r.x + r.w - 12, top: r.y + r.h / 2 - 12 }) },
];

function HandleVisual({ h }: { h: Handle }) {
  const base = 'absolute border-white drop-shadow-[0_0_2px_rgba(0,0,0,0.7)]';
  switch (h) {
    case 'nw':
      return <span className={cn(base, 'left-[10px] top-[10px] h-4 w-4 border-l-[3px] border-t-[3px]')} />;
    case 'ne':
      return <span className={cn(base, 'right-[10px] top-[10px] h-4 w-4 border-r-[3px] border-t-[3px]')} />;
    case 'sw':
      return <span className={cn(base, 'bottom-[10px] left-[10px] h-4 w-4 border-b-[3px] border-l-[3px]')} />;
    case 'se':
      return <span className={cn(base, 'bottom-[10px] right-[10px] h-4 w-4 border-b-[3px] border-r-[3px]')} />;
    case 'n':
    case 's':
      return <span className="absolute left-1/2 top-1/2 h-[4px] w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_2px_rgba(0,0,0,0.7)]" />;
    default:
      return <span className="absolute left-1/2 top-1/2 h-5 w-[4px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_2px_rgba(0,0,0,0.7)]" />;
  }
}

export default function CropOverlay({ item, scale, vp }: { item: ImageItem; scale: number; vp: { w: number; h: number } }) {
  const { w: ew, h: eh } = visualSize(item);
  const W = ew * scale;
  const H = eh * scale;
  const [frac, setFrac] = useState<R>({ x: 0, y: 0, w: 1, h: 1 });
  const [aspect, setAspect] = useState('free');
  const [busy, setBusy] = useState(false);
  const ratio = resolveRatio(aspect, ew, eh);
  const px: R = { x: frac.x * W, y: frac.y * H, w: frac.w * W, h: frac.h * H };

  useEffect(() => {
    setFrac({ x: 0, y: 0, w: 1, h: 1 });
    setAspect('free');
  }, [item.id, item.rotation]);

  const setPx = (r: R) => setFrac({ x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H });

  const chooseAspect = (key: string) => {
    setAspect(key);
    const r = resolveRatio(key, ew, eh);
    if (!r) return;
    let w = W;
    let h = W / r;
    if (h > H) {
      h = H;
      w = H * r;
    }
    setPx({ x: (W - w) / 2, y: (H - h) / 2, w, h });
  };

  const startDrag = (handle: Handle) => (e: RPointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const r0 = { ...px };
    const move = (ev: PointerEvent) => setPx(computeRect(handle, r0, ev.clientX - sx, ev.clientY - sy, W, H, ratio));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const apply = async () => {
    if (busy) return;
    const crop = {
      x: Math.round(frac.x * ew),
      y: Math.round(frac.y * eh),
      w: Math.max(1, Math.round(frac.w * ew)),
      h: Math.max(1, Math.round(frac.h * eh)),
    };
    const full = crop.x === 0 && crop.y === 0 && crop.w === ew && crop.h === eh;
    if (full && normRot(item.rotation) === 0 && !item.flipH && !item.flipV) {
      S().setCropMode(false);
      return;
    }
    setBusy(true);
    try {
      const canvas = await renderItem(item, { crop, adjust: false });
      const type = item.type === 'image/jpeg' ? 'image/jpeg' : item.type === 'image/webp' ? 'image/webp' : 'image/png';
      const blob = await canvasToBlob(canvas, type, 0.95);
      S().applyEdit(item.id, blob, canvas.width, canvas.height);
      S().toast(`已裁剪为 ${canvas.width} × ${canvas.height} 像素`, { kind: 'success' });
    } catch {
      S().toast('裁剪失败', { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (S().dialog) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        S().setCropMode(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        applyRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <>
      <div className="absolute z-10" style={{ left: vp.w / 2 - W / 2, top: vp.h / 2 - H / 2, width: W, height: H }}>
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute cursor-move"
            style={{ left: px.x, top: px.y, width: px.w, height: px.h, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
            onPointerDown={startDrag('move')}
          >
            <div className="absolute inset-0 border border-white/90" />
            <div className="absolute bottom-0 left-1/3 top-0 w-px bg-white/45" />
            <div className="absolute bottom-0 left-2/3 top-0 w-px bg-white/45" />
            <div className="absolute left-0 right-0 top-1/3 h-px bg-white/45" />
            <div className="absolute left-0 right-0 top-2/3 h-px bg-white/45" />
          </div>
        </div>
        {HANDLES.map(({ h, cursor, pos }) => (
          <div
            key={h}
            className="absolute z-10 h-6 w-6 touch-none"
            style={{ ...pos(px), cursor }}
            onPointerDown={startDrag(h)}
          >
            <HandleVisual h={h} />
          </div>
        ))}
        <div
          className="pointer-events-none absolute rounded bg-black/65 px-1.5 py-0.5 text-[11px] tabular-nums text-white"
          style={{ left: px.x + 6, top: Math.max(px.y + 6, 6) }}
        >
          {Math.round(frac.w * ew)} × {Math.round(frac.h * eh)}
        </div>
      </div>

      <div
        data-no-pan
        className="win-scroll absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-lg border border-stroke bg-acrylic p-1 shadow-flyout backdrop-blur-2xl"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {ASPECTS.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => chooseAspect(a.key)}
            className={cn(
              'h-8 shrink-0 whitespace-nowrap rounded-md px-2.5 text-[13px] transition-colors',
              aspect === a.key ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-subtle',
            )}
          >
            {a.label}
          </button>
        ))}
        <div className="mx-1 h-5 w-px shrink-0 bg-stroke" />
        <ToolButton icon={RotateCcw} label="向左旋转" size="sm" tipSide="top" noTip onClick={() => S().rotate(item.id, -90)} />
        <ToolButton icon={RotateCw} label="向右旋转" size="sm" tipSide="top" noTip onClick={() => S().rotate(item.id, 90)} />
        <div className="mx-1 h-5 w-px shrink-0 bg-stroke" />
        <Button className="shrink-0 px-3" onClick={() => S().setCropMode(false)}>
          <X size={14} /> 取消
        </Button>
        <Button variant="accent" className="shrink-0 px-3" disabled={busy} onClick={apply}>
          <Check size={14} /> {busy ? '处理中…' : '应用'}
        </Button>
      </div>
    </>
  );
}
