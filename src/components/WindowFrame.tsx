import { Keyboard, Settings as SettingsIcon } from 'lucide-react';
import {
  useEffect,
  useState,
  type MouseEvent as RMouseEvent,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from 'react';
import { getCurrent, useStore } from '../store';
import { isDesktop, setDesktopTitle } from '../desktop';
import { cn } from '../utils/cn';
import { AppIcon, CaptionClose, CaptionMax, CaptionMin, CaptionRestore, Wallpaper, WinLogo } from './ui/Icons';
import { Menu, useMenuState } from './ui/Menu';

type Rect = { x: number; y: number; w: number; h: number };
const TASKBAR = 48;
const S = useStore.getState;

function defaultRect(): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight - TASKBAR;
  const w = Math.min(vw, Math.min(1200, Math.max(560, Math.round(vw * 0.84))));
  const h = Math.min(vh, Math.min(800, Math.max(400, Math.round(vh * 0.86))));
  return { x: Math.max(0, Math.round((vw - w) / 2)), y: Math.max(0, Math.round((vh - h) / 2)), w, h };
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export default function WindowFrame({ children }: { children: ReactNode }) {
  return isDesktop ? <DesktopFrame>{children}</DesktopFrame> : <SimulatedFrame>{children}</SimulatedFrame>;
}

/** Inside the Tauri app: the real Windows window supplies the title bar. */
function DesktopFrame({ children }: { children: ReactNode }) {
  const title = useStore((s) => getCurrent(s)?.name ?? null);
  useEffect(() => {
    void setDesktopTitle(title ? `${title} - 拾光` : '拾光');
  }, [title]);
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-app text-fg">
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/** In the browser: a simulated Windows 11 desktop around the app. */
function SimulatedFrame({ children }: { children: ReactNode }) {
  const win = useStore((s) => s.win);
  const immersive = useStore((s) => s.immersive);
  const title = useStore((s) => getCurrent(s)?.name ?? null);
  const hasImages = useStore((s) => s.images.length > 0);
  const [rect, setRect] = useState<Rect>(defaultRect);

  const isMax = win.max || immersive;
  const hidden = win.min || win.closed;

  useEffect(() => {
    const onResize = () =>
      setRect((r) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight - TASKBAR;
        const w = Math.min(r.w, vw);
        const h = Math.min(r.h, vh);
        return { w, h, x: Math.min(Math.max(0, r.x), Math.max(0, vw - w)), y: Math.min(Math.max(0, r.y), Math.max(0, vh - h)) };
      });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startDrag = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isMax) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const r0 = rect;
    const move = (ev: PointerEvent) =>
      setRect({
        ...r0,
        x: Math.min(Math.max(r0.x + ev.clientX - sx, 120 - r0.w), window.innerWidth - 120),
        y: Math.min(Math.max(r0.y + ev.clientY - sy, 0), window.innerHeight - TASKBAR - 40),
      });
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      // Aero-snap: drop on the top edge to maximise
      if (ev.type === 'pointerup' && ev.clientY <= 2) {
        setRect(r0);
        S().setWin({ max: true });
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const startResize = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const r0 = rect;
    const move = (ev: PointerEvent) =>
      setRect({
        ...r0,
        w: Math.max(520, Math.min(window.innerWidth - r0.x, r0.w + ev.clientX - sx)),
        h: Math.max(360, Math.min(window.innerHeight - TASKBAR - r0.y, r0.h + ev.clientY - sy)),
      });
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onClose = () => {
    if (hasImages) S().setDialog('closeAll');
    else S().setWin({ closed: true });
  };

  const openApp = () => S().setWin({ closed: false, min: false });
  const onTaskbarApp = () => {
    if (win.closed || win.min) openApp();
    else S().setWin({ min: true });
  };

  return (
    <div className="fixed inset-0 overflow-hidden">
      <Wallpaper />
      <DesktopIcon onOpen={openApp} />

      <div
        className={cn(
          'absolute flex flex-col overflow-hidden bg-app text-fg transition-[opacity,transform] duration-200 ease-out',
          isMax ? 'inset-0' : 'rounded-lg border border-stroke shadow-window',
          hidden && 'pointer-events-none opacity-0',
        )}
        style={{
          ...(isMax ? {} : { left: rect.x, top: rect.y, width: rect.w, height: rect.h }),
          transform: hidden ? (win.closed ? 'scale(0.96)' : 'translateY(30%) scale(0.6)') : 'none',
          transformOrigin: 'center bottom',
        }}
        aria-hidden={hidden}
      >
        {!immersive && (
          <div
            className="flex h-8 shrink-0 select-none items-center"
            onPointerDown={startDrag}
            onDoubleClick={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              S().setWin({ max: !win.max });
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-3">
              <AppIcon size={16} className="shrink-0" />
              <span className="shrink-0 text-xs font-semibold tracking-wide text-fg">拾光</span>
              {title && (
                <>
                  <span className="text-xs text-fg3">—</span>
                  <span className="truncate text-xs text-fg2">{title}</span>
                </>
              )}
            </div>
            <div className="flex h-full shrink-0">
              <CaptionButton label="最小化" onClick={() => S().setWin({ min: true })}>
                <CaptionMin />
              </CaptionButton>
              <CaptionButton label={win.max ? '向下还原' : '最大化'} onClick={() => S().setWin({ max: !win.max })}>
                {win.max ? <CaptionRestore /> : <CaptionMax />}
              </CaptionButton>
              <CaptionButton label="关闭" onClick={onClose} close>
                <CaptionClose />
              </CaptionButton>
            </div>
          </div>
        )}
        <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
        {!isMax && !hidden && (
          <div onPointerDown={startResize} className="absolute bottom-0 right-0 z-50 h-4 w-4 cursor-nwse-resize" aria-hidden="true" />
        )}
      </div>

      {(!isMax || hidden) && (
        <Taskbar appOpen={!win.closed} appActive={!hidden} onApp={onTaskbarApp} onOpenApp={openApp} />
      )}
    </div>
  );
}

function CaptionButton({
  children,
  label,
  onClick,
  close,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  close?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex h-full w-[46px] items-center justify-center text-fg transition-colors',
        close ? 'hover:bg-[#c42b1c] hover:text-white active:bg-[#c42b1c]/85' : 'hover:bg-subtle active:bg-subtle-press',
      )}
    >
      {children}
    </button>
  );
}

function DesktopIcon({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      title="双击打开"
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      className="absolute left-3 top-3 flex w-[88px] flex-col items-center gap-1.5 rounded-md border border-transparent p-2 text-center text-xs text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.8)] hover:bg-white/10 focus:border-white/25 focus:bg-white/15 focus:outline-none"
    >
      <AppIcon size={46} />
      <span>拾光</span>
    </button>
  );
}

function Taskbar({
  appOpen,
  appActive,
  onApp,
  onOpenApp,
}: {
  appOpen: boolean;
  appActive: boolean;
  onApp: () => void;
  onOpenApp: () => void;
}) {
  const now = useClock();
  const start = useMenuState();
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex h-12 items-center justify-center border-t border-stroke bg-taskbar backdrop-blur-2xl">
      <div className="flex items-center gap-1">
        <TaskButton title="开始" onClick={(e) => start.toggle(e.currentTarget)}>
          <WinLogo size={22} />
        </TaskButton>
        <TaskButton title="拾光" onClick={onApp} running={appOpen} active={appActive}>
          <AppIcon size={26} />
        </TaskButton>
      </div>
      <div className="absolute right-3 flex flex-col items-end text-[12px] leading-4 text-fg">
        <span>{time}</span>
        <span>{date}</span>
      </div>
      <Menu
        open={start.open}
        anchor={start.anchor}
        onClose={start.close}
        minWidth={240}
        items={[
          { kind: 'header', label: '已固定' },
          { label: '拾光', onSelect: onOpenApp },
          { label: '设置', icon: SettingsIcon, onSelect: () => S().setDialog('settings') },
          { label: '键盘快捷键', icon: Keyboard, onSelect: () => S().setDialog('shortcuts') },
        ]}
      />
    </div>
  );
}

function TaskButton({
  children,
  title,
  onClick,
  running,
  active,
}: {
  children: ReactNode;
  title: string;
  onClick: (e: RMouseEvent<HTMLButtonElement>) => void;
  running?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'relative flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-subtle active:scale-95',
        active && 'bg-subtle',
      )}
    >
      {children}
      {running && (
        <span
          className={cn(
            'absolute bottom-0.5 h-[3px] rounded-full transition-all',
            active ? 'w-4 bg-accent' : 'w-1.5 bg-fg3',
          )}
        />
      )}
    </button>
  );
}
