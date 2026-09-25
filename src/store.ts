import { useMemo } from 'react';
import { create } from 'zustand';
import type {
  Adjustments,
  AppMode,
  DialogKind,
  FileInput,
  FilterKind,
  ImageItem,
  PanelKind,
  Point,
  Settings,
  SortDir,
  SortKey,
  ToastItem,
  WinState,
} from './types';
import { DEFAULT_ADJUST, loadImageEl, makeThumb, normRot, visualSize } from './utils/image';
import { clamp, extOf } from './utils/format';
import { guessMime, kindOf } from './utils/files';
import { makeVideoThumb } from './utils/videoThumb';
import { assetUrl, readBoot } from './desktop';

export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 64;
export const ZOOM_LEVELS = [
  0.02, 0.05, 0.1, 0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64,
];

const SETTINGS_KEY = 'pv-settings-v1';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: '#0078D4',
  viewerBg: 'theme',
  wheelAction: 'zoom',
  upscaleSmall: false,
  pixelated: true,
  loop: true,
  confirmRemove: false,
  showMinimap: true,
  showFilmstrip: true,
  slideInterval: 4,
  slideTransition: 'fade',
  slideShuffle: false,
  thumbSize: 168,
  galleryCover: true,
  restoreSession: true,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export interface ViewState {
  zoom: number;
  fit: boolean;
  ox: number;
  oy: number;
  anim: boolean;
  tick: number;
}

const fitView = (tick: number, anim = false): ViewState => ({ zoom: 1, fit: true, ox: 0, oy: 0, anim, tick });

export interface Store {
  images: ImageItem[];
  currentId: string | null;
  mode: AppMode;
  sortKey: SortKey;
  sortDir: SortDir;
  filter: FilterKind;
  viewport: { w: number; h: number };
  view: ViewState;
  panel: PanelKind;
  dialog: DialogKind;
  immersive: boolean;
  slideshow: boolean;
  cropMode: boolean;
  comparing: boolean;
  busy: string | null;
  settings: Settings;
  toasts: ToastItem[];
  lastRemoved: { item: ImageItem } | null;
  win: WinState;

  addItems: (items: ImageItem[], opts?: { replace?: boolean }) => void;
  /** Add items without touching the current image, view or mode (background loads). */
  mergeItems: (items: ImageItem[]) => void;
  /** Patch many items in a single store update. */
  patchMany: (patches: Map<string, Partial<ImageItem>>) => void;
  addFiles: (inputs: FileInput[], opts?: { replace?: boolean }) => number;
  setMeta: (id: string, patch: Partial<ImageItem>) => void;
  removeImage: (id: string) => void;
  undoRemove: () => void;
  closeAll: () => void;
  toggleFavorite: (id: string) => void;
  rotate: (id: string, delta: number) => void;
  flip: (id: string, axis: 'h' | 'v') => void;
  setAdjust: (id: string, patch: Partial<Adjustments>) => void;
  replaceAdjust: (id: string, adjust: Adjustments) => void;
  applyEdit: (id: string, blob: Blob, width: number, height: number) => void;
  revertEdits: (id: string) => void;

  goTo: (id: string) => void;
  step: (d: 1 | -1) => void;
  first: () => void;
  last: () => void;

  setViewport: (w: number, h: number) => void;
  zoomTo: (scale: number, anchor?: Point, anim?: boolean) => void;
  zoomStep: (dir: 1 | -1, anchor?: Point) => void;
  wheelZoom: (deltaY: number, anchor: Point) => void;
  fitToWindow: () => void;
  actualSize: (anchor?: Point) => void;
  toggleFitActual: (anchor?: Point) => void;
  panBy: (dx: number, dy: number, anim?: boolean) => void;
  setView: (scale: number, ox: number, oy: number, anim?: boolean) => void;

  setMode: (m: AppMode) => void;
  togglePanel: (p: 'info' | 'edit') => void;
  setPanel: (p: PanelKind) => void;
  setDialog: (d: DialogKind) => void;
  setImmersive: (v: boolean) => void;
  setSlideshow: (v: boolean) => void;
  setCropMode: (v: boolean) => void;
  setComparing: (v: boolean) => void;
  setBusy: (msg: string | null) => void;
  setSort: (key: SortKey, dir?: SortDir) => void;
  setFilter: (f: FilterKind) => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setWin: (patch: Partial<WinState>) => void;
  toast: (
    message: string,
    opts?: { kind?: ToastItem['kind']; actionLabel?: string; action?: () => void; duration?: number },
  ) => void;
  dismissToast: (id: number) => void;
}

/* ------------------------------------------------------------------ */
/* Item helpers                                                        */
/* ------------------------------------------------------------------ */

let seq = 0;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${(seq++).toString(36)}`;

/** id → index map; rebuilt whenever the array order changes (add / sort / drop).
 *  `setMeta` / `patchMany` only mutate in place and never invalidate it. */
const idIndex = new Map<string, number>();

function rebuildIndex(images: ImageItem[]): void {
  idIndex.clear();
  for (let i = 0; i < images.length; i++) idIndex.set(images[i].id, i);
}

function indexOf(id: string): number {
  const i = idIndex.get(id);
  return i === undefined ? -1 : i;
}

function baseItem(): Omit<ImageItem, 'id' | 'file' | 'url' | 'originalUrl' | 'remote' | 'name' | 'path' | 'size' | 'type' | 'lastModified'> {
  return {
    addedAt: seq++,
    width: 0,
    height: 0,
    origWidth: 0,
    origHeight: 0,
    thumb: null,
    thumbState: 'idle',
    kind: 'image',
    rotation: 0,
    flipH: false,
    flipV: false,
    favorite: false,
    adjust: { ...DEFAULT_ADJUST },
    cropped: false,
    error: false,
  };
}

export function createItem(file: File, path?: string, extra?: Partial<ImageItem>): ImageItem {
  const url = URL.createObjectURL(file);
  const name = file.name || `图片_${seq}.png`;
  return {
    ...baseItem(),
    id: uid(),
    file,
    url,
    originalUrl: url,
    remote: false,
    name,
    path: path || name,
    size: file.size,
    type: file.type || guessMime(name),
    kind: kindOf(name, file.type),
    lastModified: file.lastModified || Date.now(),
    ...extra,
  };
}

/** An image registered from a filesystem path (desktop shell): bytes stay in
 *  Rust/the asset protocol, thumbnails arrive pre-decoded from Rust. */
export function createPathItem(
  entry: { path: string; name: string; size: number; modified: number; width: number; height: number },
  thumb: string | null = null,
): ImageItem {
  const url = assetUrl(entry.path);
  return {
    ...baseItem(),
    id: uid(),
    file: null,
    url,
    originalUrl: url,
    remote: false,
    name: entry.name,
    path: entry.path,
    size: entry.size,
    type: guessMime(entry.name),
    kind: kindOf(entry.name),
    lastModified: entry.modified || Date.now(),
    addedAt: seq++,
    width: entry.width,
    height: entry.height,
    origWidth: entry.width,
    origHeight: entry.height,
    // Never fall back to the original as a thumbnail: for a big GIF that means
    // several <img> decoding and animating the same file. Rust fills it in.
    thumb,
    thumbState: thumb ? 'done' : 'loading',
  };
}

export function createRemoteItem(url: string, name: string, lastModified: number, credit?: string): ImageItem {
  return {
    ...baseItem(),
    id: uid(),
    file: null,
    url,
    originalUrl: url,
    remote: true,
    name,
    path: `示例/${name}`,
    size: 0,
    type: guessMime(name) || 'image/jpeg',
    lastModified,
    credit,
  };
}

function revokeThumb(it: ImageItem) {
  if (it.thumb && it.thumb.startsWith('blob:') && it.thumb !== it.url && it.thumb !== it.originalUrl) {
    URL.revokeObjectURL(it.thumb);
  }
}

function revokeItem(it: ImageItem) {
  revokeThumb(it);
  if (it.remote) return;
  URL.revokeObjectURL(it.url);
  if (it.originalUrl !== it.url) URL.revokeObjectURL(it.originalUrl);
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function sortImages(list: ImageItem[], key: SortKey, dir: SortDir): ImageItem[] {
  const m = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    let r = 0;
    switch (key) {
      case 'name':
        r = collator.compare(a.path || a.name, b.path || b.name);
        break;
      case 'date':
        r = a.lastModified - b.lastModified;
        break;
      case 'size':
        r = a.size - b.size;
        break;
      case 'type':
        r = collator.compare(extOf(a.name), extOf(b.name));
        break;
      case 'added':
        r = a.addedAt - b.addedAt;
        break;
    }
    if (r === 0) r = collator.compare(a.name, b.name);
    return r * m;
  });
}

/* ------------------------------------------------------------------ */
/* Derived helpers                                                     */
/* ------------------------------------------------------------------ */

type S = Store;

export function getCurrent(s: Pick<S, 'images' | 'currentId'>): ImageItem | null {
  return s.currentId ? (s.images.find((i) => i.id === s.currentId) ?? null) : null;
}

export function getVisible(s: Pick<S, 'images' | 'filter'>): ImageItem[] {
  return s.filter === 'favorites' ? s.images.filter((i) => i.favorite) : s.images;
}

export function fitPad(s: Pick<S, 'cropMode' | 'immersive'>): number {
  return s.cropMode ? 64 : s.immersive ? 0 : 16;
}

export function computeFitScale(
  item: ImageItem | null,
  vp: { w: number; h: number },
  upscale: boolean,
  pad: number,
): number {
  if (!item || !item.width || !item.height || vp.w <= 0 || vp.h <= 0) return 1;
  const { w, h } = visualSize(item);
  const aw = Math.max(40, vp.w - pad * 2);
  const ah = Math.max(40, vp.h - pad * 2);
  const sc = Math.min(aw / w, ah / h);
  return upscale ? sc : Math.min(1, sc);
}

export function fitScaleOf(s: S): number {
  return computeFitScale(getCurrent(s), s.viewport, s.settings.upscaleSmall, fitPad(s));
}

export function effScale(s: S): number {
  return s.view.fit ? fitScaleOf(s) : s.view.zoom;
}

export function isPannable(s: S): boolean {
  const it = getCurrent(s);
  if (!it || !it.width || !it.height) return false;
  const sc = effScale(s);
  const { w, h } = visualSize(it);
  return w * sc > s.viewport.w + 1 || h * sc > s.viewport.h + 1;
}

function zoomLimits(item: ImageItem, fitScale: number) {
  const maxSide = Math.max(item.width, item.height, 1);
  const max = Math.max(1, Math.min(ZOOM_MAX, 60000 / maxSide));
  const min = Math.min(ZOOM_MIN, fitScale);
  return { min, max };
}

function clampOffset(ox: number, oy: number, item: ImageItem, scale: number, vp: { w: number; h: number }) {
  const { w, h } = visualSize(item);
  const mx = Math.max(0, (w * scale - vp.w) / 2);
  const my = Math.max(0, (h * scale - vp.h) / 2);
  return { ox: clamp(ox, -mx, mx), oy: clamp(oy, -my, my) };
}

let toastSeq = 1;

/** Desktop direct open: the launched image is part of the very first render. */
const bootImages: ImageItem[] = (readBoot()?.entries ?? []).map((e) => createPathItem(e));
const bootCurrent = bootImages[Math.min(readBoot()?.selected ?? 0, Math.max(0, bootImages.length - 1))] ?? null;

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const S = () => useStore.getState();

export const useStore = create<Store>()((set, get) => ({
  images: bootImages,
  currentId: bootCurrent ? bootCurrent.id : null,
  mode: 'viewer',
  sortKey: 'name',
  sortDir: 'asc',
  filter: 'all',
  viewport: { w: 0, h: 0 },
  view: fitView(0),
  panel: null,
  dialog: null,
  immersive: false,
  slideshow: false,
  cropMode: false,
  comparing: false,
  busy: null,
  settings: loadSettings(),
  toasts: [],
  lastRemoved: null,
  win: { max: true, min: false, closed: false },

  addItems: (items, opts = {}) => {
    if (!items.length) return;
    const s = get();
    if (opts.replace) {
      s.images.forEach(revokeItem);
      if (s.lastRemoved) revokeItem(s.lastRemoved.item);
      thumbQueue.length = 0;
    }
    const base = opts.replace ? [] : s.images;
    const images = sortImages([...base, ...items], s.sortKey, s.sortDir);
    rebuildIndex(images);
    const ids = new Set(items.map((i) => i.id));
    const first = images.find((i) => ids.has(i.id)) ?? null;
    set({
      images,
      currentId: first ? first.id : s.currentId,
      filter: 'all',
      mode: 'viewer',
      view: fitView(s.view.tick + 1),
      cropMode: false,
      comparing: false,
      lastRemoved: opts.replace ? null : s.lastRemoved,
      win: { ...s.win, closed: false, min: false },
    });
    enqueueThumbs(images.filter((i) => ids.has(i.id)).map((i) => i.id));
  },

  mergeItems: (items) => {
    if (!items.length) return;
    const s = get();
    const images = sortImages([...s.images, ...items], s.sortKey, s.sortDir);
    rebuildIndex(images);
    set({ images });
  },

  patchMany: (patches) => {
    if (!patches.size) return;
    set((s) => {
      let changed = false;
      const images = s.images.slice();
      patches.forEach((patch, id) => {
        const idx = indexOf(id);
        if (idx < 0) return;
        const cur = images[idx];
        const next = { ...cur, ...patch };
        if (next === cur) return;
        images[idx] = next;
        changed = true;
      });
      return changed ? { images } : {};
    });
  },

  addFiles: (inputs, opts) => {
    const items = inputs.map(({ file, path }) => createItem(file, path));
    get().addItems(items, opts);
    return items.length;
  },

  setMeta: (id, patch) => {
    const idx = indexOf(id);
    if (idx < 0) return;
    set((s) => {
      const images = s.images.slice();
      const cur = images[idx];
      images[idx] = { ...cur, ...patch };
      return { images };
    });
  },

  removeImage: (id) => {
    const s = get();
    const idx = indexOf(id);
    if (idx < 0) return;
    const item = s.images[idx];
    let nextId = s.currentId;
    let filter = s.filter;
    if (s.currentId === id) {
      const list = getVisible(s);
      const vi = list.findIndex((i) => i.id === id);
      const nxt = list[vi + 1] ?? list[vi - 1] ?? null;
      nextId = nxt ? nxt.id : null;
    }
    const images = s.images.slice();
    images.splice(idx, 1);
    rebuildIndex(images);
    if (!nextId && images.length) {
      nextId = images[0].id;
      filter = 'all';
    }
    if (s.lastRemoved) revokeItem(s.lastRemoved.item);
    set({
      images,
      currentId: images.length ? nextId : null,
      filter,
      lastRemoved: { item },
      view: s.currentId === id ? fitView(s.view.tick + 1) : s.view,
      cropMode: false,
      comparing: false,
      mode: images.length ? s.mode : 'viewer',
      panel: images.length ? s.panel : null,
    });
    get().toast(`已从列表中移除“${item.name}”`, {
      actionLabel: '撤销',
      action: () => get().undoRemove(),
      duration: 6000,
    });
  },

  undoRemove: () => {
    const s = get();
    if (!s.lastRemoved) return;
    let item = s.lastRemoved.item;
    if (item.thumbState !== 'done') item = { ...item, thumbState: 'idle' };
    const images = sortImages([...s.images, item], s.sortKey, s.sortDir);
    rebuildIndex(images);
    set({ images, currentId: item.id, lastRemoved: null, view: fitView(s.view.tick + 1) });
    if (item.thumbState === 'idle') enqueueThumbs([item.id]);
  },

  closeAll: () => {
    const s = get();
    s.images.forEach(revokeItem);
    if (s.lastRemoved) revokeItem(s.lastRemoved.item);
    thumbQueue.length = 0;
    idIndex.clear();
    set({
      images: [],
      currentId: null,
      lastRemoved: null,
      mode: 'viewer',
      panel: null,
      cropMode: false,
      comparing: false,
      slideshow: false,
      filter: 'all',
      view: fitView(s.view.tick + 1),
    });
  },

  toggleFavorite: (id) => {
    const idx = indexOf(id);
    if (idx < 0) return;
    set((s) => {
      const images = s.images.slice();
      const cur = images[idx];
      if (!cur) return {};
      images[idx] = { ...cur, favorite: !cur.favorite };
      return { images };
    });
  },

  rotate: (id, delta) => {
    const idx = indexOf(id);
    if (idx < 0) return;
    set((s) => {
      const images = s.images.slice();
      const cur = images[idx];
      images[idx] = { ...cur, rotation: cur.rotation + delta };
      return {
        images,
        view: id === s.currentId ? fitView(s.view.tick + 1, true) : s.view,
      };
    });
  },

  flip: (id, axis) => {
    const idx = indexOf(id);
    if (idx < 0) return;
    set((s) => {
      const images = s.images.slice();
      const cur = images[idx];
      // flip relative to the screen, not the (possibly rotated) image
      const swap = normRot(cur.rotation) % 180 !== 0;
      const real = swap ? (axis === 'h' ? 'v' : 'h') : axis;
      images[idx] = real === 'h' ? { ...cur, flipH: !cur.flipH } : { ...cur, flipV: !cur.flipV };
      return { images, view: id === s.currentId ? { ...s.view, anim: true } : s.view };
    });
  },

  setAdjust: (id, patch) => {
    const idx = indexOf(id);
    if (idx < 0) return;
    set((s) => {
      const images = s.images.slice();
      const cur = images[idx];
      images[idx] = { ...cur, adjust: { ...cur.adjust, ...patch } };
      return { images };
    });
  },

  replaceAdjust: (id, adjust) => {
    const idx = indexOf(id);
    if (idx < 0) return;
    set((s) => {
      const images = s.images.slice();
      const cur = images[idx];
      images[idx] = { ...cur, adjust: { ...adjust } };
      return { images };
    });
  },

  applyEdit: (id, blob, width, height) => {
    const url = URL.createObjectURL(blob);
    const idx = indexOf(id);
    if (idx < 0) return;
    set((s) => {
      const images = s.images.slice();
      const cur = images[idx];
      if (cur.url !== cur.originalUrl && !cur.remote) URL.revokeObjectURL(cur.url);
      revokeThumb(cur);
      images[idx] = {
        ...cur,
        url,
        width,
        height,
        rotation: 0,
        flipH: false,
        flipV: false,
        cropped: true,
        thumb: null,
        thumbState: 'idle' as const,
      };
      return { images, cropMode: false, view: fitView(s.view.tick + 1, true) };
    });
    enqueueThumbs([id]);
  },

  revertEdits: (id) => {
    const idx = indexOf(id);
    if (idx < 0) return;
    set((s) => {
      const images = s.images.slice();
      const cur = images[idx];
      const urlChanged = cur.url !== cur.originalUrl;
      if (urlChanged) {
        URL.revokeObjectURL(cur.url);
        revokeThumb(cur);
      }
      images[idx] = {
        ...cur,
        url: cur.originalUrl,
        width: cur.origWidth || cur.width,
        height: cur.origHeight || cur.height,
        rotation: 0,
        flipH: false,
        flipV: false,
        cropped: false,
        adjust: { ...DEFAULT_ADJUST },
        ...(urlChanged ? { thumb: null, thumbState: 'idle' as const } : {}),
      };
      return { images, view: s.currentId === id ? fitView(s.view.tick + 1, true) : s.view };
    });
    enqueueThumbs([id]);
  },

  goTo: (id) => {
    const s = get();
    if (id === s.currentId) return;
    set({ currentId: id, view: fitView(s.view.tick + 1), cropMode: false, comparing: false });
  },

  step: (d) => {
    const s = get();
    const list = getVisible(s);
    if (!list.length) return;
    const i = list.findIndex((x) => x.id === s.currentId);
    if (i < 0) {
      get().goTo(list[0].id);
      return;
    }
    let ni = i + d;
    if (ni < 0 || ni >= list.length) {
      if (!s.settings.loop || list.length < 2) return;
      ni = (ni + list.length) % list.length;
    }
    get().goTo(list[ni].id);
  },

  first: () => {
    const l = getVisible(get());
    if (l.length) get().goTo(l[0].id);
  },

  last: () => {
    const l = getVisible(get());
    if (l.length) get().goTo(l[l.length - 1].id);
  },

  setViewport: (w, h) => {
    const s = get();
    if (Math.abs(s.viewport.w - w) < 0.5 && Math.abs(s.viewport.h - h) < 0.5) return;
    const vp = { w, h };
    const item = getCurrent(s);
    if (s.view.fit || !item) {
      set({ viewport: vp, view: { ...s.view, anim: false } });
      return;
    }
    const { ox, oy } = clampOffset(s.view.ox, s.view.oy, item, s.view.zoom, vp);
    set({ viewport: vp, view: { ...s.view, ox, oy, anim: false } });
  },

  zoomTo: (scale, anchor, anim = true) => {
    const s = get();
    const item = getCurrent(s);
    if (!item || !item.width || !item.height) return;
    const cur = effScale(s);
    const lim = zoomLimits(item, fitScaleOf(s));
    const ns = clamp(scale, lim.min, lim.max);
    const ax = anchor?.x ?? 0;
    const ay = anchor?.y ?? 0;
    const k = ns / cur;
    const baseX = s.view.fit ? 0 : s.view.ox;
    const baseY = s.view.fit ? 0 : s.view.oy;
    const { ox, oy } = clampOffset(ax - (ax - baseX) * k, ay - (ay - baseY) * k, item, ns, s.viewport);
    set({ view: { zoom: ns, fit: false, ox, oy, anim, tick: s.view.tick + 1 } });
  },

  zoomStep: (dir, anchor) => {
    const s = get();
    const cur = effScale(s);
    const target =
      dir > 0
        ? (ZOOM_LEVELS.find((l) => l > cur * 1.02) ?? ZOOM_MAX)
        : ([...ZOOM_LEVELS].reverse().find((l) => l < cur / 1.02) ?? ZOOM_MIN);
    get().zoomTo(target, anchor, true);
  },

  wheelZoom: (deltaY, anchor) => {
    const s = get();
    const factor = clamp(Math.exp(-deltaY * 0.0018), 0.5, 2);
    get().zoomTo(effScale(s) * factor, anchor, false);
  },

  fitToWindow: () => set((s) => ({ view: fitView(s.view.tick + 1, true) })),

  actualSize: (anchor) => get().zoomTo(1, anchor, true),

  toggleFitActual: (anchor) => {
    const s = get();
    const fs = fitScaleOf(s);
    const cur = effScale(s);
    if (s.view.fit || Math.abs(cur - fs) < 0.001) {
      get().zoomTo(Math.abs(fs - 1) < 0.001 ? 2 : 1, anchor, true);
    } else {
      get().fitToWindow();
    }
  },

  panBy: (dx, dy, anim = false) => {
    const s = get();
    if (s.view.fit) return;
    const item = getCurrent(s);
    if (!item) return;
    const { ox, oy } = clampOffset(s.view.ox + dx, s.view.oy + dy, item, s.view.zoom, s.viewport);
    if (ox === s.view.ox && oy === s.view.oy) return;
    set({ view: { ...s.view, ox, oy, anim } });
  },

  setView: (scale, ox, oy, anim = false) => {
    const s = get();
    const item = getCurrent(s);
    if (!item || !item.width) return;
    const lim = zoomLimits(item, fitScaleOf(s));
    const ns = clamp(scale, lim.min, lim.max);
    const c = clampOffset(ox, oy, item, ns, s.viewport);
    const changed = Math.abs(ns - effScale(s)) > 1e-6;
    set({ view: { zoom: ns, fit: false, ox: c.ox, oy: c.oy, anim, tick: changed ? s.view.tick + 1 : s.view.tick } });
  },

  setMode: (m) =>
    set((s) => ({
      mode: m,
      cropMode: false,
      comparing: false,
      panel: m === 'gallery' && s.panel === 'edit' ? null : s.panel,
    })),
  togglePanel: (p) => set((s) => ({ panel: s.panel === p ? null : p })),
  setPanel: (p) => set({ panel: p }),
  setDialog: (d) => set({ dialog: d }),
  setImmersive: (v) => set({ immersive: v }),
  setSlideshow: (v) => set({ slideshow: v }),
  setCropMode: (v) =>
    set((s) => ({ cropMode: v, comparing: false, mode: 'viewer', view: fitView(s.view.tick + 1, true) })),
  setComparing: (v) => set({ comparing: v }),
  setBusy: (msg) => set({ busy: msg }),
  setSort: (key, dir) =>
    set((s) => {
      const d = dir ?? s.sortDir;
      const images = sortImages(s.images, key, d);
      rebuildIndex(images);
      return { sortKey: key, sortDir: d, images };
    }),
  setFilter: (f) =>
    set((s) => {
      const list = f === 'favorites' ? s.images.filter((i) => i.favorite) : s.images;
      const keep = list.some((i) => i.id === s.currentId);
      return {
        filter: f,
        currentId: keep ? s.currentId : (list[0]?.id ?? s.currentId),
        view: keep ? s.view : fitView(s.view.tick + 1),
      };
    }),
  setSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),
  setWin: (patch) => set((s) => ({ win: { ...s.win, ...patch } })),

  toast: (message, opts = {}) => {
    const id = toastSeq++;
    const t: ToastItem = { id, message, kind: opts.kind ?? 'info', actionLabel: opts.actionLabel, action: opts.action };
    set((s) => ({ toasts: [...s.toasts.slice(-2), t] }));
    window.setTimeout(() => get().dismissToast(id), opts.duration ?? 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/* ------------------------------------------------------------------ */
/* Thumbnail queue                                                     */
/* ------------------------------------------------------------------ */

const thumbQueue: string[] = [];
let thumbActive = 0;
/** Batched updates: many async decoders can finish in the same tick. We
 *  collect their results into one Map and let one `patchMany` cover all of
 *  them, so importing 1000 photos is one render per microtask instead of
 *  one per finished thumbnail. The Map is reassigned (not mutated in place)
 *  so producers that fire during the commit don't overwrite the snapshot
 *  the commit is reading. */
let pendingPatches: Map<string, Partial<ImageItem>> = new Map();
let flushScheduled = false;

function flushThumbPatches() {
  flushScheduled = false;
  const patches = pendingPatches;
  pendingPatches = new Map();
  if (patches.size) useStore.getState().patchMany(patches);
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flushThumbPatches);
}

function enqueueThumbs(ids: string[]) {
  thumbQueue.push(...ids);
  pumpThumbs();
}

function pumpThumbs() {
  while (thumbActive < 3 && thumbQueue.length) {
    const id = thumbQueue.shift() as string;
    const item = useStore.getState().images.find((i) => i.id === id);
    if (!item || item.thumbState === 'done' || item.thumbState === 'loading') continue;
    thumbActive++;
    const url = item.url;
    pendingPatches.set(id, { thumbState: 'loading' });
    scheduleFlush();
    const isVideo = item.kind === 'video';
    const task: Promise<{ thumb: string; width: number; height: number } | null> = isVideo
      ? makeVideoThumb(url)
      : item.remote
        ? loadImageEl(url).then((img) => ({ thumb: url, width: img.naturalWidth || 1024, height: img.naturalHeight || 1024 }))
        : makeThumb(url).then((r) => r as { thumb: string; width: number; height: number });
    task
      .then((res) => {
        const st = useStore.getState();
        const cur = st.images.find((i) => i.id === id);
        if (!cur || cur.url !== url) {
          if (res && res.thumb !== url && res.thumb.startsWith('blob:')) URL.revokeObjectURL(res.thumb);
          if (cur) {
            pendingPatches.set(id, { thumbState: 'idle' });
            scheduleFlush();
            thumbQueue.push(id);
          }
          return;
        }
        if (!res) {
          // Undecodable video (e.g. HEVC without the codec): placeholder, not an error.
          pendingPatches.set(id, { thumb: null, thumbState: 'done' });
          scheduleFlush();
          return;
        }
        pendingPatches.set(id, {
          thumb: res.thumb,
          thumbState: 'done',
          width: cur.width || res.width,
          height: cur.height || res.height,
          origWidth: cur.origWidth || res.width,
          origHeight: cur.origHeight || res.height,
        });
        scheduleFlush();
      })
      .catch(() => {
        const st = useStore.getState();
        const cur = st.images.find((i) => i.id === id);
        if (cur && cur.url === url) {
          pendingPatches.set(id, isVideo ? { thumb: null, thumbState: 'done' } : { thumbState: 'error', error: true });
          scheduleFlush();
        }
      })
      .finally(() => {
        thumbActive--;
        pumpThumbs();
      });
  }
}

/* ------------------------------------------------------------------ */
/* Persistence & hooks                                                 */
/* ------------------------------------------------------------------ */

useStore.subscribe((s, prev) => {
  if (s.settings !== prev.settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s.settings));
    } catch {
      /* ignore */
    }
  }
});

export function useVisibleImages(): ImageItem[] {
  const images = useStore((s) => s.images);
  const filter = useStore((s) => s.filter);
  return useMemo(() => (filter === 'favorites' ? images.filter((i) => i.favorite) : images), [images, filter]);
}

export function useCurrent(): ImageItem | null {
  return useStore((s) => getCurrent(s));
}
