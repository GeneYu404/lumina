import type { Adjustments, ImageItem } from '../types';
import { toHex } from './color';

export const DEFAULT_ADJUST: Adjustments = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hue: 0,
  temperature: 0,
  vignette: 0,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  blur: 0,
};

const ADJ_KEYS = Object.keys(DEFAULT_ADJUST) as (keyof Adjustments)[];

export function isAdjusted(a: Adjustments): boolean {
  return ADJ_KEYS.some((k) => a[k] !== DEFAULT_ADJUST[k]);
}

export function sameAdjust(a: Adjustments, b: Adjustments): boolean {
  return ADJ_KEYS.every((k) => a[k] === b[k]);
}

export const normRot = (r: number) => ((r % 360) + 360) % 360;

export function isEdited(item: ImageItem): boolean {
  return isAdjusted(item.adjust) || normRot(item.rotation) !== 0 || item.flipH || item.flipV || item.cropped;
}

/** Size of the image after rotation (what the user actually sees). */
export function visualSize(item: Pick<ImageItem, 'width' | 'height' | 'rotation'>) {
  return normRot(item.rotation) % 180 === 0
    ? { w: item.width, h: item.height }
    : { w: item.height, h: item.width };
}

/** Rotates the canvas so `ctx.drawImage(img, ...)` produces a correctly oriented
 *  thumbnail even when `img` carries an EXIF Orientation we did not strip.
 *  Returns the *visual* (post-rotation) width/height. */
function drawOriented(img: HTMLImageElement, ctx: CanvasRenderingContext2D, orientation: number, tw: number, th: number): { w: number; h: number } {
  if (!orientation || orientation === 1) {
    ctx.drawImage(img, 0, 0, tw, th);
    return { w: tw, h: th };
  }
  // 90-degree rotations swap the visible aspect ratio.
  const swap = orientation >= 5;
  const outW = swap ? th : tw;
  const outH = swap ? tw : th;
  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  switch (orientation) {
    case 2: ctx.scale(-1, 1); break;                                 // mirror H
    case 3: ctx.rotate(Math.PI); break;                              // 180°
    case 4: ctx.scale(1, -1); break;                                 // mirror V
    case 5: ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); break;        // mirror H + 90° CW
    case 6: ctx.rotate(Math.PI / 2); break;                          // 90° CW
    case 7: ctx.rotate(-Math.PI / 2); ctx.scale(-1, 1); break;       // mirror H + 90° CCW
    case 8: ctx.rotate(-Math.PI / 2); break;                         // 90° CCW
  }
  ctx.drawImage(img, -tw / 2, -th / 2, tw, th);
  ctx.restore();
  return { w: outW, h: outH };
}

/** Blur radius expressed in natural image pixels. */
export function blurNatural(a: Adjustments, w: number, h: number) {
  return (a.blur / 100) * Math.max(w, h, 1) * 0.02;
}

export function cssFilter(a: Adjustments, blurPx: number): string {
  const parts: string[] = [];
  if (a.brightness !== 100) parts.push(`brightness(${a.brightness / 100})`);
  if (a.contrast !== 100) parts.push(`contrast(${a.contrast / 100})`);
  if (a.saturate !== 100) parts.push(`saturate(${a.saturate / 100})`);
  if (a.hue !== 0) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.grayscale) parts.push(`grayscale(${a.grayscale / 100})`);
  if (a.sepia) parts.push(`sepia(${a.sepia / 100})`);
  if (a.invert) parts.push(`invert(${a.invert / 100})`);
  if (blurPx > 0.05) parts.push(`blur(${blurPx.toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

/** Colour of the soft-light overlay used to simulate white-balance temperature. */
export function temperatureColor(t: number): string | null {
  if (!t) return null;
  const a = (Math.min(100, Math.abs(t)) / 100) * 0.6;
  return t > 0 ? `rgba(255, 136, 24, ${a.toFixed(3)})` : `rgba(24, 118, 255, ${a.toFixed(3)})`;
}

export function vignetteParams(v: number) {
  return { inner: Math.max(0, 0.7 - v * 0.0035), alpha: (v / 100) * 0.85 };
}

export function vignetteGradient(v: number): string | null {
  if (!v) return null;
  const { inner, alpha } = vignetteParams(v);
  return `radial-gradient(ellipse at center, rgba(0,0,0,0) ${(inner * 100).toFixed(1)}%, rgba(0,0,0,${alpha.toFixed(3)}) 100%)`;
}

export function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('编码失败'))), type, quality);
  });
}

export async function makeThumb(url: string, max = 320): Promise<{ thumb: string; width: number; height: number }> {
  const img = await loadImageEl(url);
  const width = img.naturalWidth || 1024;
  const height = img.naturalHeight || 1024;
  try {
    const s = Math.min(1, max / Math.max(width, height));
    const tw = Math.max(1, Math.round(width * s));
    const th = Math.max(1, Math.round(height * s));
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no ctx');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const orientation = await readOrientationFromBlob(url).catch(() => 1);
    const swap = orientation >= 5;
    c.width = swap ? th : tw;
    c.height = swap ? tw : th;
    const { w: vw, h: vh } = drawOriented(img, ctx, orientation, tw, th);
    const blob = await canvasToBlob(c, 'image/webp', 0.84);
    return { thumb: URL.createObjectURL(blob), width: vw, height: vh };
  } catch {
    return { thumb: url, width, height };
  }
}

/** Resolve the EXIF orientation of an image behind `url` (used by web-mode
 *  thumbnail/stat rendering). Path items already report the visual size from
 *  Rust; this only matters for File objects. */
async function readOrientationFromBlob(url: string): Promise<number> {
  // Cheap path: we already have a Blob cached from the web picker? Not here.
  // For images hosted over http(s) we fetch; for blob: URLs we fetch them too.
  // The round-trip is only paid once per image and the result is memoised.
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const { readOrientationIfBlob } = await import('./orientation');
    return (await readOrientationIfBlob(blob)) || 1;
  } catch {
    return 1;
  }
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RenderOptions {
  width?: number;
  height?: number;
  crop?: CropRect; // in rotated ("visual") natural pixels
  adjust?: boolean;
  transform?: boolean;
  background?: string | null;
}

/** Renders an item (rotation, flip, crop, adjustments, resize) into a canvas. */
export async function renderItem(item: ImageItem, opts: RenderOptions = {}): Promise<HTMLCanvasElement> {
  if (item.remote) throw new Error('remote');
  if (item.kind === 'video') throw new Error('video');
  // Desktop path items display via the asset protocol, but a canvas needs
  // same-origin bytes: fetch this one file through Rust (single invoke).
  let source = item.url;
  if (!item.file && !item.url.startsWith('blob:') && item.path) {
    try {
      const { isDesktop, readItemBytes } = await import('../desktop');
      if (isDesktop) source = URL.createObjectURL(await readItemBytes(item.path));
    } catch {
      /* fall through and try the display URL directly */
    }
  }
  const img = await loadImageEl(source).finally(() => {
    if (source !== item.url) window.setTimeout(() => URL.revokeObjectURL(source), 5000);
  });
  const nw = img.naturalWidth || item.width || 1024;
  const nh = img.naturalHeight || item.height || 1024;
  const useT = opts.transform !== false;
  const rot = useT ? normRot(item.rotation) : 0;
  const fh = useT && item.flipH;
  const fv = useT && item.flipV;
  const ew = rot % 180 ? nh : nw;
  const eh = rot % 180 ? nw : nh;
  const cr = opts.crop ?? { x: 0, y: 0, w: ew, h: eh };
  const outW = Math.max(1, Math.round(opts.width ?? cr.w));
  const outH = Math.max(1, Math.round(opts.height ?? cr.h));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  const sx = outW / cr.w;
  const sy = outH / cr.h;
  const a = item.adjust;
  const applyAdj = !!opts.adjust && isAdjusted(a);
  const supportsFilter = typeof (ctx as CanvasRenderingContext2D & { filter?: string }).filter === 'string';

  const drawBase = () => {
    ctx.save();
    ctx.scale(sx, sy);
    ctx.translate(-cr.x, -cr.y);
    ctx.translate(ew / 2, eh / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(fh ? -1 : 1, fv ? -1 : 1);
    ctx.drawImage(img, -nw / 2, -nh / 2, nw, nh);
    ctx.restore();
  };

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (applyAdj && supportsFilter) ctx.filter = cssFilter(a, blurNatural(a, nw, nh) * ((sx + sy) / 2));
  drawBase();
  if (supportsFilter) ctx.filter = 'none';

  if (applyAdj && (a.temperature || a.vignette)) {
    ctx.save();
    ctx.scale(sx, sy);
    ctx.translate(-cr.x, -cr.y);
    const tc = temperatureColor(a.temperature);
    if (tc) {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = tc;
      ctx.fillRect(0, 0, ew, eh);
    }
    if (a.vignette) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.translate(ew / 2, eh / 2);
      ctx.scale((ew / 2) * Math.SQRT2, (eh / 2) * Math.SQRT2);
      const { inner, alpha } = vignetteParams(a.vignette);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(inner, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${alpha})`);
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
    }
    ctx.restore();
    // keep the original transparency
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    drawBase();
    ctx.restore();
  }

  if (opts.background) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, outW, outH);
    ctx.restore();
  }
  return canvas;
}

export interface ImageStats {
  r: number[];
  g: number[];
  b: number[];
  l: number[];
  palette: string[];
}

/** Histogram + dominant colours (computed from a small version of the image). */
export async function computeStats(url: string): Promise<ImageStats> {
  const img = await loadImageEl(url);
  const w0 = img.naturalWidth || 200;
  const h0 = img.naturalHeight || 200;
  const s = Math.min(1, 220 / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s));
  const h = Math.max(1, Math.round(h0 * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const r = new Array<number>(256).fill(0);
  const g = new Array<number>(256).fill(0);
  const b = new Array<number>(256).fill(0);
  const l = new Array<number>(256).fill(0);
  const bins = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const R = data[i];
    const G = data[i + 1];
    const B = data[i + 2];
    r[R]++;
    g[G]++;
    b[B]++;
    l[Math.min(255, Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B))]++;
    const key = ((R >> 4) << 8) | ((G >> 4) << 4) | (B >> 4);
    const bin = bins.get(key);
    if (bin) {
      bin.r += R;
      bin.g += G;
      bin.b += B;
      bin.n++;
    } else bins.set(key, { r: R, g: G, b: B, n: 1 });
  }
  const sorted = [...bins.values()].sort((x, y) => y.n - x.n);
  const picked: [number, number, number][] = [];
  for (const bin of sorted) {
    const col: [number, number, number] = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n];
    if (picked.every((p) => Math.hypot(p[0] - col[0], p[1] - col[1], p[2] - col[2]) > 56)) picked.push(col);
    if (picked.length >= 6) break;
  }
  return { r, g, b, l, palette: picked.map((p) => toHex(p[0], p[1], p[2])) };
}
