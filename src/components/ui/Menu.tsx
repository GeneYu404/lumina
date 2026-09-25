import { Check, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Point } from '../../types';
import { cn } from '../../utils/cn';

export type MenuEntry =
  | {
      kind?: 'item';
      label: string;
      icon?: LucideIcon;
      shortcut?: string;
      onSelect?: () => void;
      disabled?: boolean;
      checked?: boolean;
      danger?: boolean;
      hidden?: boolean;
    }
  | { kind: 'separator'; hidden?: boolean }
  | { kind: 'header'; label: string; hidden?: boolean };

export function useMenuState() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const toggle = useCallback((el: HTMLElement) => setAnchor((a) => (a ? null : el)), []);
  return { anchor, open: !!anchor, close, toggle };
}

interface MenuProps {
  open: boolean;
  onClose: () => void;
  items: MenuEntry[];
  anchor?: HTMLElement | null;
  point?: Point | null;
  align?: 'start' | 'end';
  minWidth?: number;
}

export function Menu({ open, onClose, items, anchor, point, align = 'start', minWidth = 232 }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = 8;
    let top = 8;
    if (point) {
      left = point.x + mw > vw - 8 ? Math.max(8, point.x - mw) : point.x;
      top = point.y + mh > vh - 8 ? Math.max(8, point.y - mh) : point.y;
    } else if (anchor) {
      const r = anchor.getBoundingClientRect();
      left = align === 'end' ? r.right - mw : r.left;
      top = r.bottom + 4;
      if (top + mh > vh - 8) top = Math.max(8, r.top - mh - 4);
    }
    left = Math.min(Math.max(8, left), Math.max(8, vw - mw - 8));
    setPos({ left, top });
  }, [open, anchor, point, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const onResize = () => onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onResize);
    };
  }, [open, anchor, onClose]);

  if (!open) return null;
  const visible = items.filter((i) => !i.hidden);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="win-scroll animate-menu-in fixed z-[1000] max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-stroke bg-acrylic p-1 text-fg shadow-flyout backdrop-blur-2xl"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, minWidth, visibility: pos ? 'visible' : 'hidden' }}
      data-no-pan
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {visible.map((it, idx) => {
        if (it.kind === 'separator') return <div key={idx} className="mx-1 my-1 h-px bg-stroke" />;
        if (it.kind === 'header')
          return (
            <div key={idx} className="px-3 pb-1 pt-2 text-xs font-medium text-fg3">
              {it.label}
            </div>
          );
        const Icon = it.icon;
        return (
          <button
            key={idx}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect?.();
            }}
            className={cn(
              'flex h-8 w-full items-center gap-3 rounded-md px-2.5 text-left text-[13px] hover:bg-subtle active:bg-subtle-press disabled:pointer-events-none disabled:opacity-40',
              it.danger && 'text-[#e0584b]',
            )}
          >
            <span className="flex w-4 shrink-0 justify-center">
              {it.checked ? (
                <Check size={15} strokeWidth={2} className="text-accent" />
              ) : Icon ? (
                <Icon size={16} strokeWidth={1.6} />
              ) : null}
            </span>
            <span className="flex-1 truncate">{it.label}</span>
            {it.shortcut && <span className="pl-4 text-xs text-fg3">{it.shortcut}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
