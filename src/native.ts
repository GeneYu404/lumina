/**
 * Windows shell integration + session restore. All Rust calls are optional:
 * in a plain browser (or if a command is missing) every helper degrades quietly.
 */
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './desktop';
import { useStore } from './store';

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
    await invoke('set_wallpaper', { path, style });
    return true;
  } catch {
    return false;
  }
}

export async function setShellMenu(enabled: boolean): Promise<boolean> {
  if (!isDesktop) return enabled;
  try {
    return await invoke<boolean>('shell_menu', { enabled });
  } catch {
    return !enabled;
  }
}

export async function shellMenuState(): Promise<boolean> {
  if (!isDesktop) return false;
  try {
    return await invoke<boolean>('shell_menu_state');
  } catch {
    return false;
  }
}

export async function assocState(): Promise<Set<string>> {
  if (!isDesktop) return new Set();
  try {
    return new Set(await invoke<string[]>('assoc_state'));
  } catch {
    return new Set();
  }
}

export async function assocSet(ext: string, enabled: boolean): Promise<boolean> {
  if (!isDesktop) return false;
  try {
    await invoke('assoc_set', { ext, enabled });
    return true;
  } catch {
    return false;
  }
}

/** Windows 11 owns the “default app” choice; hand the user the real page. */
export async function openDefaultApps() {
  if (!isDesktop) return;
  try {
    await invoke('open_default_apps');
  } catch {
    /* ignore */
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
