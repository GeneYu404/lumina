import { useEffect } from 'react';
import {
  copyImage,
  exitImmersive,
  openFiles,
  openFolder,

  requestRemove,
  startCrop,
  startSlideshow,
  toggleImmersive,
} from '../actions';
import { getCurrent, isPannable, useStore } from '../store';

export function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      // let focused buttons / cells keep their native Space & Enter behaviour
      if (t && (e.key === ' ' || e.key === 'Enter') && (t.tagName === 'BUTTON' || t.getAttribute('role') === 'button')) return;
      const s = useStore.getState();
      if (s.dialog || s.slideshow || s.cropMode) return;
      if (s.win.closed || s.win.min) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key;
      const k = key.length === 1 ? key.toLowerCase() : key;
      const item = getCurrent(s);
      const viewer = s.mode === 'viewer';
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      // Global shortcuts
      if (ctrl && k === 'o') return run(() => (e.shiftKey ? openFolder(true) : openFiles(true)));
      if (ctrl && k === ',') return run(() => s.setDialog('settings'));
      if (!ctrl && (key === '?' || key === 'F1')) return run(() => s.setDialog('shortcuts'));
      if (!item) return;
      const isVideo = item.kind === 'video';

      if (ctrl) {
        if (isVideo && ['c', 's', 'p', 'r', 'e', '=', '+', '-', '_', '0', '1'].includes(k)) return;
        switch (k) {
          case 'c':
            if (window.getSelection()?.toString()) return;
            return run(() => copyImage());
          case 's':
            return run(() => s.setDialog('saveAs'));
          case 'p':
            return run(() => s.setDialog('print'));
          case 'd':
            return run(() => s.toggleFavorite(item.id));
          case 'r':
            return run(() => s.rotate(item.id, e.shiftKey ? -90 : 90));
          case '=':
          case '+':
            return run(() => s.zoomStep(1));
          case '-':
          case '_':
            return run(() => s.zoomStep(-1));
          case '0':
            return run(() => s.fitToWindow());
          case '1':
            return run(() => s.actualSize());
          case 'e':
            return run(() => s.togglePanel('edit'));
          case 'i':
            return run(() => s.togglePanel('info'));
          case 'ArrowLeft':
            return run(() => s.step(-1));
          case 'ArrowRight':
            return run(() => s.step(1));
        }
        return;
      }

      if (e.altKey) {
        if (key === 'Enter') run(() => s.togglePanel('info'));
        return;
      }

      const pan = viewer && isPannable(s);
      const amt = e.shiftKey ? 240 : 80;

      switch (key) {
        case 'ArrowLeft':
          return run(() => (pan ? s.panBy(amt, 0, true) : s.step(-1)));
        case 'ArrowRight':
          return run(() => (pan ? s.panBy(-amt, 0, true) : s.step(1)));
        case 'ArrowUp':
          if (pan) run(() => s.panBy(0, amt, true));
          return;
        case 'ArrowDown':
          if (pan) run(() => s.panBy(0, -amt, true));
          return;
        case 'PageUp':
        case 'Backspace':
          return run(() => s.step(-1));
        case 'PageDown':
          return run(() => s.step(1));
        case ' ': {
          if (isVideo) {
            return run(() => {
              const v = document.getElementById('pv-video') as HTMLVideoElement | null;
              if (!v) return;
              if (v.paused) void v.play();
              else v.pause();
            });
          }
          return run(() => (viewer ? s.step(1) : s.setMode('viewer')));
        }
        case 'Enter':
          if (!viewer) run(() => s.setMode('viewer'));
          return;
        case 'Home':
          return run(() => s.first());
        case 'End':
          return run(() => s.last());
        case 'Delete':
          return run(() => requestRemove());
        case 'F11':
          return run(() => toggleImmersive());
        case 'F5':
          return run(() => startSlideshow());
        case 'Escape':
          if (s.immersive) return run(() => exitImmersive());
          if (s.panel) return run(() => s.setPanel(null));
          if (!viewer) return run(() => s.setMode('viewer'));
          return;
      }

      if (!viewer && !['g', 'i', 't', '.'].includes(k)) return;
      if (isVideo && !['f', 'm', 't', 'g', 'i', '.'].includes(k)) return;

      switch (k) {
        case '+':
        case '=':
          return run(() => s.zoomStep(1));
        case '-':
          return run(() => s.zoomStep(-1));
        case '0':
          return run(() => s.fitToWindow());
        case '1':
          return run(() => s.actualSize());
        case 'r':
          return run(() => s.rotate(item.id, e.shiftKey ? -90 : 90));
        case 'l':
          return run(() => s.rotate(item.id, -90));
        case 'h':
          return run(() => s.flip(item.id, 'h'));
        case 'v':
          return run(() => s.flip(item.id, 'v'));
        case 'f':
          return run(() => toggleImmersive());
        case 'c':
          return run(() => startCrop());
        case 'e':
          return run(() => s.togglePanel('edit'));
        case 'i':
          return run(() => s.togglePanel('info'));
        case 'g':
          return run(() => s.setMode(viewer ? 'gallery' : 'viewer'));
        case 't':
          return run(() => s.setSetting('showFilmstrip', !s.settings.showFilmstrip));
        case 'm':
          return run(() => s.setSetting('showMinimap', !s.settings.showMinimap));
        case '.':
          return run(() => s.toggleFavorite(item.id));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
