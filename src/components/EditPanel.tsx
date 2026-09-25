import {
  Blend,
  CircleDot,
  Contrast,
  Crop,
  Droplet,
  Eye,
  FlipHorizontal2,
  FlipVertical2,
  Palette,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Save,
  SunMedium,
  Thermometer,
  Undo2,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { startCrop } from '../actions';
import { useCurrent, useStore } from '../store';
import type { Adjustments, ImageItem } from '../types';
import { cn } from '../utils/cn';
import {
  blurNatural,
  cssFilter,
  DEFAULT_ADJUST,
  isAdjusted,
  normRot,
  sameAdjust,
  temperatureColor,
  vignetteGradient,
} from '../utils/image';
import { PanelHeader, Section } from './InfoPanel';
import { Button } from './ui/Button';
import { Slider } from './ui/Controls';

const S = useStore.getState;

const PRESETS: { name: string; adjust: Partial<Adjustments> }[] = [
  { name: '原图', adjust: {} },
  { name: '鲜艳', adjust: { saturate: 145, contrast: 110, brightness: 103 } },
  { name: '暖阳', adjust: { temperature: 45, saturate: 110, brightness: 104 } },
  { name: '清冷', adjust: { temperature: -45, saturate: 95, contrast: 106 } },
  { name: '黑白', adjust: { grayscale: 100, contrast: 118 } },
  { name: '复古', adjust: { sepia: 55, contrast: 92, brightness: 105, saturate: 85, vignette: 35 } },
  { name: '戏剧', adjust: { contrast: 140, saturate: 80, brightness: 94, vignette: 45 } },
  { name: '褪色', adjust: { contrast: 80, saturate: 70, brightness: 112 } },
  { name: '胶片', adjust: { sepia: 20, contrast: 108, saturate: 90, hue: -8, vignette: 25 } },
];

function PresetPreview({ item, adjust }: { item: ImageItem; adjust: Adjustments }) {
  if (!item.thumb) return <div className="h-full w-full animate-pulse bg-subtle" />;
  const minSide = Math.max(1, Math.min(item.width || 80, item.height || 80));
  const blur = blurNatural(adjust, item.width || 80, item.height || 80) * (84 / minSide);
  const tc = temperatureColor(adjust.temperature);
  const vg = vignetteGradient(adjust.vignette);
  return (
    <div
      className="absolute inset-0"
      style={{
        transform: `rotate(${item.rotation}deg) scale(${item.flipH ? -1 : 1}, ${item.flipV ? -1 : 1})`,
        isolation: 'isolate',
      }}
    >
      <img src={item.thumb} alt="" draggable={false} className="h-full w-full max-w-none object-cover" style={{ filter: cssFilter(adjust, blur) }} />
      {tc && <div className="absolute inset-0" style={{ background: tc, mixBlendMode: 'soft-light' }} />}
      {vg && <div className="absolute inset-0" style={{ background: vg }} />}
    </div>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function AdjustSlider({
  icon: Icon,
  label,
  value,
  min,
  max,
  neutral,
  onChange,
  format,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  min: number;
  max: number;
  neutral: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const changed = value !== neutral;
  return (
    <div className="py-1">
      <div className="flex items-center justify-between text-[13px]">
        <button
          type="button"
          title="双击重置"
          onDoubleClick={() => onChange(neutral)}
          className="flex items-center gap-2 rounded px-0.5 text-fg"
        >
          <Icon size={15} strokeWidth={1.6} className="text-fg2" />
          {label}
        </button>
        <span className={cn('text-xs tabular-nums', changed ? 'text-accent' : 'text-fg3')}>
          {format ? format(value) : signed(value - neutral)}
        </span>
      </div>
      <Slider ariaLabel={label} min={min} max={max} value={value} onChange={onChange} onDoubleClick={() => onChange(neutral)} />
    </div>
  );
}

export default function EditPanel() {
  const item = useCurrent();
  if (!item) return null;
  const a = item.adjust;
  const set = (patch: Partial<Adjustments>) => S().setAdjust(item.id, patch);
  const adjusted = isAdjusted(a);
  const transformed = normRot(item.rotation) !== 0 || item.flipH || item.flipV;
  const canRevert = adjusted || transformed || item.cropped;

  const stopCompare = () => S().setComparing(false);

  return (
    <aside className="animate-panel-in flex w-[320px] shrink-0 flex-col border-l border-stroke bg-layer max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-30 max-md:bg-app max-md:shadow-2xl">
      <PanelHeader title="编辑与调整" onClose={() => S().setPanel(null)} />
      <div className="win-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <Section title="滤镜" right={<WandSparkles size={14} className="text-fg3" />}>
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((p) => {
              const full: Adjustments = { ...DEFAULT_ADJUST, ...p.adjust };
              const active = sameAdjust(full, a);
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => S().replaceAdjust(item.id, full)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-md p-1 text-xs transition-colors',
                    active ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-subtle',
                  )}
                >
                  <div className={cn('relative aspect-square w-full overflow-hidden rounded', active && 'outline-2 outline-accent')}>
                    <PresetPreview item={item} adjust={full} />
                  </div>
                  {p.name}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="旋转与裁剪">
          <div className="grid grid-cols-5 gap-1">
            {[
              { icon: Crop, label: '裁剪', fn: startCrop, disabled: item.remote },
              { icon: RotateCcw, label: '左转', fn: () => S().rotate(item.id, -90) },
              { icon: RotateCw, label: '右转', fn: () => S().rotate(item.id, 90) },
              { icon: FlipHorizontal2, label: '水平', fn: () => S().flip(item.id, 'h') },
              { icon: FlipVertical2, label: '垂直', fn: () => S().flip(item.id, 'v') },
            ].map((b) => (
              <button
                key={b.label}
                type="button"
                disabled={b.disabled}
                onClick={b.fn}
                className="flex flex-col items-center gap-1 rounded-md py-2 text-[11px] text-fg hover:bg-subtle disabled:opacity-40"
              >
                <b.icon size={18} strokeWidth={1.6} />
                {b.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="光线">
          <AdjustSlider icon={SunMedium} label="亮度" value={a.brightness} min={0} max={200} neutral={100} onChange={(v) => set({ brightness: v })} />
          <AdjustSlider icon={Contrast} label="对比度" value={a.contrast} min={0} max={200} neutral={100} onChange={(v) => set({ contrast: v })} />
          <AdjustSlider icon={CircleDot} label="暗角" value={a.vignette} min={0} max={100} neutral={0} onChange={(v) => set({ vignette: v })} format={(v) => `${v}`} />
        </Section>

        <Section title="颜色">
          <AdjustSlider icon={Droplet} label="饱和度" value={a.saturate} min={0} max={200} neutral={100} onChange={(v) => set({ saturate: v })} />
          <AdjustSlider icon={Thermometer} label="色温" value={a.temperature} min={-100} max={100} neutral={0} onChange={(v) => set({ temperature: v })} />
          <AdjustSlider icon={Palette} label="色相" value={a.hue} min={-180} max={180} neutral={0} onChange={(v) => set({ hue: v })} format={(v) => `${signed(v)}°`} />
        </Section>

        <Section title="效果">
          <AdjustSlider icon={Blend} label="灰度" value={a.grayscale} min={0} max={100} neutral={0} onChange={(v) => set({ grayscale: v })} format={(v) => `${v}%`} />
          <AdjustSlider icon={Blend} label="怀旧" value={a.sepia} min={0} max={100} neutral={0} onChange={(v) => set({ sepia: v })} format={(v) => `${v}%`} />
          <AdjustSlider icon={Contrast} label="反相" value={a.invert} min={0} max={100} neutral={0} onChange={(v) => set({ invert: v })} format={(v) => `${v}%`} />
          <AdjustSlider icon={Droplet} label="模糊" value={a.blur} min={0} max={100} neutral={0} onChange={(v) => set({ blur: v })} format={(v) => `${v}`} />
        </Section>

        {canRevert && (
          <button
            type="button"
            onClick={() => S().revertEdits(item.id)}
            className="mt-1 flex items-center gap-2 text-[13px] text-accent hover:underline"
          >
            <Undo2 size={14} /> 还原为原始图片
          </button>
        )}
      </div>
      <footer className="flex items-center gap-2 border-t border-stroke p-3">
        <Button
          className="px-3"
          disabled={!adjusted}
          title="按住查看原图"
          onPointerDown={() => S().setComparing(true)}
          onPointerUp={stopCompare}
          onPointerLeave={stopCompare}
          onPointerCancel={stopCompare}
        >
          <Eye size={15} /> 对比
        </Button>
        <Button className="px-3" disabled={!adjusted} onClick={() => S().replaceAdjust(item.id, DEFAULT_ADJUST)}>
          <RefreshCcw size={14} /> 重置
        </Button>
        <Button variant="accent" className="ml-auto px-3" onClick={() => S().setDialog('saveAs')}>
          <Save size={15} /> 另存为
        </Button>
      </footer>
    </aside>
  );
}
