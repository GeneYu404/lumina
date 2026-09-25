import type { FileInput } from '../types';
import { extOf } from './format';

export const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'png', 'apng', 'gif', 'webp', 'avif',
  'bmp', 'dib', 'ico', 'cur', 'svg', 'tif', 'tiff', 'heic', 'heif', 'jxl',
]);

/** Played by the system WebView (hardware decode), no extra codec shipped. */
export const VIDEO_EXTS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv']);

export const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);

/** Every extension offered for file association and the shell context menu. */
export const ASSOC_EXTS = [
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'heic', 'avif', 'svg', 'ico',
  'mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm',
];

export const ACCEPT = 'image/*,video/*,' + [...MEDIA_EXTS].map((e) => '.' + e).join(',');

export function isImageFile(f: File): boolean {
  if (f.type && f.type.startsWith('image/')) return true;
  return IMAGE_EXTS.has(extOf(f.name));
}

export function isVideoFile(f: File): boolean {
  if (f.type && f.type.startsWith('video/')) return true;
  return VIDEO_EXTS.has(extOf(f.name));
}

export function isMediaFile(f: File): boolean {
  return isImageFile(f) || isVideoFile(f);
}

export function kindOf(name: string, type = ''): 'image' | 'video' {
  if (type.startsWith('video/') || VIDEO_EXTS.has(extOf(name))) return 'video';
  return 'image';
}

export function guessMime(name: string): string {
  const m: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', apng: 'image/apng',
    gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
    svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif',
    jxl: 'image/jxl',
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
    avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
  };
  return m[extOf(name)] || '';
}

export function fromFileList(list: FileList | File[]): FileInput[] {
  return Array.from(list).map((file) => ({
    file,
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }));
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walk(entry: FileSystemEntry, prefix: string, out: FileInput[], depth: number): Promise<void> {
  if (depth > 12) return;
  if (entry.isFile) {
    try {
      const file = await entryFile(entry as FileSystemFileEntry);
      out.push({ file, path: prefix + file.name });
    } catch {
      /* skip unreadable file */
    }
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    for (;;) {
      const batch = await readEntries(reader).catch(() => [] as FileSystemEntry[]);
      if (!batch.length) break;
      children.push(...batch);
    }
    for (const c of children) await walk(c, prefix + entry.name + '/', out, depth + 1);
  }
}

/**
 * Reads files & folders from a drop event. Entries are captured synchronously,
 * so this must be invoked directly inside the drop handler.
 */
export function readDataTransfer(dt: DataTransfer): Promise<FileInput[]> {
  const entries: FileSystemEntry[] = [];
  const loose: File[] = [];
  if (dt.items && dt.items.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file') continue;
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (entry) entries.push(entry);
      else {
        const f = item.getAsFile();
        if (f) loose.push(f);
      }
    }
  } else if (dt.files) {
    loose.push(...Array.from(dt.files));
  }
  return (async () => {
    const out: FileInput[] = loose.map((file) => ({ file, path: file.name }));
    for (const e of entries) await walk(e, '', out, 0);
    return out;
  })();
}
