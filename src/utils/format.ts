export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} 字节`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

export function formatDate(input: number | Date | string | undefined | null): string {
  if (input === undefined || input === null || input === '') return '—';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

const RATIOS: [number, number][] = [
  [1, 1],
  [4, 3],
  [3, 2],
  [16, 9],
  [16, 10],
  [21, 9],
  [5, 4],
  [2, 1],
  [3, 1],
];

export function aspectLabel(w: number, h: number): string {
  if (!w || !h) return '—';
  const r = w / h;
  for (const [a, b] of RATIOS) {
    if (Math.abs(r - a / b) < 0.012) return `${a}:${b}`;
    if (Math.abs(r - b / a) < 0.012) return `${b}:${a}`;
  }
  return r >= 1 ? `${r.toFixed(2)}:1` : `1:${(1 / r).toFixed(2)}`;
}

export function formatExposure(t: number): string {
  if (!t) return '—';
  if (t >= 1) return `${Math.round(t * 10) / 10}s`;
  return `1/${Math.round(1 / t)}s`;
}

export function formatZoom(scale: number): string {
  const p = scale * 100;
  return `${p >= 10 ? Math.round(p) : p.toFixed(1)}%`;
}

export function typeLabel(type: string, name: string): string {
  const ext = extOf(name).toUpperCase();
  const map: Record<string, string> = {
    JPG: 'JPEG 图像',
    JPEG: 'JPEG 图像',
    JFIF: 'JPEG 图像',
    PNG: 'PNG 图像',
    APNG: 'APNG 动画',
    GIF: 'GIF 图像',
    WEBP: 'WebP 图像',
    AVIF: 'AVIF 图像',
    BMP: '位图图像',
    SVG: 'SVG 矢量图',
    ICO: '图标文件',
    TIF: 'TIFF 图像',
    TIFF: 'TIFF 图像',
    HEIC: 'HEIC 图像',
    HEIF: 'HEIF 图像',
    JXL: 'JPEG XL 图像',
  };
  const video: Record<string, string> = {
    MP4: 'MP4 视频 (H.264)',
    M4V: 'M4V 视频',
    MOV: 'QuickTime 视频',
    WEBM: 'WebM 视频',
    MKV: 'Matroska 视频',
  };
  if (video[ext]) return `${video[ext]} (.${ext.toLowerCase()})`;
  if (map[ext]) return `${map[ext]} (.${ext.toLowerCase()})`;
  if (type) return type;
  return ext ? `${ext} 文件` : '未知类型';
}

export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
