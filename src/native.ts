/**
 * Windows shell integration + session restore. All Go calls are optional:
 * in a plain browser (or if a method is missing) every helper degrades
 * quietly.
 */
import { Lumina } from './mygo';
import { isDesktop } from './desktop';
import { useStore } from './store';
import type { MediaInfo } from './types';

export const WALLPAPER_STYLES = [
  { value: 'fill', label: '填充' },
  { value: 'fit', label: '适应' },
  { value: 'stretch', label: '拉伸' },
  { value: 'tile', label: '平铺' },
  { value: 'center', label: '居中' },
] as const;

export type WallpaperStyle = (typeof WALLPAPER_STYLES)[number]['value'];

export async function setWallpaper(path: string, style: WallpaperStyle): Promise<boolean> {
  if (!isDesktop) return false;
  try {
    await Lumina.setWallpaper(path, style);
    return true;
  } catch {
    return false;
  }
}

export async function setShellMenu(enabled: boolean): Promise<boolean> {
  if (!isDesktop) return enabled;
  try {
    return await Lumina.shellMenu(enabled);
  } catch {
    return !enabled;
  }
}

export async function shellMenuState(): Promise<boolean> {
  if (!isDesktop) return false;
  try {
    return await Lumina.shellMenuState();
  } catch {
    return false;
  }
}

export async function assocState(): Promise<Set<string>> {
  if (!isDesktop) return new Set();
  try {
    return new Set((await Lumina.assocState()) ?? []);
  } catch {
    return new Set();
  }
}

export async function assocSet(ext: string, enabled: boolean): Promise<boolean> {
  if (!isDesktop) return false;
  try {
    await Lumina.assocSet(ext, enabled);
    return true;
  } catch {
    return false;
  }
}

/** Windows 11 owns the “default app” choice; hand the user the real page. */
export async function openDefaultApps() {
  if (!isDesktop) return;
  try {
    await Lumina.openDefaultApps();
  } catch {
    /* ignore */
  }
}

/* ------------------------------ media info ------------------------------ */

/**
 * Container header probe for the video info section (duration, codec, frame
 * rate, audio layout). The HTML5 video API exposes none of that, so we read
 * it from the file itself. Degrades to `null` in a plain browser.
 */
export async function readMediaInfo(path: string): Promise<MediaInfo | null> {
  if (!isDesktop) return null;
  try {
    return await Lumina.readMediaInfo(path);
  } catch {
    return null;
  }
}

/* ------------------------------- session ------------------------------- */

const SESSION_KEY = 'lumina-session-v1';

interface Session {
  paths: string[];
  current: string | null;
}

/** Remember what was open so the next launch picks up where we left off. */
export function saveSession() {
  if (!isDesktop) return;
  const s = useStore.getState();
  const paths = s.images.map((i) => i.path).filter((p) => p && p !== undefined);
  const onlyPathItems = s.images.every((i) => !!i.path);
  if (!onlyPathItems || !paths.length) {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  const current = s.images.find((i) => i.id === s.currentId)?.path ?? null;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ paths, current } satisfies Session));
  } catch {
    /* ignore */
  }
}

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return Array.isArray(s.paths) && s.paths.length ? s : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
