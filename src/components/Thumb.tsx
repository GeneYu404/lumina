import { Film, ImageOff } from 'lucide-react';
import { useEffect, type CSSProperties } from 'react';
import { requestThumbs } from '../store';
import type { ImageItem } from '../types';
import { cn } from '../utils/cn';
import { blurNatural, cssFilter } from '../utils/image';

/** A thumbnail that reflects rotation, flip and colour adjustments. */
export default function Thumb({
  item,
  size,
  cover = true,
  className,
}: {
  item: ImageItem;
  size: number;
  cover?: boolean;
  className?: string;
}) {
  // Demand-driven: a cell asks for its thumbnail only when it mounts, so a
  // 100k-file folder decodes nothing beyond what the user actually scrolls to.
  useEffect(() => {
    if (!item.thumb && item.thumbState === 'idle' && !item.error) requestThumbs([item.id]);
  }, [item.id, item.thumb, item.thumbState, item.error]);
  if (item.error) {
    return (
      <div className={cn('thumb-error', className)}>
        <ImageOff size={Math.max(14, Math.min(28, size / 4))} strokeWidth={1.4} />
      </div>
    );
  }
  if (!item.thumb) {
    return item.kind === 'video' ? (
      <div className={cn('thumb-video', className)}>
        <Film size={Math.max(16, Math.min(30, size / 3.4))} strokeWidth={1.5} />
        <span className="thumb-name">{item.name}</span>
      </div>
    ) : (
      <div className={cn('thumb-skeleton', className)} />
    );
  }
  const minSide = Math.max(1, Math.min(item.width || size, item.height || size));
  const blur = blurNatural(item.adjust, item.width || size, item.height || size) * (size / minSide);
  const style: CSSProperties = {
    transform: `rotate(${item.rotation}deg) scale(${item.flipH ? -1 : 1}, ${item.flipV ? -1 : 1})`,
    filter: cssFilter(item.adjust, blur),
    transition: 'transform .25s ease',
  };
  return (
    <img
      src={item.thumb}
      alt={item.name}
      draggable={false}
      loading="lazy"
      decoding="async"
      className={cn('thumb-img', cover ? 'thumb-img--cover' : 'thumb-img--contain', className)}
      style={style}
    />
  );
}
