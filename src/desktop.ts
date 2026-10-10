/**
 * Bridge to the Go + MyGo desktop shell. Everything here is a no-op in a
 * normal browser, so the same build runs on the web and inside the Windows
 * app.
 *
 * Performance contract (desktop only):
 *   import      → `collectPaths` (walk, cheap) + `describeBatch` probes in
 *                 chunks: the first chunk shows at once, the tail streams in
 *   thumbnails  → Go decodes/resizes in parallel, one packed `thumbBatch`
 *                 call per import; the WebView decodes the small JPEGs itself
 *   display     → the `lumina://` protocol streams the original bytes with
 *                 real Range support; the engine's image decoder runs
 *                 off-thread
 *   edits       → one `readImage` call for the single image being edited,
 *                 because a canvas needs same-origin bytes
 */
import { currentWindow, isMyGo, onFileDrop } from 'mygo-runtime';
import { Lumina } from './mygo';

export const isDesktop = typeof window !== 'undefined' && isMyGo();

export interface DesktopEntry {
  path: string;
  name: string;
  size: number;
  modified: number;
  width: number;
  height: number;
}

export type DesktopTheme = 'light' | 'dark' | null;

/** Go hands `[]byte` over as base64; this is the way back. */
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Engine-level URL for a local file. In a browser this is just the path.
 *
 * The Go shell serves local media from its own `lumina://` scheme, with
 * Range support and a hard cap on any single response — a `<video>` streams,
 * a stray `<img>` pointed at a video cannot pull a whole film into memory.
 */
export function assetUrl(path: string): string {
  if (!isDesktop) return path;
  try {
    return `lumina://localhost/${encodeURIComponent(path)}`;
  } catch {
    return path;
  }
}

export async function setDesktopFullscreen(value: boolean) {
  if (!isDesktop) return;
  try {
    await Lumina.setFullscreen(value);
  } catch {
    /* ignore */
  }
}

export async function setDesktopTitle(title: string) {
  if (!isDesktop) return;
  try {
    await currentWindow.setTitle(title);
  } catch {
    /* ignore */
  }
}

export async function setDesktopTheme(theme: DesktopTheme) {
  if (!isDesktop) return;
  try {
    await Lumina.setTheme(theme ?? '');
  } catch {
    /* ignore */
  }
}

export async function closeDesktopWindow() {
  if (!isDesktop) return;
  await currentWindow.close();
}

/* ------------------------------ files ------------------------------ */

/** Expand folders/files into media paths — a walk, no header probes. */
export async function collectPaths(inputs: string[]): Promise<string[]> {
  if (!isDesktop || !inputs.length) return [];
  return (await Lumina.collectPaths(inputs)) ?? [];
}

/** Probe one bounded batch of paths into display entries (size, dimensions). */
export async function describeBatch(paths: string[]): Promise<DesktopEntry[]> {
  if (!isDesktop || !paths.length) return [];
  return (await Lumina.describeBatch(paths)) ?? [];
}

/** Hand a file to the system's registered player (codec escape hatch). */
export async function openWithDefault(path: string): Promise<void> {
  if (!isDesktop) return;
  await Lumina.openWithDefault(path);
}

export interface DesktopBoot {
  entries: DesktopEntry[];
  selected: number;
  /** One image was opened: its folder should be loaded in the background. */
  siblings: boolean;
}

/** Launch data Go injected before any page script ran (no IPC, synchronous). */
export function readBoot(): DesktopBoot | null {
  if (!isDesktop) return null;
  const boot = (window as unknown as { __LUMINA_BOOT__?: DesktopBoot | null }).__LUMINA_BOOT__;
  return boot && Array.isArray(boot.entries) && boot.entries.length ? boot : null;
}

/** The launched image's folder (it is already on screen; this is background work). */
export async function launchSiblings(): Promise<{ entries: DesktopEntry[]; selected: number; rest: string[] }> {
  if (!isDesktop) return { entries: [], selected: 0, rest: [] };
  return (await Lumina.launchSiblings()) ?? { entries: [], selected: 0, rest: [] };
}

/** The window starts hidden; show it once the first frame is rendered. */
export async function showDesktopWindow() {
  if (!isDesktop) return;
  try {
    await Lumina.showWindow();
  } catch {
    /* Go also shows it after a short safety timeout */
  }
}

/**
 * One packed call for every thumbnail of a batch.
 * Returns a blob URL per entry (or null when Go had no thumbnail for it).
 *
 * Go encodes the batch as a little record stream — u32 index, u8 kind, u32
 * offset, u32 length, then the payloads — which the old shell handed over as
 * one ArrayBuffer. It crosses MyGo's JSON bridge as base64, so the record
 * format is unchanged and only the transport differs.
 */
export async function thumbBatch(paths: string[], width = 320): Promise<(string | null)[]> {
  const out: (string | null)[] = paths.map(() => null);
  if (!isDesktop || !paths.length) return out;
  const packed = await Lumina.thumbBatch(paths, width);
  if (!packed) return out;
  const bytes = fromBase64(packed);
  const buffer = bytes.buffer as ArrayBuffer;
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
    const bytes2 = buffer.slice(payloadStart + off, payloadStart + off + len);
    const type = kind === 2 ? 'image/png' : 'image/jpeg';
    out[index] = URL.createObjectURL(new Blob([bytes2], { type }));
  }
  return out;
}

/** Same-origin bytes for the single image an edit/export needs. */
export async function readItemBytes(path: string): Promise<Blob> {
  if (!isDesktop) throw new Error('not desktop');
  const packed = await Lumina.readImage(path);
  return new Blob([fromBase64(packed)]);
}

/** Native file picker (paths come from Go, so the whole batch stays off JS). */
export async function pickImages(): Promise<string[]> {
  if (!isDesktop) return [];
  return (await Lumina.pickImages()) ?? [];
}

export async function pickFolder(): Promise<string[]> {
  if (!isDesktop) return [];
  return (await Lumina.pickFolder()) ?? [];
}

/** Observe the native drag-drop event (paths, not File objects). */
export async function onDesktopPaths(handler: (paths: string[]) => void): Promise<() => void> {
  if (!isDesktop) return () => undefined;
  return onFileDrop(({ paths }) => {
    if (paths.length) handler(paths);
  });
}
