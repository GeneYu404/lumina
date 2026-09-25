import { Heart } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useStore, useVisibleImages } from '../store';
import type { ImageItem } from '../types';
import { cn } from '../utils/cn';
import Thumb from './Thumb';

const S = useStore.getState;

const FilmThumb = memo(function FilmThumb({ item, active }: { item: ImageItem; active: boolean }) {
  return (
    <button
      type="button"
      data-id={item.id}
      title={item.name}
      onClick={() => S().goTo(item.id)}
      className={cn(
        'relative shrink-0 overflow-hidden rounded-md transition-all duration-150',
        active ? 'h-[58px] w-[58px] outline-2 outline-offset-2 outline-accent' : 'h-[52px] w-[52px] opacity-75 hover:opacity-100',
      )}
    >
      <Thumb item={item} size={58} />
      {item.favorite && (
        <Heart size={11} className="absolute right-1 top-1 fill-[#e81123] text-[#e81123] drop-shadow" strokeWidth={2} />
      )}
    </button>
  );
});

export default function Filmstrip() {
  const list = useVisibleImages();
  const currentId = useStore((s) => s.currentId);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !currentId) return;
    const t = el.querySelector<HTMLElement>(`[data-id="${currentId}"]`);
    if (!t) return;
    el.scrollTo({ left: t.offsetLeft - el.clientWidth / 2 + t.offsetWidth / 2, behavior: 'smooth' });
  }, [currentId, list.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="h-[78px] shrink-0 border-t border-stroke bg-layer">
      <div ref={ref} className="win-scroll relative flex h-full items-center gap-2 overflow-x-auto overflow-y-hidden px-4">
        {list.map((it) => (
          <FilmThumb key={it.id} item={it} active={it.id === currentId} />
        ))}
      </div>
    </div>
  );
}
