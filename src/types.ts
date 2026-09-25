export type ThemeMode = 'system' | 'light' | 'dark';
export type ViewerBg = 'theme' | 'black' | 'white' | 'checker' | 'ambient';
export type WheelAction = 'zoom' | 'navigate';
export type SortKey = 'name' | 'date' | 'size' | 'type' | 'added';
export type SortDir = 'asc' | 'desc';
export type SlideTransition = 'fade' | 'slide' | 'zoom' | 'none';
export type PanelKind = 'info' | 'edit' | null;
export type DialogKind =
  | 'settings'
  | 'shortcuts'
  | 'saveAs'
  | 'closeAll'
  | 'confirmRemove'
  | 'collage'
  | 'print'
  | 'wallpaper'
  | null;
export type AppMode = 'viewer' | 'gallery';
export type FilterKind = 'all' | 'favorites';

export interface Adjustments {
  brightness: number; // 0..200 (100 = original)
  contrast: number; // 0..200
  saturate: number; // 0..200
  hue: number; // -180..180 deg
  temperature: number; // -100..100
  vignette: number; // 0..100
  grayscale: number; // 0..100
  sepia: number; // 0..100
  invert: number; // 0..100
  blur: number; // 0..100
}

export interface ImageItem {
  id: string;
  file: Blob | null;
  url: string;
  originalUrl: string;
  remote: boolean;
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: number;
  addedAt: number;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
  thumb: string | null;
  thumbState: 'idle' | 'loading' | 'done' | 'error';
  kind: 'image' | 'video';
  rotation: number; // cumulative degrees (multiples of 90)
  flipH: boolean;
  flipV: boolean;
  favorite: boolean;
  adjust: Adjustments;
  cropped: boolean;
  error: boolean;
  credit?: string;
}

export interface Settings {
  theme: ThemeMode;
  accent: string;
  viewerBg: ViewerBg;
  wheelAction: WheelAction;
  upscaleSmall: boolean;
  pixelated: boolean;
  loop: boolean;
  confirmRemove: boolean;
  showMinimap: boolean;
  showFilmstrip: boolean;
  slideInterval: number;
  slideTransition: SlideTransition;
  slideShuffle: boolean;
  thumbSize: number;
  galleryCover: boolean;
  /** Desktop: reopen last session when launched without arguments. */
  restoreSession: boolean;
}

export interface ToastItem {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  actionLabel?: string;
  action?: () => void;
}

export interface FileInput {
  file: File;
  path?: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface WinState {
  max: boolean;
  min: boolean;
  closed: boolean;
}
