import { Lock, LockOpen } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { saveImage, type SaveFormat } from '../../actions';
import { useCurrent, useStore } from '../../store';
import type { ImageItem } from '../../types';
import { cn } from '../../utils/cn';
import { baseName } from '../../utils/format';
import { isEdited, visualSize } from '../../utils/image';
import { Button } from '../ui/Button';
import { Checkbox, Segmented, Slider } from '../ui/Controls';
import { Dialog } from '../ui/Dialog';

const S = useStore.getState;

type SizeMode = '100' | '75' | '50' | '25' | 'custom';

function Inner({ item, onClose }: { item: ImageItem; onClose: () => void }) {
  const edited = isEdited(item);
  const [applyEdits, setApplyEdits] = useState(true);
  const dims = applyEdits ? visualSize(item) : { w: item.width, h: item.height };
  const defaultFormat: SaveFormat =
    item.type === 'image/png' || item.type === 'image/svg+xml' || item.type === 'image/gif'
      ? 'image/png'
      : item.type === 'image/webp'
        ? 'image/webp'
        : 'image/jpeg';
  const [name, setName] = useState(() => baseName(item.name) + (edited ? '_编辑' : '_副本'));
  const [format, setFormat] = useState<SaveFormat>(defaultFormat);
  const [quality, setQuality] = useState(92);
  const [sizeMode, setSizeMode] = useState<SizeMode>('100');
  const [cw, setCw] = useState(dims.w);
  const [ch, setCh] = useState(dims.h);
  const [lock, setLock] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCw(dims.w);
    setCh(dims.h);
  }, [dims.w, dims.h]);

  const out =
    sizeMode === 'custom'
      ? { w: Math.max(1, Math.round(cw || 1)), h: Math.max(1, Math.round(ch || 1)) }
      : { w: Math.max(1, Math.round((dims.w * Number(sizeMode)) / 100)), h: Math.max(1, Math.round((dims.h * Number(sizeMode)) / 100)) };
  const tooBig = out.w > 16384 || out.h > 16384 || out.w * out.h > 150e6;

  const setWidth = (v: number) => {
    setCw(v);
    if (lock && dims.w) setCh(Math.max(1, Math.round((v * dims.h) / dims.w)));
  };
  const setHeight = (v: number) => {
    setCh(v);
    if (lock && dims.h) setCw(Math.max(1, Math.round((v * dims.w) / dims.h)));
  };

  const save = async () => {
    if (saving || tooBig || !dims.w) return;
    setSaving(true);
    const ok = await saveImage(item, {
      name: name.trim() || 'image',
      format,
      quality,
      width: out.w,
      height: out.h,
      applyEdits,
    });
    setSaving(false);
    if (ok) onClose();
  };

  const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/png' ? 'png' : 'webp';

  return (
    <div className="flex flex-col gap-5">
      {item.remote && (
        <div className="rounded-md border border-[#f7630c]/40 bg-[#f7630c]/10 px-3 py-2 text-xs leading-5 text-fg">
          这是一张在线示例图片，受浏览器跨域限制可能无法导出。请打开本地图片后再试。
        </div>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] text-fg">文件名</span>
        <div className="flex items-center rounded-[5px] border border-stroke bg-card focus-within:border-accent">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
            className="h-8 min-w-0 flex-1 bg-transparent px-3 text-[13px] text-fg outline-none"
            autoFocus
          />
          <span className="pr-3 text-[13px] text-fg3">.{ext}</span>
        </div>
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-fg">格式</span>
        <Segmented
          value={format}
          options={[
            { value: 'image/jpeg' as SaveFormat, label: 'JPG' },
            { value: 'image/png' as SaveFormat, label: 'PNG' },
            { value: 'image/webp' as SaveFormat, label: 'WebP' },
          ]}
          onChange={setFormat}
          className="self-start"
        />
      </div>

      {format !== 'image/png' && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-fg">质量</span>
            <span className="tabular-nums text-fg2">{quality}%</span>
          </div>
          <Slider ariaLabel="质量" min={10} max={100} value={quality} onChange={setQuality} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-fg">尺寸</span>
        <div className="flex flex-wrap gap-1.5">
          {(['100', '75', '50', '25', 'custom'] as SizeMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSizeMode(m)}
              className={cn(
                'h-8 rounded-[5px] border px-3 text-[13px] transition-colors',
                sizeMode === m ? 'border-transparent bg-accent text-on-accent' : 'border-stroke bg-card text-fg hover:bg-card-hover',
              )}
            >
              {m === 'custom' ? '自定义' : m === '100' ? '原始大小' : `${m}%`}
            </button>
          ))}
        </div>
        {sizeMode === 'custom' && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-fg2">
              宽
              <input
                type="number"
                min={1}
                value={cw}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="h-8 w-24 rounded-[5px] border border-stroke bg-card px-2 text-[13px] text-fg outline-none focus:border-accent"
              />
            </label>
            <button
              type="button"
              aria-label={lock ? '取消锁定宽高比' : '锁定宽高比'}
              title={lock ? '已锁定宽高比' : '未锁定宽高比'}
              onClick={() => setLock((l) => !l)}
              className={cn('mt-0.5 flex h-8 w-8 items-center justify-center rounded-md hover:bg-subtle', lock ? 'text-accent' : 'text-fg2')}
            >
              {lock ? <Lock size={15} /> : <LockOpen size={15} />}
            </button>
            <label className="flex items-center gap-2 text-xs text-fg2">
              高
              <input
                type="number"
                min={1}
                value={ch}
                onChange={(e) => setHeight(Number(e.target.value))}
                className="h-8 w-24 rounded-[5px] border border-stroke bg-card px-2 text-[13px] text-fg outline-none focus:border-accent"
              />
            </label>
          </div>
        )}
        <div className={cn('text-xs', tooBig ? 'text-[#ff99a4]' : 'text-fg2')}>
          输出：{out.w} × {out.h} 像素{tooBig ? '（尺寸过大，请减小）' : ''}
        </div>
      </div>

      {edited && (
        <Checkbox checked={applyEdits} onChange={setApplyEdits}>
          应用旋转、翻转与调色效果
        </Checkbox>
      )}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button variant="accent" disabled={saving || tooBig || !dims.w} onClick={save}>
          {saving ? '正在保存…' : '保存'}
        </Button>
        <Button onClick={onClose}>取消</Button>
      </div>
    </div>
  );
}

export default function SaveDialog() {
  const open = useStore((s) => s.dialog === 'saveAs');
  const item = useCurrent();
  const close = useCallback(() => S().setDialog(null), []);
  const supported = !!item && item.kind !== 'video';
  return (
    <Dialog open={open && supported} onClose={close} title="另存为" width={460}>
      {item && item.kind !== 'video' && <Inner key={item.id} item={item} onClose={close} />}
    </Dialog>
  );
}
