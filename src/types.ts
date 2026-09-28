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

/** Gallery filter bar state. Lives in the store (not Gallery's useState)
 *  because the gallery unmounts while an item is open in the viewer — the
 *  back button must restore exactly the list the user filtered. */
export type GalleryKind = 'all' | 'image' | 'video';
export type GalleryTime = 'all' | 'today' | 'week' | 'month';

export interface GalleryFilter {
  query: string;
  kind: GalleryKind;
  folder: string;
  time: GalleryTime;
}

/** Container header info parsed by the Rust `read_media_info` command.
 *  `null` fields mean "not present / not parseable" — the HTML5 video API
 *  never exposes codec or frame rate, so this comes from the file itself. */
export interface VideoStreamInfo {
  codec?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
}

export interface AudioStreamInfo {
  codec?: string | null;
  sampleRate?: number | null;
  channels?: number | null;
}

export interface MediaInfo {
  container?: string | null;
  durationMs?: number | null;
  video?: VideoStreamInfo | null;
  audio?: AudioStreamInfo | null;
}

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
  /** Video duration in seconds, captured from the <video> element metadata. */
  duration?: number;
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
  /** Player state persists across videos (the element remounts per file). */
  videoVolume: number;
  videoMuted: boolean;
  videoRate: number;
}

/** A subtitle file loaded for the current video (already converted to VTT). */
export interface SubtitleFile {
  name: string;
  url: string;
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
