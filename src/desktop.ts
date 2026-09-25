/**
 * Bridge to the Tauri desktop shell. Everything here is a no-op in a normal
 * browser, so the same build runs on the web and inside the Windows app.
 *
 * Performance contract (desktop only):
 *   import      → one `import_paths` invoke for a whole batch of paths
 *   thumbnails  → Rust decodes/resizes in parallel, one packed `thumb_batch`
 *                 invoke per import; the WebView decodes the small JPEGs itself
 *   display     → asset protocol (`https://asset.localhost/...`) streams the
 *                 original bytes; the engine's image decoder runs off-thread
 *   edits       → one `read_image` invoke for the single image being edited,
 *                 because a canvas needs same-origin bytes
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { Theme } from '@tauri-apps/api/window';

export const isDesktop =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>);

export interface DesktopEntry {
  path: string;
  name: string;
  size: number;
  modified: number;
  width: number;
  height: number;
}

/** Engine-level URL for a local file. In a browser this is just the path. */
export function assetUrl(path: string): string {
  if (!isDesktop) return path;
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

async function win() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export async function setDesktopFullscreen(value: boolean) {
  if (!isDesktop) return;
  try {
    await (await win()).setFullscreen(value);
  } catch {
    /* ignore */
  }
}

export async function setDesktopTitle(title: string) {
  if (!isDesktop) return;
  try {
    await (await win()).setTitle(title);
  } catch {
    /* ignore */
  }
}

export async function setDesktopTheme(theme: Theme | null) {
  if (!isDesktop) return;
  try {
    await (await win()).setTheme(theme);
  } catch {
    /* ignore */
  }
}

export async function closeDesktopWindow() {
  if (!isDesktop) return;
  await (await win()).close();
}

/* ------------------------------ files ------------------------------ */

/** One invoke for a whole batch: registers paths and probes dimensions in Rust. */
export async function importPaths(paths: string[]): Promise<DesktopEntry[]> {
  if (!isDesktop || !paths.length) return [];
  return invoke<DesktopEntry[]>('import_paths', { paths });
}

export interface DesktopBoot {
  entries: DesktopEntry[];
  selected: number;
  /** One image was opened: its folder should be loaded in the background. */
  siblings: boolean;
}

/** Launch data Rust injected before any page script ran (no IPC, synchronous). */
export function readBoot(): DesktopBoot | null {
  if (!isDesktop) return null;
  const boot = (window as unknown as { __PV_BOOT__?: DesktopBoot | null }).__PV_BOOT__;
  return boot && Array.isArray(boot.entries) && boot.entries.length ? boot : null;
}

/** The launched image's folder (it is already on screen; this is background work). */
export async function launchSiblings(): Promise<{ entries: DesktopEntry[]; selected: number }> {
  if (!isDesktop) return { entries: [], selected: 0 };
  return invoke<{ entries: DesktopEntry[]; selected: number }>('launch_siblings');
}

/** The window starts hidden; show it once the first frame is rendered. */
export async function showDesktopWindow() {
  if (!isDesktop) return;
  try {
    await (await win()).show();
  } catch {
    /* Rust shows it anyway after a short safety timeout */
  }
}

/**
 * One packed invoke for every thumbnail of a batch.
 * Returns a blob URL per entry (or null when Rust had no thumbnail for it).
 */
export async function thumbBatch(paths: string[], width = 320): Promise<(string | null)[]> {
  const out: (string | null)[] = paths.map(() => null);
  if (!isDesktop || !paths.length) return out;
  const buffer = await invoke<ArrayBuffer>('thumb_batch', { paths, width });
  if (buffer.byteLength < 4) return out;
  const view = new DataView(buffer);
  const count = view.getUint32(0, true);
  const recordsStart = 4;
  const payloadStart = recordsStart + count * 13;
  for (let i = 0; i < count; i++) {
    const o = recordsStart + i * 13;
    const index = view.getUint32(o, true);
    const kind = view.getUint8(o + 4);
    const off = view.getUint32(o + 5, true);
    const len = view.getUint32(o + 9, true);
    if (kind === 0 || index >= out.length) continue;
    const bytes = buffer.slice(payloadStart + off, payloadStart + off + len);
    const type = kind === 2 ? 'image/png' : 'image/jpeg';
    out[index] = URL.createObjectURL(new Blob([bytes], { type }));
  }
  return out;
}

/** Same-origin bytes for the single image an edit/export needs. */
export async function readItemBytes(path: string): Promise<Blob> {
  if (!isDesktop) throw new Error('not desktop');
  const buffer = await invoke<ArrayBuffer>('read_image', { path });
  return new Blob([buffer]);
}

/** Native file picker (paths come from Rust, so the whole batch stays off JS). */
export async function pickImages(): Promise<string[]> {
  if (!isDesktop) return [];
  const { open } = await import('@tauri-apps/plugin-dialog');
  const res = await open({
    multiple: true,
    directory: false,
    title: '选择图片或视频',
    filters: [
      {
        name: '图片和视频',
        extensions: [
          'jpg', 'jpeg', 'jfif', 'png', 'apng', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg', 'tif', 'tiff',
          'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv',
        ],
      },
      {
        name: '图片',
        extensions: ['jpg', 'jpeg', 'jfif', 'png', 'apng', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg', 'tif', 'tiff'],
      },
      { name: '视频', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv'] },
    ],
  });
  if (!res) return [];
  return Array.isArray(res) ? res.map(String) : [String(res)];
}

export async function pickFolder(): Promise<string[]> {
  if (!isDesktop) return [];
  const { open } = await import('@tauri-apps/plugin-dialog');
  const res = await open({ multiple: false, directory: true, title: '选择包含图片的文件夹' });
  if (!res) return [];
  const value = Array.isArray(res) ? res[0] : res;
  return value ? [String(value)] : [];
}

/** Observe the native drag-drop event (paths, not File objects). */
export async function onDesktopPaths(handler: (paths: string[]) => void): Promise<() => void> {
  if (!isDesktop) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  const un = await listen<{ paths?: string[] }>('tauri://drag-drop', (e) => {
    const paths = e.payload?.paths ?? [];
    if (paths.length) handler(paths);
  });
  return () => {
    void un();
  };
}


