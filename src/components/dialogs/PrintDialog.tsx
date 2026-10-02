import { ChevronLeft, ChevronRight, FileDown, Printer, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { exportPdf, printJob, type PrintFit, type PrintJob } from '../../actions';
import { useCurrent, useStore, useVisibleImages } from '../../store';
import type { ImageItem } from '../../types';
import { cn } from '../../utils/cn';
import { formatBytes } from '../../utils/format';
import { Button } from '../ui/Button';
import { Checkbox, Slider } from '../ui/Controls';

const PAPERS = [
  { value: 'A4', label: 'A4 · 210 × 297 毫米', w: 210, h: 297 },
  { value: 'A5', label: 'A5 · 148 × 210 毫米', w: 148, h: 210 },
  { value: 'A3', label: 'A3 · 297 × 420 毫米', w: 297, h: 420 },
  { value: 'Letter', label: 'Letter · 216 × 279 毫米', w: 216, h: 279 },
  { value: 'Legal', label: 'Legal · 216 × 356 毫米', w: 216, h: 356 },
];
const LAYOUTS: { value: PrintJob['perPage']; label: string; cols: number; rows: number }[] = [
  { value: 1, label: '1 张/页', cols: 1, rows: 1 },
  { value: 2, label: '2 张/页', cols: 1, rows: 2 },
  { value: 4, label: '4 张/页', cols: 2, rows: 2 },
  { value: 6, label: '6 张/页', cols: 2, rows: 3 },
  { value: 9, label: '9 张/页', cols: 3, rows: 3 },
];

export default function PrintDialog() {
  const item = useCurrent();
  const visible = useVisibleImages();
  const favorites = useStore((s: { images: ImageItem[] }) => s.images.filter((i: ImageItem) => i.favorite && i.kind !== 'video').length);
  const [paper, setPaper] = useState('A4');
  const [landscape, setLandscape] = useState(false);
  const [margin, setMargin] = useState(12);
  const [fit, setFit] = useState<PrintFit>('contain');
  const [perPage, setPerPage] = useState<PrintJob['perPage']>(1);
  const [scope, setScope] = useState<'current' | 'all' | 'favorites'>('current');
  const [copies, setCopies] = useState(1);
  const [captionName, setCaptionName] = useState(true);
  const [captionMeta, setCaptionMeta] = useState(false);
  const [pageNumbers, setPageNumbers] = useState(true);
  const [header, setHeader] = useState(true);
  const [border, setBorder] = useState(false);
  const [grayscale, setGrayscale] = useState(false);
  const [darkPage, setDarkPage] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<'print' | 'pdf'>('print');
  const open = useStore((s) => s.dialog === 'print');
  const close = () => useStore.getState().setDialog(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const photos = useMemo(() => {
    const list =
      scope === 'current'
        ? item && item.kind !== 'video'
          ? [item]
          : []
        : scope === 'favorites'
          ? visible.filter((i) => i.favorite && i.kind !== 'video')
          : visible.filter((i) => i.kind !== 'video');
    return list;
  }, [scope, item, visible]);

  useEffect(() => setPage(0), [scope, perPage, photos.length]);

  if (!open) return null;

  const spec = PAPERS.find((x) => x.value === paper) ?? PAPERS[0];
  const pw = landscape ? spec.h : spec.w;
  const ph = landscape ? spec.w : spec.h;
  const layout = LAYOUTS.find((l) => l.value === perPage) ?? LAYOUTS[0];
  const cols = landscape && perPage === 2 ? 2 : layout.cols;
  const rows = landscape && perPage === 2 ? 1 : layout.rows;
  const pageCount = Math.max(1, Math.ceil(photos.length / perPage));
  const preview = photos.slice(page * perPage, page * perPage + perPage);
  const totalSheets = pageCount * copies;

  const buildJob = (): PrintJob => ({
    items: photos,
    paper,
    landscape,
    marginMm: margin,
    fit,
    perPage,
    copies: output === 'pdf' ? 1 : copies,
    captionName,
    captionMeta,
    pageNumbers,
    header,
    border,
    grayscale,
    darkPage,
  });

  const run = () => {
    if (!photos.length || totalSheets > 48) return;
    const job = buildJob();
    close();
    setBusy(true);
    const done = output === 'pdf' ? exportPdf(job) : printJob(job);
    void done.finally(() => setBusy(false));
  };

  return (
    <div className="dialog-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog print">
        <div className="collage-head">
          <h2 className="collage-title">打印</h2>
          <button type="button" aria-label="关闭" onClick={close} className="dialog-close">
            <X size={16} />
          </button>
        </div>
        <div className="print-body">
          <div className="print-left">
            <div className="print-head">
              <span>预览 · 第 {page + 1} / {pageCount} 页</span>
              <span className="print-head-note">{photos.length} 张 · {totalSheets} 张纸</span>
            </div>
            <div className="print-stage">
              <div
                className="print-page"
                style={{
                  aspectRatio: `${pw} / ${ph}`,
                  height: '100%',
                  maxWidth: '100%',
                  background: darkPage ? '#111' : '#fff',
                  color: darkPage ? '#f4f4f4' : '#1b1b1b',
                  padding: `${Math.max(2, (margin / ph) * 100)}%`,
                }}
              >
                {header && (
                  <div className="print-page-head">
                    <span>拾光 Lumina</span>
                    <span>预览</span>
                  </div>
                )}
                <div className="print-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
                  {preview.map((it) => (
                    <figure key={it.id} className="print-cell">
                      <img
                        src={it.thumb ?? it.url}
                        alt=""
                        className={cn(fit === 'cover' ? 'print-img-cover' : fit === 'contain' ? 'print-img-contain' : 'print-img-natural')}
                        style={{ filter: grayscale ? 'grayscale(1)' : undefined, border: border ? '1px solid currentColor' : undefined }}
                      />
                      {(captionName || captionMeta) && (
                        <figcaption className="print-caption">
                          {captionName ? it.name : ''}
                          {captionMeta ? ` ${it.width ? `${it.width}×${it.height}` : ''} ${formatBytes(it.size)}` : ''}
                        </figcaption>
                      )}
                    </figure>
                  ))}
                </div>
                {pageNumbers && <div className="print-foot">{page + 1} / {pageCount}</div>}
              </div>
            </div>
            <div className="print-nav">
              <button type="button" aria-label="上一页" disabled={page <= 0} onClick={() => setPage(page - 1)} className="print-nav-btn">
                <ChevronLeft size={16} />
              </button>
              <span className="status-meta">{spec.value} · {landscape ? '横向' : '纵向'} · {margin} mm · {copies} 份</span>
              <button type="button" aria-label="下一页" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)} className="print-nav-btn">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="print-side win-scroll">
            <Group title="纸张">
              <Select value={paper} options={PAPERS.map((x) => ({ value: x.value, label: x.label }))} onChange={setPaper} />
              <div className="print-chips print-chips--2 print-chips--top">
                {[false, true].map((value) => (
                  <button key={String(value)} type="button" onClick={() => setLandscape(value)} className={chip(landscape === value)}>
                    {value ? '横向' : '纵向'}
                  </button>
                ))}
              </div>
            </Group>
            <Group title="每页版式">
              <div className="print-chips print-chips--3">
                {LAYOUTS.map((l) => (
                  <button key={l.value} type="button" onClick={() => setPerPage(l.value)} className={chip(perPage === l.value)}>
                    {l.label}
                  </button>
                ))}
              </div>
            </Group>
            <Group title={`边距 · ${margin} 毫米`}>
              <Slider ariaLabel="边距" min={0} max={30} value={margin} onChange={setMargin} />
            </Group>
            <Group title="图片缩放">
              <Select
                value={fit}
                options={[
                  { value: 'contain', label: '适应单元格，保持比例' },
                  { value: 'cover', label: '填满单元格，超出裁切' },
                  { value: 'natural', label: '不放大，只缩小过大图片' },
                ]}
                onChange={(v) => setFit(v as PrintFit)}
              />
            </Group>
            <Group title="打印范围">
              <Select
                value={scope}
                options={[
                  { value: 'current', label: item?.kind === 'video' ? '当前不是图片' : '当前图片' },
                  { value: 'all', label: `列表中的全部图片（${visible.filter((i) => i.kind !== 'video').length}）` },
                  { value: 'favorites', label: `收藏的图片（${favorites}）` },
                ]}
                onChange={(v) => setScope(v as 'current' | 'all' | 'favorites')}
              />
            </Group>
            <Group title="输出">
              <div className="print-chips print-chips--2">
                <button type="button" onClick={() => setOutput('print')} className={chip(output === 'print')}>
                  打印
                </button>
                <button type="button" onClick={() => setOutput('pdf')} className={chip(output === 'pdf')}>
                  导出 PDF
                </button>
              </div>
              {output === 'pdf' && (
                <p className="print-note">
                  将在系统窗口中选择「Microsoft Print to PDF」保存；份数固定为 1。
                </p>
              )}
            </Group>
            {output === 'print' && (
              <Group title={`份数 · ${copies}`}>
                <Slider ariaLabel="份数" min={1} max={10} value={copies} onChange={setCopies} />
              </Group>
            )}
            <Group title="页面内容">
              <div className="print-list">
                <Checkbox checked={captionName} onChange={setCaptionName}>文件名</Checkbox>
                <Checkbox checked={captionMeta} onChange={setCaptionMeta}>尺寸与文件大小</Checkbox>
                <Checkbox checked={header} onChange={setHeader}>页眉（拾光 + 时间）</Checkbox>
                <Checkbox checked={pageNumbers} onChange={setPageNumbers}>页码</Checkbox>
                <Checkbox checked={border} onChange={setBorder}>图片细边框</Checkbox>
                <Checkbox checked={grayscale} onChange={setGrayscale}>黑白打印</Checkbox>
                <Checkbox checked={darkPage} onChange={setDarkPage}>深色纸底</Checkbox>
              </div>
            </Group>
            <p className="print-side-note">
              旋转、翻转和调色会先渲染进打印稿。视频会被跳过。一次最多 48 页，超出请缩小范围。
              {totalSheets > 48 ? ' 当前页数已超出限制。' : ''}
            </p>
          </div>
        </div>
        <div className="dialog-footer">
          <Button variant="accent" disabled={!photos.length || busy || totalSheets > 48} onClick={run}>
            {output === 'pdf' ? <FileDown size={15} /> : <Printer size={15} />}
            {busy ? '正在排版…' : output === 'pdf' ? '导出 PDF' : `打印 ${totalSheets} 页`}
          </Button>
          <Button onClick={close}>取消</Button>
        </div>
      </div>
    </div>
  );
}

function chip(active: boolean) {
  return cn('print-chip', active ? 'print-chip--on' : 'print-chip--off');
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="print-card">
      <h3 className="print-card-title">{title}</h3>
      {children}
    </div>
  );
}

function Select({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="print-plain-select">
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
