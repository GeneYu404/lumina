import { ChevronLeft, ChevronRight, Minimize, Minus, Plus, RotateCcw, RotateCw, Scan, Shrink, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { exitImmersive } from '../actions';
import { effScale, getVisible, useCurrent, useStore } from '../store';
import { cn } from '../utils/cn';
import { formatZoom } from '../utils/format';

const S = useStore.getState;

function DarkBtn({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15 active:bg-white/10"
    >
      <Icon size={18} strokeWidth={1.7} />
    </button>
  );
}

export default function ImmersiveBar() {
  const [visible, setVisible] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const item = useCurrent();
  const scale = useStore((s) => effScale(s));
  const fit = useStore((s) => s.view.fit);
  const total = useStore((s) => getVisible(s).length);
  const index = useStore((s) => getVisible(s).findIndex((i) => i.id === s.currentId));

  useEffect(() => {
    const poke = () => {
      setVisible(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setVisible(false), 2500);
    };
    poke();
    window.addEventListener('mousemove', poke);
    window.addEventListener('pointerdown', poke);
    return () => {
      window.removeEventListener('mousemove', poke);
      window.removeEventListener('pointerdown', poke);
      window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('pv-hide-cursor', !visible);
    return () => document.body.classList.remove('pv-hide-cursor');
  }, [visible]);

  return (
    <>
      <div
        className={cn(
          'pointer-events-none absolute left-4 top-4 z-30 max-w-[60%] truncate rounded-lg bg-black/55 px-3 py-1.5 text-xs text-white backdrop-blur transition-opacity duration-300',
          visible ? 'opacity-100' : 'opacity-0',
        )}
      >
        {item?.name} · {index + 1} / {total}
      </div>
      <div
        className={cn(
          'absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-white/10 bg-black/60 p-1 text-white shadow-2xl backdrop-blur-xl transition-all duration-300',
          visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
        )}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <DarkBtn icon={ChevronLeft} label="上一张" onClick={() => S().step(-1)} />
        <div className="mx-1 h-5 w-px bg-white/15" />
        <DarkBtn icon={Minus} label="缩小" onClick={() => S().zoomStep(-1)} />
        <span className="min-w-[52px] text-center text-xs tabular-nums">{formatZoom(scale)}</span>
        <DarkBtn icon={Plus} label="放大" onClick={() => S().zoomStep(1)} />
        <DarkBtn icon={fit ? Scan : Shrink} label={fit ? '实际大小' : '适应窗口'} onClick={() => (fit ? S().actualSize() : S().fitToWindow())} />
        <div className="mx-1 h-5 w-px bg-white/15" />
        {item && <DarkBtn icon={RotateCcw} label="向左旋转" onClick={() => S().rotate(item.id, -90)} />}
        {item && <DarkBtn icon={RotateCw} label="向右旋转" onClick={() => S().rotate(item.id, 90)} />}
        <div className="mx-1 h-5 w-px bg-white/15" />
        <DarkBtn icon={ChevronRight} label="下一张" onClick={() => S().step(1)} />
        <div className="mx-1 h-5 w-px bg-white/15" />
        <DarkBtn icon={Minimize} label="退出全屏 (Esc)" onClick={exitImmersive} />
      </div>
    </>
  );
}
