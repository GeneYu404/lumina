import {
  Aperture,
  Calendar,
  Camera,
  Clock,
  FileImage,
  Folder,
  HardDrive,
  Heart,
  MapPin,
  Palette,
  Ruler,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useCurrent, useStore } from '../store';
import type { ImageItem } from '../types';
import { cn } from '../utils/cn';
import { aspectLabel, formatBytes, formatDate, formatExposure, typeLabel } from '../utils/format';
import { computeStats, isAdjusted, normRot, type ImageStats } from '../utils/image';

const S = useStore.getState;

type ExifData = Record<string, unknown>;

function useExif(item: ImageItem | null): { data: ExifData | null; loading: boolean } {
  const [data, setData] = useState<ExifData | null>(null);
  const [loading, setLoading] = useState(false);
  const file = item?.file ?? null;
  const id = item?.id;
  useEffect(() => {
    setData(null);
    if (!file) return;
    let cancelled = false;
    setLoading(true);
    import('exifr')
      .then((m) =>
        m.default.parse(file, {
          tiff: true,
          exif: true,
          gps: true,
          ifd1: false,
          interop: false,
          xmp: false,
          icc: false,
          iptc: false,
          jfif: false,
          ihdr: false,
          translateValues: true,
          reviveValues: true,
          mergeOutput: true,
        }),
      )
      .then((d) => {
        if (!cancelled) setData((d as ExifData) || null);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, file]);
  return { data, loading };
}

function useStats(url: string | null, remote: boolean): ImageStats | null {
  const [stats, setStats] = useState<ImageStats | null>(null);
  useEffect(() => {
    setStats(null);
    if (!url || remote) return;
    let cancelled = false;
    computeStats(url)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url, remote]);
  return stats;
}

export function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between pl-4 pr-2">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <button type="button" aria-label="关闭面板" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-fg2 hover:bg-subtle">
        <X size={16} />
      </button>
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-t border-stroke py-3 first:border-t-0">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Row({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5">
      <Icon size={16} strokeWidth={1.6} className="mt-0.5 shrink-0 text-fg2" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-fg3">{label}</div>
        <div className="break-words text-[13px] leading-5 text-fg">{children}</div>
      </div>
    </div>
  );
}

function Histogram({ stats }: { stats: ImageStats }) {
  const all = [...stats.r, ...stats.g, ...stats.b];
  const sorted = [...all].sort((a, b) => a - b);
  const cap = Math.max(1, sorted[Math.floor(sorted.length * 0.995)]);
  const path = (arr: number[]) => {
    let d = 'M0,100';
    for (let i = 0; i < 256; i++) {
      const v = Math.min(1, Math.sqrt(arr[i] / cap));
      d += ` L${i},${(100 - v * 100).toFixed(1)}`;
    }
    return d + ' L255,100 Z';
  };
  return (
    <svg viewBox="0 0 255 100" preserveAspectRatio="none" className="h-24 w-full rounded-md border border-stroke bg-card">
      <path d={path(stats.l)} fill="currentColor" className="text-fg3" opacity={0.35} />
      <path d={path(stats.r)} fill="rgba(239,68,68,0.45)" />
      <path d={path(stats.g)} fill="rgba(34,197,94,0.42)" />
      <path d={path(stats.b)} fill="rgba(59,130,246,0.45)" />
    </svg>
  );
}

function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return formatDate(v);
  return String(v).trim();
}

export default function InfoPanel() {
  const item = useCurrent();
  const { data: exif, loading } = useExif(item);
  const isVideo = !!item && item.kind === 'video';
  const stats = useStats(isVideo ? null : (item?.thumb ?? null), !!item?.remote);
  const [copied, setCopied] = useState<string | null>(null);

  if (!item) return null;

  const make = str(exif?.Make);
  let model = str(exif?.Model);
  if (make && model.toLowerCase().startsWith(make.toLowerCase())) model = model.slice(make.length).trim();
  const camera = [make, model].filter(Boolean).join(' ');
  const lens = str(exif?.LensModel);
  const fnum = typeof exif?.FNumber === 'number' ? `f/${(exif.FNumber as number).toFixed(1).replace(/\.0$/, '')}` : '';
  const exposure = typeof exif?.ExposureTime === 'number' ? formatExposure(exif.ExposureTime as number) : '';
  const iso = exif?.ISO ? `ISO ${str(exif.ISO)}` : '';
  const focal = typeof exif?.FocalLength === 'number' ? `${Math.round(exif.FocalLength as number)}mm` : '';
  const ev = typeof exif?.ExposureCompensation === 'number' ? `${(exif.ExposureCompensation as number) > 0 ? '+' : ''}${(exif.ExposureCompensation as number).toFixed(1)} EV` : '';
  const shot = exif?.DateTimeOriginal ?? exif?.CreateDate;
  const lat = typeof exif?.latitude === 'number' ? (exif.latitude as number) : null;
  const lon = typeof exif?.longitude === 'number' ? (exif.longitude as number) : null;
  const params = [fnum, exposure, iso, focal, ev].filter(Boolean);
  const hasCamera = !!(camera || lens || params.length || shot);

  const edits: string[] = [];
  if (item.cropped) edits.push('已裁剪');
  if (normRot(item.rotation)) edits.push(`旋转 ${normRot(item.rotation)}°`);
  if (item.flipH || item.flipV) edits.push('已翻转');
  if (isAdjusted(item.adjust)) edits.push('已调色');

  const folder = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';

  const copyHex = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(hex);
      window.setTimeout(() => setCopied((c) => (c === hex ? null : c)), 1200);
    } catch {
      S().toast('复制失败', { kind: 'error' });
    }
  };

  return (
    <aside className="animate-panel-in flex w-[320px] shrink-0 flex-col border-l border-stroke bg-layer max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-30 max-md:bg-app max-md:shadow-2xl">
      <PanelHeader title="文件信息" onClose={() => S().setPanel(null)} />
      <div className="win-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="flex items-start gap-3 pb-3">
          <div className="min-w-0 flex-1">
            <div className="break-all text-[15px] font-semibold leading-6">{item.name}</div>
            {edits.length > 0 && <div className="mt-0.5 text-xs text-accent">{edits.join(' · ')}</div>}
          </div>
          <button
            type="button"
            aria-label={item.favorite ? '取消收藏' : '收藏'}
            onClick={() => S().toggleFavorite(item.id)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-subtle"
          >
            <Heart size={17} className={item.favorite ? 'fill-[#e81123] text-[#e81123]' : 'text-fg2'} />
          </button>
        </div>

        <Section title="文件">
          {folder && (
            <Row icon={Folder} label="位置">
              {folder}
            </Row>
          )}
          <Row icon={FileImage} label="类型">
            {typeLabel(item.type, item.name)}
          </Row>
          <Row icon={Ruler} label="尺寸">
            {item.width ? (
              <>
                {item.width} × {item.height} 像素
                <span className="text-fg2">
                  {' '}
                  · {((item.width * item.height) / 1e6).toFixed(1)} MP · {aspectLabel(item.width, item.height)}
                </span>
              </>
            ) : (
              '—'
            )}
          </Row>
          <Row icon={HardDrive} label="文件大小">
            {item.size ? `${formatBytes(item.size)}（${item.size.toLocaleString('zh-CN')} 字节）` : item.remote ? '在线图片' : '—'}
          </Row>
          <Row icon={Calendar} label="修改日期">
            {formatDate(item.lastModified)}
          </Row>
          {item.credit && (
            <Row icon={User} label="摄影师">
              {item.credit}
              <span className="text-fg2"> · Pexels</span>
            </Row>
          )}
        </Section>

        {!isVideo && (
        <Section title="相机" right={loading ? <span className="text-[11px] text-fg3">读取中…</span> : undefined}>
          {hasCamera ? (
            <>
              {camera && (
                <Row icon={Camera} label="设备">
                  {camera}
                </Row>
              )}
              {lens && (
                <Row icon={Aperture} label="镜头">
                  {lens}
                </Row>
              )}
              {params.length > 0 && (
                <div className="my-1.5 flex flex-wrap gap-1.5 pl-7">
                  {params.map((p) => (
                    <span key={p} className="rounded-md border border-stroke bg-card px-2 py-0.5 text-xs tabular-nums">
                      {p}
                    </span>
                  ))}
                </div>
              )}
              {!!shot && (
                <Row icon={Clock} label="拍摄时间">
                  {str(shot)}
                </Row>
              )}
              {!!exif?.Flash && (
                <Row icon={Camera} label="闪光灯">
                  {str(exif.Flash)}
                </Row>
              )}
              {!!exif?.Software && (
                <Row icon={FileImage} label="软件">
                  {str(exif.Software)}
                </Row>
              )}
            </>
          ) : (
            <p className="py-1 text-xs leading-5 text-fg3">
              {loading ? '正在读取 EXIF 信息…' : item.remote ? '在线图片不提供 EXIF 信息。' : '此图片不包含相机 (EXIF) 信息。'}
            </p>
          )}
        </Section>
        )}

        {lat !== null && lon !== null && (
          <Section title="位置">
            <Row icon={MapPin} label="GPS 坐标">
              {lat.toFixed(5)}, {lon.toFixed(5)}
            </Row>
            <a
              href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`}
              target="_blank"
              rel="noreferrer"
              className="ml-7 text-[13px] text-accent hover:underline"
            >
              在地图中查看 ↗
            </a>
          </Section>
        )}

        {!isVideo && (
        <Section title="直方图">
          {stats ? (
            <Histogram stats={stats} />
          ) : (
            <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-stroke text-xs text-fg3">
              {item.remote ? '在线图片无法分析' : '正在分析…'}
            </div>
          )}
        </Section>
        )}

        {!isVideo && stats && stats.palette.length > 0 && (
          <Section title="主色调" right={<Palette size={14} className="text-fg3" />}>
            <div className="grid grid-cols-6 gap-1.5">
              {stats.palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={`${c}（点击复制）`}
                  onClick={() => copyHex(c)}
                  className="group/sw flex flex-col items-center gap-1"
                >
                  <span
                    className={cn('h-9 w-full rounded-md border border-stroke transition-transform group-hover/sw:scale-105')}
                    style={{ background: c }}
                  />
                  <span className="font-mono text-[10px] uppercase text-fg3">{copied === c ? '已复制' : c.slice(1)}</span>
                </button>
              ))}
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
}
