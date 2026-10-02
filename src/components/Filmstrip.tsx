import { Heart } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useStore, useVisibleImages } from '../store';
import type { ImageItem } from '../types';
import { cn } from '../utils/cn';
import Thumb from './Thumb';

const S = useStore.getState;

/** Chips rendered on each side of the current one. Left/right spacer divs
 *  stand in for everything else, so the DOM holds ~160 cells whether the
 *  folder has 500 files or 100k — scrolling never mounts the whole list. */
const WINDOW = 80;
/** Estimated slot width (52–58px chip + 8px gap). Spacers only need to be
 *  close: scroll-into-view uses each chip's real offsetLeft, not this. */
const SLOT = 60;

const FilmThumb = memo(function FilmThumb({ item, active }: { item: ImageItem; active: boolean }) {
  return (
    <button
      type="button"
      data-id={item.id}
      title={item.name}
      onClick={() => S().goTo(item.id)}
      className={cn('chip', active ? 'chip--on' : 'chip--off')}
    >
      <Thumb item={item} size={58} />
      {item.favorite && (
        <Heart size={11} className="chip-fav" strokeWidth={2} />
      )}
    </button>
  );
});

export default function Filmstrip() {
  const list = useVisibleImages();
  const currentId = useStore((s) => s.currentId);
  const ref = useRef<HTMLDivElement>(null);

  const curIndex = Math.max(0, list.findIndex((it) => it.id === currentId));
  const [center, setCenter] = useState(curIndex);
  const ignoreScroll = useRef(false);
  const recenterTimer = useRef<number | undefined>(undefined);
  const scrolledFor = useRef<string | null>(null);

  // Navigation recenters the window on the new current item.
  useEffect(() => {
    setCenter(curIndex);
  }, [curIndex]);

  // Keep the rendered window around the visible stretch: re-center when the
  // user scrolls past its edge (rAF-throttled, only when actually far away).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (ignoreScroll.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const est = Math.round(el.scrollLeft / SLOT);
        setCenter((c) => (Math.abs(est - c) > WINDOW ? est : c));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Smooth-scroll the current chip into the middle. Retries across renders:
  // right after a navigation the chip may fall outside the still-old window,
  // and the recenter effect above will bring it in on the next pass.
  useEffect(() => {
    const el = ref.current;
    if (!el || !currentId || scrolledFor.current === currentId) return;
    const t = el.querySelector<HTMLElement>(`[data-id="${currentId}"]`);
    if (!t) return;
    scrolledFor.current = currentId;
    const target = t.offsetLeft - el.clientWidth / 2 + t.offsetWidth / 2;
    // Long jumps snap instead of animating through empty spacer — and either
    // way the transient scroll events must not bounce the window back.
    const far = Math.abs(target - el.scrollLeft) > SLOT * 30;
    ignoreScroll.current = true;
    window.clearTimeout(recenterTimer.current);
    recenterTimer.current = window.setTimeout(() => {
      ignoreScroll.current = false;
    }, 650);
    el.scrollTo({ left: target, behavior: far ? 'auto' : 'smooth' });
  }, [currentId, center, list.length]);

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

  // Exactly one window of chips, padded out to the full list width so the
  // scrollbar and wheel navigation keep feeling like the whole strip.
  const total = list.length;
  const from = Math.max(0, Math.min(center - WINDOW, total - 1));
  const to = Math.min(total, from + 2 * WINDOW + 1);
  const slice = list.slice(from, to);

  return (
    <div className="filmstrip">
      <div ref={ref} className="filmstrip-scroll win-scroll">
        {from > 0 && <div aria-hidden className="filmstrip-spacer" style={{ width: from * SLOT }} />}
        {slice.map((it) => (
          <FilmThumb key={it.id} item={it} active={it.id === currentId} />
        ))}
        {to < total && <div aria-hidden className="filmstrip-spacer" style={{ width: (total - to) * SLOT }} />}
      </div>
    </div>
  );
}
