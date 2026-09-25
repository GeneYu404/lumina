import { Film, ImageOff } from 'lucide-react';
import type { CSSProperties } from 'react';
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
  if (item.error) {
    return (
      <div className={cn('flex h-full w-full items-center justify-center bg-subtle text-fg3', className)}>
        <ImageOff size={Math.max(14, Math.min(28, size / 4))} strokeWidth={1.4} />
      </div>
    );
  }
  if (!item.thumb) {
    return item.kind === 'video' ? (
      <div className={cn('flex h-full w-full flex-col items-center justify-center gap-1.5 bg-[#14171c] text-fg3', className)}>
        <Film size={Math.max(16, Math.min(30, size / 3.4))} strokeWidth={1.5} />
        <span className="max-w-full truncate px-2 text-[10px] text-fg3" style={{ fontFamily: 'inherit' }}>{item.name}</span>
      </div>
    ) : (
      <div className={cn('h-full w-full animate-pulse bg-subtle', className)} />
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
      className={cn('h-full w-full max-w-none select-none', cover ? 'object-cover' : 'object-contain', className)}
      style={style}
    />
  );
}
