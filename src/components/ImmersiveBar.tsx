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
      className="imm-btn"
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
          'imm-name',
          visible ? 'imm-name--on' : 'imm-name--off',
        )}
      >
        {item?.name} · {index + 1} / {total}
      </div>
      {/* Videos carry their own bottom bar (VideoControls); zoom/rotate are
          meaningless there and the two bars would stack on top of each other. */}
      {item?.kind !== 'video' && (
        <div
          className={cn(
            'imm-bar',
            visible ? 'imm-bar--on' : 'imm-bar--off',
          )}
          onDoubleClick={(e) => e.stopPropagation()}
        >
        <DarkBtn icon={ChevronLeft} label="上一张" onClick={() => S().step(-1)} />
        <div className="sep--on-dark" />
        <DarkBtn icon={Minus} label="缩小" onClick={() => S().zoomStep(-1)} />
        <span className="imm-zoom">{formatZoom(scale)}</span>
        <DarkBtn icon={Plus} label="放大" onClick={() => S().zoomStep(1)} />
        <DarkBtn icon={fit ? Scan : Shrink} label={fit ? '实际大小' : '适应窗口'} onClick={() => (fit ? S().actualSize() : S().fitToWindow())} />
        <div className="sep--on-dark" />
        {item && <DarkBtn icon={RotateCcw} label="向左旋转" onClick={() => S().rotate(item.id, -90)} />}
        {item && <DarkBtn icon={RotateCw} label="向右旋转" onClick={() => S().rotate(item.id, 90)} />}
        <div className="sep--on-dark" />
        <DarkBtn icon={ChevronRight} label="下一张" onClick={() => S().step(1)} />
        <div className="sep--on-dark" />
        <DarkBtn icon={Minimize} label="退出全屏 (Esc)" onClick={exitImmersive} />
        </div>
      )}
    </>
  );
}
