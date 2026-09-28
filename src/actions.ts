import { createItem, createPathItem, createRemoteItem, getCurrent, getVisible, getStreamGen, requestThumbs, useStore } from './store';
import type { FileInput, ImageItem } from './types';
import { ACCEPT, fromFileList, isMediaFile } from './utils/files';
import { canvasToBlob, isAdjusted, normRot, renderItem } from './utils/image';
import { REMOTE_SAMPLES, svgSamples } from './utils/samples';
import { clamp, escapeHtml, extOf, formatBytes, stamp } from './utils/format';
import { decodeSubtitleBuffer, toWebVtt } from './utils/subtitle';
import {
  collectPaths,
  describeBatch,
  isDesktop,
  launchSiblings,
  openWithDefault,
  pickFolder,
  pickImages,
  readBoot,
  setDesktopFullscreen,
  type DesktopEntry,
} from './desktop';
import { readSession } from './native';

const st = () => useStore.getState();

/* ------------------------------ Open ------------------------------ */

let picker: HTMLInputElement | null = null;
function getPicker(): HTMLInputElement {
  if (!picker) {
    picker = document.createElement('input');
    picker.type = 'file';
    picker.style.display = 'none';
    document.body.appendChild(picker);
  }
  return picker;
}

/* ------------------------- Streaming import ------------------------- */

/** Paths described per IPC round trip. The first batch lands before anything
 *  else — opening a huge folder must feel instant, the tail streams behind. */
const IMPORT_BATCH = 1000;

/**
 * Probe `paths` in batches without ever yanking the viewer: batch one is
 * adopted (replace or select), later batches merge in the background and
 * stop as soon as the visible list is replaced (the store bumps its epoch).
 * Returns how many paths are being loaded.
 */
async function importStream(
  paths: string[],
  opts: { replace?: boolean; selectedPath?: string | null } = {},
): Promise<number> {
  if (!paths.length) return 0;
  const first = await describeBatch(paths.slice(0, IMPORT_BATCH));
  if (!first.length) return 0;
  const selected = opts.selectedPath ? Math.max(0, first.findIndex((e) => e.path === opts.selectedPath)) : 0;
  await adoptEntries(first, { replace: opts.replace ?? true, selected });
  const gen = getStreamGen();
  if (paths.length > IMPORT_BATCH) void mergeBatches(paths.slice(IMPORT_BATCH), gen);
  return paths.length;
}

/** Background tail of a streaming import: probe + merge, never select. */
async function mergeBatches(paths: string[], gen: number) {
  for (let off = 0; off < paths.length; off += IMPORT_BATCH) {
    if (gen !== getStreamGen()) return;
    let batch: DesktopEntry[];
    try {
      batch = await describeBatch(paths.slice(off, off + IMPORT_BATCH));
    } catch {
      continue; // one bad chunk must not abandon the remaining chunks
    }
    if (gen !== getStreamGen()) return;
    const have = new Set(st().images.map((i) => i.path));
    const items = batch.filter((e) => !have.has(e.path)).map((e) => createPathItem(e));
    if (items.length) st().mergeItems(items);
  }
}

/** Put entries in the store right away (viewer shows immediately), thumbnails follow. */
async function adoptEntries(entries: DesktopEntry[], opts: { replace?: boolean; selected?: number } = {}) {
  if (!entries.length) return;
  const replace = opts.replace ?? false;
  // Dropping the same folder twice should not duplicate rows.
  let list = entries;
  if (!replace) {
    const have = new Set(st().images.map((i) => i.path));
    list = entries.filter((e) => !have.has(e.path));
    if (!list.length) return;
  }
  const items = list.map((e) => createPathItem(e));
  const index = Math.min(Math.max(opts.selected ?? 0, 0), items.length - 1);
  st().addItems(items, { replace });
  if (items[index]) st().goTo(items[index].id);
}

/** Desktop: paths in → Rust walk + batched probe → store. */
export async function openPaths(paths: string[], opts: { replace?: boolean; folder?: boolean } = {}) {
  if (!isDesktop || !paths.length) return;
  const s = st();
  s.setBusy('正在读取文件…');
  try {
    // Walk first (cheap even at 100k files), probe in batches: the first
    // thousand entries show immediately, the tail merges in behind them.
    const all = await collectPaths(paths);
    if (!all.length) {
      s.toast('所选内容中没有支持的图片或视频', { kind: 'error' });
      return;
    }
    const total = await importStream(all, { replace: opts.replace ?? true });
    if (total) s.toast(`已打开 ${total} 个文件`, { kind: 'success' });
  } catch {
    s.toast('无法读取所选路径', { kind: 'error' });
  } finally {
    s.setBusy(null);
  }
}

export function openFiles(replace = true) {
  if (isDesktop) {
    void (async () => {
      try {
        const paths = await pickImages();
        if (paths.length) await openPaths(paths, { replace });
      } catch {
        st().toast('无法打开文件选择器', { kind: 'error' });
      }
    })();
    return;
  }
  const input = getPicker();
  input.webkitdirectory = false;
  input.multiple = true;
  input.accept = ACCEPT;
  input.value = '';
  input.onchange = () => {
    if (input.files && input.files.length) importFiles(fromFileList(input.files), { replace });
    input.value = '';
  };
  input.click();
}

export function openFolder(replace = true) {
  if (isDesktop) {
    void (async () => {
      try {
        const paths = await pickFolder();
        if (paths.length) await openPaths(paths, { replace, folder: true });
      } catch {
        st().toast('无法打开文件夹选择器', { kind: 'error' });
      }
    })();
    return;
  }
  const input = getPicker();
  input.accept = '';
  input.multiple = true;
  input.webkitdirectory = true;
  input.value = '';
  input.onchange = () => {
    if (input.files && input.files.length) importFiles(fromFileList(input.files), { replace, folder: true });
    input.value = '';
  };
  input.click();
}

export function importFiles(inputs: FileInput[], opts: { replace?: boolean; folder?: boolean } = {}) {
  const imgs = inputs.filter((i) => isMediaFile(i.file));
  if (!imgs.length) {
    st().toast(inputs.length ? '所选内容中没有支持的图片或视频' : '没有找到图片或视频', { kind: 'error' });
    return;
  }
  const replace = opts.replace ?? false;
  st().addFiles(imgs, { replace });
  const skipped = inputs.length - imgs.length;
  if (imgs.length > 1 || opts.folder) {
    st().toast(
      `已${replace ? '打开' : '添加'} ${imgs.length} 个文件${skipped > 0 ? `，跳过 ${skipped} 个不支持的文件` : ''}`,
      { kind: 'success' },
    );
  }
}

export function renamePasted(file: File): File {
  const ext = extOf(file.name) || (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file;
  return new File([file], `粘贴的图片_${stamp()}.${ext}`, { type: file.type, lastModified: Date.now() });
}

export async function pasteFromClipboard() {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') throw new Error('unsupported');
    const items = await navigator.clipboard.read();
    const files: FileInput[] = [];
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      files.push({ file: new File([blob], `粘贴的图片_${stamp()}.${ext}`, { type, lastModified: Date.now() }) });
    }
    if (!files.length) {
      st().toast('剪贴板中没有图片', { kind: 'error' });
      return;
    }
    importFiles(files, { replace: false });
    st().toast('已从剪贴板粘贴图片', { kind: 'success' });
  } catch {
    st().toast('无法读取剪贴板，请直接按 Ctrl+V 粘贴', { kind: 'error' });
  }
}

export async function loadSamples() {
  const s = st();
  if (s.busy) return;
  s.setBusy('正在加载示例图片…');
  const svgs = svgSamples().map((f) => createItem(f, `示例/${f.name}`));
  const remote = await Promise.all(
    REMOTE_SAMPLES.map(async (sm): Promise<ImageItem> => {
      const lm = Date.parse(sm.date) || Date.now();
      try {
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(sm.url, { mode: 'cors', signal: ctrl.signal });
        window.clearTimeout(timer);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const file = new File([blob], sm.name, { type: blob.type || 'image/jpeg', lastModified: lm });
        return createItem(file, `示例/${sm.name}`, { credit: sm.credit });
      } catch {
        return createRemoteItem(sm.url, sm.name, lm, sm.credit);
      }
    }),
  );
  st().setBusy(null);
  st().addItems([...remote, ...svgs], { replace: true });
  const failed = remote.filter((r) => r.remote).length;
  st().toast(
    failed
      ? `已加载示例图片（${failed} 张以在线模式显示，部分导出功能不可用）`
      : `已加载 ${remote.length + svgs.length} 张示例图片`,
    { kind: failed ? 'info' : 'success', duration: 4200 },
  );
}

/**
 * Desktop direct open (Explorer “打开方式” / double click). The launched image
 * is already on screen — Rust injected it before the page loaded. Here we only
 * do background work: merge the rest of its folder, then fill thumbnails.
 */
export async function openLaunchFiles() {
  const boot = readBoot();
  if (!isDesktop) return;
  // No file was launched: restore the last session when the user allows it.
  if (!boot) {
    if (!useStore.getState().settings.restoreSession) return;
    const session = readSession();
    if (!session) return;
    try {
      const paths = await collectPaths(session.paths);
      if (!paths.length) return;
      // Put the saved file first so batch one can restore the exact spot.
      const at = session.current ? paths.indexOf(session.current) : -1;
      if (at > 0) paths.unshift(paths.splice(at, 1)[0]);
      await importStream(paths, { replace: true, selectedPath: session.current ?? null });
    } catch {
      /* record gone: fall back to the welcome screen */
    }
    return;
  }
  if (boot.siblings) {
    try {
      const { entries, rest } = await launchSiblings();
      const have = new Set(st().images.map((i) => i.path));
      // Never yank the user: merge without changing the current image or view.
      const items = entries.filter((e) => !have.has(e.path)).map((e) => createPathItem(e));
      if (items.length) st().mergeItems(items);
      // The remainder of a huge folder streams in behind the first batch.
      if (rest.length) void mergeBatches(rest, getStreamGen());
    } catch {
      /* the launched image still works on its own */
    }
  }
  const cur = st().currentId;
  if (cur) requestThumbs([cur]);
}

/* ----------------------------- Playback ----------------------------- */

/** The viewer mounts exactly one video element; global keys drive it too. */
function videoEl(): HTMLVideoElement | null {
  return document.getElementById('pv-video') as HTMLVideoElement | null;
}

export function toggleVideoPlay() {
  const v = videoEl();
  if (!v) return;
  if (v.paused) void v.play();
  else v.pause();
}

export function seekVideo(delta: number) {
  const v = videoEl();
  if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
  v.currentTime = clamp(v.currentTime + delta, 0, Math.max(0, v.duration - 0.05));
}

export function toggleVideoMute() {
  const v = videoEl();
  if (!v) return;
  v.muted = !v.muted;
  st().setSetting('videoMuted', v.muted);
}

/** Escape hatch for codecs WebView2 can't decode: hand the file to Windows. */
export function openInSystemPlayer(path: string | undefined) {
  if (!isDesktop || !path) return;
  void openWithDefault(path).catch(() => st().toast('无法启动系统播放器', { kind: 'error' }));
}

/**
 * Pick a subtitle file for the playing video (.srt / .vtt / .ass / .ssa) and
 * return it as a WebVTT blob URL. Resolves null when the dialog is cancelled;
 * a plain web input works both in the browser and inside Tauri.
 */
export function pickSubtitle(): Promise<{ name: string; url: string } | null> {
  return new Promise((resolve) => {
    const input = getPicker();
    input.webkitdirectory = false;
    input.multiple = false;
    input.accept = '.srt,.vtt,.ass,.ssa';
    input.value = '';
    let done = false;
    const finish = (value: { name: string; url: string } | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    input.onchange = () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return finish(null);
      void file
        .arrayBuffer()
        .then((buf) => {
          const vtt = toWebVtt(decodeSubtitleBuffer(buf));
          finish({ name: file.name, url: URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' })) });
        })
        .catch(() => {
          st().toast('无法读取字幕文件', { kind: 'error' });
          finish(null);
        });
    };
    // Chromium fires `cancel` when the dialog is dismissed without a file.
    // Property assignment (like onchange) so successive picks don't stack up.
    input.oncancel = () => finish(null);
    input.click();
  });
}

/* ----------------------------- Export ----------------------------- */

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export type SaveFormat = 'image/jpeg' | 'image/png' | 'image/webp';

export interface SaveOptions {
  name: string;
  format: SaveFormat;
  quality: number;
  width: number;
  height: number;
  applyEdits: boolean;
}

interface FileHandleLike {
  createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
}

export async function saveImage(item: ImageItem, o: SaveOptions): Promise<boolean> {
  const ext = o.format === 'image/jpeg' ? 'jpg' : o.format === 'image/png' ? 'png' : 'webp';
  const filename = `${o.name || 'image'}.${ext}`;
  let handle: FileHandleLike | null = null;
  const w = window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<FileHandleLike> };
  if (!item.remote && typeof w.showSaveFilePicker === 'function') {
    try {
      handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: `${ext.toUpperCase()} 图片`, accept: { [o.format]: ['.' + ext] } }],
      });
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return false;
      handle = null;
    }
  }
  try {
    const canvas = await renderItem(item, {
      adjust: o.applyEdits,
      transform: o.applyEdits,
      width: o.width,
      height: o.height,
      background: o.format === 'image/jpeg' ? '#ffffff' : null,
    });
    const blob = await canvasToBlob(canvas, o.format, o.quality / 100);
    if (handle) {
      const ws = await handle.createWritable();
      await ws.write(blob);
      await ws.close();
    } else {
      downloadBlob(blob, filename);
    }
    st().toast(`已保存“${filename}”`, { kind: 'success' });
    return true;
  } catch {
    st().toast(item.remote ? '在线示例图片受跨域限制，无法导出' : '保存失败，图片可能过大', { kind: 'error' });
    return false;
  }
}

export async function copyImage(item: ImageItem | null = getCurrent(st())) {
  if (!item) return;
  if (item.kind === 'video') return st().toast('视频不支持复制到剪贴板', { kind: 'error' });
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('unsupported');
    const canvas = await renderItem(item, { adjust: true });
    const blob = await canvasToBlob(canvas, 'image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    st().toast('已复制图片到剪贴板', { kind: 'success' });
  } catch {
    st().toast(item.remote ? '在线示例图片受跨域限制，无法复制' : '复制失败：浏览器不支持或未授予剪贴板权限', {
      kind: 'error',
    });
  }
}

export async function copyFileName(item: ImageItem | null = getCurrent(st())) {
  if (!item) return;
  try {
    await navigator.clipboard.writeText(item.name);
    st().toast('已复制文件名', { kind: 'success' });
  } catch {
    st().toast('复制失败', { kind: 'error' });
  }
}

export function openInNewTab(item: ImageItem | null = getCurrent(st())) {
  if (!item) return;
  window.open(item.url, '_blank', 'noopener');
}

export type PrintFit = 'contain' | 'cover' | 'natural';
export type PrintScope = 'current' | 'all' | 'favorites';

export interface PrintJob {
  items: ImageItem[];
  paper: string;
  landscape: boolean;
  marginMm: number;
  fit: PrintFit;
  perPage: 1 | 2 | 4 | 6 | 9;
  copies: number;
  captionName: boolean;
  captionMeta: boolean;
  pageNumbers: boolean;
  header: boolean;
  border: boolean;
  grayscale: boolean;
  darkPage: boolean;
}

const PER_PAGE_GRID: Record<PrintJob['perPage'], [number, number]> = {
  1: [1, 1],
  2: [1, 2],
  4: [2, 2],
  6: [2, 3],
  9: [3, 3],
};

/** A real print document: paper, margins, contact sheet, captions and copies. */
export async function printJob(job: PrintJob) {
  const photos = job.items.filter((i) => i.kind !== 'video' && !i.error);
  if (!photos.length) {
    st().toast('没有可打印的图片', { kind: 'error' });
    return;
  }
  const copies = Math.min(20, Math.max(1, Math.round(job.copies)));
  const pages = Math.ceil(photos.length / job.perPage);
  if (pages * copies > 48) {
    st().toast(`一次最多打印 48 页，当前是 ${pages * copies} 页，请减少范围或份数`, { kind: 'error' });
    return;
  }

  const temps: string[] = [];
  const urls = await Promise.all(
    photos.map(async (item) => {
      const edited = isAdjusted(item.adjust) || normRot(item.rotation) !== 0 || item.flipH || item.flipV;
      if (!edited || item.remote) return item.url;
      try {
        const canvas = await renderItem(item, { adjust: true });
        const blob = await canvasToBlob(canvas, 'image/png');
        const url = URL.createObjectURL(blob);
        temps.push(url);
        return url;
      } catch {
        return item.url;
      }
    }),
  );

  const [cols, rows] = job.landscape && job.perPage === 2 ? [2, 1] : PER_PAGE_GRID[job.perPage];
  const ink = job.darkPage ? '#f4f4f4' : '#1b1b1b';
  const paper = job.darkPage ? '#111' : '#fff';
  const fit =
    job.fit === 'cover' ? 'cover' : job.fit === 'natural' ? 'none' : 'contain';
  const size = `${job.paper} ${job.landscape ? 'landscape' : 'portrait'}`;

  const pageHtml = (slice: { item: ImageItem; url: string }[], page: number, total: number) => {
    const cells = slice
      .map(({ item, url }) => {
        const meta = [item.width ? `${item.width}×${item.height}` : '', item.size ? formatBytes(item.size) : '']
          .filter(Boolean)
          .join(' · ');
        return `<figure class="cell"><img src="${escapeHtml(url)}" alt=""><figcaption>${
          job.captionName ? `<b>${escapeHtml(item.name)}</b>` : ''
        }${job.captionMeta && meta ? `<span>${escapeHtml(meta)}</span>` : ''}</figcaption></figure>`;
      })
      .join('');
    return `<section class="page">${job.header ? `<header>拾光 Lumina<span>${new Date().toLocaleString('zh-CN', { hour12: false })}</span></header>` : ''}<div class="sheet">${cells}</div>${
      job.pageNumbers ? `<footer>${page} / ${total}</footer>` : ''
    }</section>`;
  };

  const sheets = Array.from({ length: pages }, (_, i) =>
    photos.slice(i * job.perPage, (i + 1) * job.perPage).map((item, k) => ({
      item,
      url: urls[i * job.perPage + k],
    })),
  );
  const body = Array.from({ length: copies }, () => sheets.map((s, i) => pageHtml(s, i + 1, pages)).join('')).join('');

  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    iframe.remove();
    temps.forEach((u) => URL.revokeObjectURL(u));
    return;
  }
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>拾光 · 打印</title><style>
    @page{size:${size};margin:${job.marginMm}mm}
    *{box-sizing:border-box}
    html,body{margin:0;background:${paper};color:${ink};font-family:"Segoe UI","Microsoft YaHei",sans-serif}
    .page{break-after:page;min-height:100vh;display:flex;flex-direction:column;padding:0}
    .page:last-child{break-after:auto}
    header,footer{display:flex;justify-content:space-between;font-size:9pt;opacity:.72;padding:1mm 0}
    .sheet{flex:1;min-height:0;display:grid;grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);gap:3mm}
    .cell{margin:0;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
    img{max-width:100%;max-height:${job.captionName || job.captionMeta ? '88%' : '100%'};object-fit:${fit};${job.border ? 'border:0.4pt solid currentColor;' : ''}${job.grayscale ? 'filter:grayscale(1);' : ''}}
    figcaption{width:100%;font-size:8pt;text-align:center;line-height:1.35}
    figcaption span{display:block;opacity:.7}
  </style></head><body>${body}</body></html>`);
  doc.close();

  const cleanup = () =>
    window.setTimeout(() => {
      iframe.remove();
      temps.forEach((u) => URL.revokeObjectURL(u));
    }, 1500);
  let settled = false;
  const go = () => {
    if (settled) return;
    settled = true;
    try {
      win.focus();
      win.print();
    } catch {
      st().toast('无法打开打印对话框（此环境不支持打印）', { kind: 'error' });
    }
    cleanup();
  };
  const imgs = [...doc.images];
  if (!imgs.length || imgs.every((img) => img.complete)) go();
  else {
    let left = imgs.length;
    const tick = () => {
      left -= 1;
      if (left <= 0) go();
    };
    imgs.forEach((img) => {
      if (img.complete) tick();
      else {
        img.onload = tick;
        img.onerror = tick;
      }
    });
    window.setTimeout(go, 8000);
  }
}

/**
 * Export to PDF via the system print dialog targeting “Microsoft Print to PDF”.
 * It shares the exact laid-out document with `printJob`; the only difference is
 * we never call window.print() ourselves, the user picks the PDF printer.
 * Implemented as printJob with a hint — kept simple and dependency-free.
 */
export async function exportPdf(job: PrintJob) {
  st().toast('在系统打印窗口的“打印机”里选择「Microsoft Print to PDF」即可保存为 PDF', { kind: 'info', duration: 4200 });
  await printJob(job);
}

/* --------------------------- View modes --------------------------- */

export function requestRemove(id?: string) {
  const s = st();
  const item = id ? s.images.find((i) => i.id === id) : getCurrent(s);
  if (!item) return;
  if (s.settings.confirmRemove) {
    if (item.id !== s.currentId) s.goTo(item.id);
    s.setDialog('confirmRemove');
  } else {
    s.removeImage(item.id);
  }
}

export function startCrop() {
  const s = st();
  const item = getCurrent(s);
  if (!item) return;
  if (item.kind === 'video') return s.toast('视频不支持裁剪', { kind: 'error' });
  if (item.error) return s.toast('无法裁剪此图片', { kind: 'error' });
  if (item.remote) return s.toast('在线示例图片受跨域限制，不支持裁剪', { kind: 'error' });
  if (s.immersive) exitImmersive();
  s.setCropMode(true);
}

export async function enterFullscreen() {
  if (isDesktop) return setDesktopFullscreen(true);
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    /* not allowed (e.g. inside an iframe) – immersive mode still works */
  }
}

export async function exitFullscreen() {
  if (isDesktop) return setDesktopFullscreen(false);
  try {
    if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
  } catch {
    /* ignore */
  }
}

export function exitImmersive() {
  st().setImmersive(false);
  exitFullscreen();
}

export function toggleImmersive() {
  const s = st();
  if (!s.images.length) return;
  if (s.immersive) {
    exitImmersive();
  } else {
    if (s.mode !== 'viewer') s.setMode('viewer');
    if (s.cropMode) s.setCropMode(false);
    s.setImmersive(true);
    enterFullscreen();
  }
}

export function startSlideshow() {
  const s = st();
  const list = getVisible(s);
  if (!list.length) {
    s.toast('没有可放映的图片', { kind: 'error' });
    return;
  }
  if (!list.some((i) => i.id === s.currentId)) s.goTo(list[0].id);
  if (s.cropMode) s.setCropMode(false);
  s.setSlideshow(true);
  enterFullscreen();
}

export function stopSlideshow() {
  const s = st();
  s.setSlideshow(false);
  if (!s.immersive) exitFullscreen();
}
