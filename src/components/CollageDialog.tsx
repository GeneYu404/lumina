import { Check, Download, Grid2x2, Minus, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadBlob } from '../actions';
import { isDesktop, readItemBytes } from '../desktop';
import { useVisibleImages } from '../store';
import type { ImageItem } from '../types';
import { cn } from '../utils/cn';
import { stamp } from '../utils/format';
import { Button } from './ui/Button';
import { Slider } from './ui/Controls';

type Layout = 'row' | 'column' | 'grid' | 'hero';
const LAYOUTS: { value: Layout; label: string; icon: string }[] = [
  { value: 'row', label: '横向一行', icon: '▤' },
  { value: 'column', label: '纵向一列', icon: '▥' },
  { value: 'grid', label: '网格', icon: '▦' },
  { value: 'hero', label: '主角大图', icon: '▣' },
];

/** Same-origin bitmap so the canvas is not tainted (asset URLs are cross-origin). */
async function loadImage(item: ImageItem): Promise<HTMLImageElement | null> {
  try {
    let url = item.url;
    let revoke = false;
    if (isDesktop && !url.startsWith('blob:')) {
      url = URL.createObjectURL(await readItemBytes(item.path));
      revoke = true;
    }
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('load'));
      img.src = url;
    });
    if (revoke) window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return img;
  } catch {
    return null;
  }
}

export default function CollageDialog({ onClose }: { onClose: () => void }) {
  const all = useVisibleImages().filter((i) => i.kind !== 'video' && !i.error);
  const [picked, setPicked] = useState<string[]>(() => all.slice(0, 4).map((i) => i.id));
  const [layout, setLayout] = useState<Layout>('grid');
  const [gap, setGap] = useState(12);
  const [radius, setRadius] = useState(12);
  const [padding, setPadding] = useState(24);
  const [bg, setBg] = useState('#14171c');
  const [quality, setQuality] = useState(92);
  const [format, setFormat] = useState<'image/png' | 'image/jpeg' | 'image/webp'>('image/png');
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const selected = picked.map((id) => all.find((i) => i.id === id)).filter((i): i is ImageItem => !!i);

  const draw = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || selected.length === 0) {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      return;
    }
    setBusy(true);
    try {
      const imgs = await Promise.all(selected.map(loadImage));
      const list = imgs.map((img, i) => ({ img, item: selected[i] })).filter((x) => x.img);
      if (!list.length) return;
      const cell = 480;
      const count = list.length;
      let cols = 1;
      let rows = count;
      if (layout === 'row') { cols = count; rows = 1; }
      else if (layout === 'grid') { cols = Math.ceil(Math.sqrt(count)); rows = Math.ceil(count / cols); }
      else if (layout === 'hero') { cols = 2; rows = 2; }

      const w = padding * 2 + cols * cell + (cols - 1) * gap;
      const h = padding * 2 + rows * cell + (rows - 1) * gap;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const rounded = (x: number, y: number, cw: number, ch: number) => {
        const r = Math.min(radius, cw / 2, ch / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + cw, y, x + cw, y + ch, r);
        ctx.arcTo(x + cw, y + ch, x, y + ch, r);
        ctx.arcTo(x, y + ch, x, y, r);
        ctx.arcTo(x, y, x + cw, y, r);
        ctx.closePath();
      };
      const coverDraw = (img: HTMLImageElement, x: number, y: number, cw: number, ch: number) => {
        ctx.save();
        rounded(x, y, cw, ch);
        ctx.clip();
        const s = Math.max(cw / img.width, ch / img.height);
        const dw = img.width * s;
        const dh = img.height * s;
        ctx.drawImage(img, x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
        ctx.restore();
      };

      if (layout === 'hero') {
        const [first, ...rest] = list;
        const side = cell * 2 + gap;
        coverDraw(first.img!, padding, padding, side, side);
        rest.slice(0, 3).forEach((x, i) => {
          const row = Math.floor(i / 2);
          const col = i % 2;
          coverDraw(x.img!, padding + col * (cell + gap), padding + row * (cell + gap), cell, cell);
        });
      } else {
        list.forEach((x, i) => {
          const row = Math.floor(i / cols);
          const col = i % cols;
          coverDraw(x.img!, padding + col * (cell + gap), padding + row * (cell + gap), cell, cell);
        });
      }
    } finally {
      setBusy(false);
    }
  }, [selected, layout, gap, radius, padding, bg]);

  useEffect(() => {
    void draw();
  }, [draw]);

  const move = (index: number, delta: number) => {
    const next = [...picked];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPicked(next);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width) return;
    setBusy(true);
    canvas.toBlob(
      (blob) => {
        setBusy(false);
        if (!blob) return;
        downloadBlob(blob, `拼图_${stamp()}.${format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : 'jpg'}`);
        onClose();
      },
      format,
      quality / 100,
    );
  };

  return (
    <div className="dialog-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog collage">
        <div className="collage-head">
          <h2 className="collage-title">拼图</h2>
          <button type="button" aria-label="关闭" onClick={onClose} className="dialog-close">
            <X size={16} />
          </button>
        </div>
        <div className="collage-body">
          <div className="collage-left">
            <div className="collage-stage">
              <canvas ref={canvasRef} className="collage-canvas" />
              {selected.length === 0 && <div className="collage-empty">从右侧选择要拼接的图片</div>}
            </div>
            <div className="collage-row">
              {selected.map((it, i) => (
                <div key={it.id} className="pcard">
                  <img src={it.thumb ?? it.url} alt={it.name} className="pcard-img" />
                  <div className="pcard-move">
                    <button type="button" aria-label="前移" onClick={() => move(i, -1)} className="pcard-move-btn"><Minus size={10} /></button>
                    <button type="button" aria-label="后移" onClick={() => move(i, 1)} className="pcard-move-btn"><Plus size={10} /></button>
                  </div>
                  <button type="button" aria-label="移除" onClick={() => setPicked(picked.filter((p) => p !== it.id))} className="pcard-del">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="collage-side win-scroll">
            <Section title="图片（按顺序点选）">
              <div className="pick-grid">
                {all.slice(0, 60).map((it) => {
                  const on = picked.includes(it.id);
                  return (
                    <button
                      key={it.id}
                      type="button"
                      title={it.name}
                      onClick={() => setPicked(on ? picked.filter((p) => p !== it.id) : [...picked, it.id])}
                      className={cn('pick', on ? 'pick--on' : 'pick--off')}
                    >
                      <img src={it.thumb ?? it.url} alt="" className="pick-img" />
                      {on && (
                        <span className="pick-check">
                          <Check size={10} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </Section>
            <Section title="布局">
              <div className="layout-grid">
                {LAYOUTS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => setLayout(l.value)}
                    className={cn('layout-btn', layout === l.value ? 'layout-btn--on' : 'layout-btn--off')}
                  >
                    <Grid2x2 size={14} /> {l.label}
                  </button>
                ))}
              </div>
            </Section>
            <Section title="样式">
              <Row label="间距" value={`${gap}px`}>
                <Slider ariaLabel="间距" min={0} max={48} value={gap} onChange={setGap} />
              </Row>
              <Row label="圆角" value={`${radius}px`}>
                <Slider ariaLabel="圆角" min={0} max={40} value={radius} onChange={setRadius} />
              </Row>
              <Row label="外边距" value={`${padding}px`}>
                <Slider ariaLabel="外边距" min={0} max={80} value={padding} onChange={setPadding} />
              </Row>
              <div className="mini-color-row">
                <span>背景色</span>
                <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="color-input" aria-label="背景色" />
              </div>
            </Section>
            <Section title="导出">
              <div className="fmt-row">
                {(['image/png', 'image/jpeg', 'image/webp'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    className={cn('fmt-btn', format === f ? 'fmt-btn--on' : 'fmt-btn--off')}
                  >
                    {f === 'image/png' ? 'PNG' : f === 'image/jpeg' ? 'JPG' : 'WebP'}
                  </button>
                ))}
              </div>
              {format !== 'image/png' && (
                <Row label="质量" value={`${quality}%`}>
                  <Slider ariaLabel="质量" min={10} max={100} value={quality} onChange={setQuality} />
                </Row>
              )}
            </Section>
          </div>
        </div>
        <div className="dialog-footer">
          <Button variant="accent" disabled={!selected.length || busy} onClick={save}>
            <Download size={15} /> {busy ? '处理中…' : '导出拼图'}
          </Button>
          <Button onClick={onClose}>取消</Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mini-section">
      <h3 className="mini-title">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="mini-row">
      <div className="mini-row-head">
        <span>{label}</span>
        <span className="mini-row-val">{value}</span>
      </div>
      {children}
    </div>
  );
}
