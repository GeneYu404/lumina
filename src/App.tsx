import { ImagePlus } from 'lucide-react';
import CollageDialog from './components/CollageDialog';
import PrintDialog from './components/dialogs/PrintDialog';
import WallpaperDialog from './components/dialogs/WallpaperDialog';
import { useEffect, useLayoutEffect, useState } from 'react';
import { importFiles, openLaunchFiles, openPaths, renamePasted } from './actions';
import { isDesktop, onDesktopPaths, setDesktopTheme, showDesktopWindow } from './desktop';
import { clearSession, saveSession } from './native';
import { S as getState } from './store';
import CommandBar from './components/CommandBar';
import { CloseAllDialog, ConfirmRemoveDialog } from './components/dialogs/ConfirmDialogs';
import SaveDialog from './components/dialogs/SaveDialog';
import SettingsDialog from './components/dialogs/SettingsDialog';
import ShortcutsDialog from './components/dialogs/ShortcutsDialog';
import EditPanel from './components/EditPanel';
import Filmstrip from './components/Filmstrip';
import Gallery from './components/Gallery';
import ImmersiveBar from './components/ImmersiveBar';
import InfoPanel from './components/InfoPanel';
import Slideshow from './components/Slideshow';
import StatusBar from './components/StatusBar';
import Toasts from './components/Toasts';
import Viewer from './components/Viewer';
import Welcome from './components/Welcome';
import WindowFrame from './components/WindowFrame';
import { useGlobalKeys } from './hooks/useGlobalKeys';
import { getVisible, useStore } from './store';
import { luminance, mixHex, rgba } from './utils/color';
import { isImageFile, readDataTransfer } from './utils/files';

function useThemeSync() {
  const theme = useStore((s) => s.settings.theme);
  const accent = useStore((s) => s.settings.accent);
  const [sysDark, setSysDark] = useState(() =>
    typeof window.matchMedia === 'function' ? !window.matchMedia('(prefers-color-scheme: light)').matches : true,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const fn = () => setSysDark(!mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const eff = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme;

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = eff;
    const acc = eff === 'dark' ? mixHex(accent, '#ffffff', 0.45) : mixHex(accent, '#000000', 0.1);
    root.style.setProperty('--accent', acc);
    root.style.setProperty('--accent-hover', eff === 'dark' ? mixHex(acc, '#000000', 0.1) : mixHex(acc, '#ffffff', 0.12));
    root.style.setProperty('--accent-soft', rgba(acc, eff === 'dark' ? 0.18 : 0.12));
    root.style.setProperty('--on-accent', luminance(acc) > 0.36 ? '#000000' : '#ffffff');
  }, [eff, accent]);

  // keep the native Windows title bar in the same light/dark mode as the app
  useEffect(() => {
    void setDesktopTheme(theme === 'system' ? null : theme);
  }, [theme]);
}

/** Desktop app only: behave like an application, not like a web page. */
function useDesktopShell() {
  useEffect(() => {
    if (!isDesktop) return;
    document.documentElement.dataset.desktop = 'true';
    // The first render (with the launched image, if any) is committed:
    // reveal the window now — no white flash, no welcome-screen flash.
    void showDesktopWindow();
    void openLaunchFiles();

    // Remember what is open so the next launch restores it (settings toggle).
    let timer = 0;
    const saveLater = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => saveSession(), 600);
    };
    const stop = useStore.subscribe((s) => {
      if (s.images.length) saveLater();
      else clearSession();
    });

    const isField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    // Our own handlers run first; this only swallows what would otherwise reach WebView2.
    const onContextMenu = (e: MouseEvent) => {
      if (!isField(e.target)) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (
        e.key === 'F5' ||
        e.key === 'F3' ||
        e.key === 'F7' ||
        (ctrl && ['r', 'f', 'g', 'u', 'j', 'h'].includes(k)) ||
        (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      stop();
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}

function useDropAndPaste(setDragging: (v: boolean) => void) {
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      readDataTransfer(e.dataTransfer).then((inputs) =>
        importFiles(inputs, { replace: false, folder: inputs.some((i) => (i.path ?? '').includes('/')) }),
      );
    };
    // Desktop shell owns drag & drop: it hands us absolute paths (no bytes
    // through JS), and Rust does one import + one thumbnail batch.
    let unsubscribe: (() => void) | undefined;
    let alive = true;
    if (isDesktop) {
      void onDesktopPaths((paths) => {
        setDragging(false);
        void openPaths(paths, { replace: false });
      }).then((off) => {
        if (alive) unsubscribe = off;
        else off();
      });
    }

    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter(isImageFile);
      if (!files.length) return;
      e.preventDefault();
      importFiles(files.map((f) => ({ file: renamePasted(f) })), { replace: false });
    };
    const onFsChange = () => {
      if (document.fullscreenElement) return;
      const s = useStore.getState();
      if (s.immersive) s.setImmersive(false);
      if (s.slideshow) s.setSlideshow(false);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      alive = false;
      unsubscribe?.();
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [setDragging]);
}

function CollageDialogWrapper() {
  const open = useStore((s) => s.dialog === 'collage');
  if (!open) return null;
  return <CollageDialog onClose={() => getState().setDialog(null)} />;
}

function DropOverlay() {
  return (
    <div className="animate-fade-in pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-soft backdrop-blur-[2px]">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-stroke bg-acrylic px-10 py-7 shadow-flyout">
        <ImagePlus size={38} strokeWidth={1.5} className="text-accent" />
        <div className="text-base font-semibold text-fg">释放以打开图片或视频</div>
        <div className="text-xs text-fg2">支持多个文件以及整个文件夹</div>
      </div>
    </div>
  );
}

export default function App() {
  const [dragging, setDragging] = useState(false);
  useThemeSync();
  useGlobalKeys();
  useDesktopShell();
  useDropAndPaste(setDragging);

  const hasImages = useStore((s) => s.images.length > 0);
  const mode = useStore((s) => s.mode);
  const panel = useStore((s) => s.panel);
  const immersive = useStore((s) => s.immersive);
  const slideshow = useStore((s) => s.slideshow);
  const showFilm = useStore((s) => s.settings.showFilmstrip);
  const visibleCount = useStore((s) => getVisible(s).length);

  const showViewer = hasImages && mode === 'viewer';

  return (
    <>
      <WindowFrame>
        {!immersive && <CommandBar />}
        <div className="relative flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 flex-col">
            {!hasImages ? (
              <Welcome />
            ) : mode === 'gallery' ? (
              <Gallery />
            ) : (
              <>
                <div className="relative min-h-0 flex-1">
                  <Viewer />
                </div>
                {showFilm && !immersive && visibleCount > 1 && <Filmstrip />}
              </>
            )}
          </div>
          {hasImages && !immersive && panel === 'info' && <InfoPanel />}
          {showViewer && !immersive && panel === 'edit' && <EditPanel />}
        </div>
        {hasImages && !immersive && <StatusBar />}
        {immersive && showViewer && <ImmersiveBar />}
        <Toasts />
        {dragging && <DropOverlay />}
      </WindowFrame>

      {slideshow && hasImages && <Slideshow />}
      <SettingsDialog />
      <ShortcutsDialog />
      <SaveDialog />
      <ConfirmRemoveDialog />
      <CloseAllDialog />
      <CollageDialogWrapper />
      <PrintDialog />
      <WallpaperDialog />
    </>
  );
}
