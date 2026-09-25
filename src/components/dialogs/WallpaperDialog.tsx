import { X } from 'lucide-react';
import { useState } from 'react';
import { useCurrent, useStore } from '../../store';
import { setWallpaper, WALLPAPER_STYLES, type WallpaperStyle } from '../../native';
import { cn } from '../../utils/cn';
import { Button } from '../ui/Button';

/** 设置桌面背景：五种 Windows 摆放方式，成功后轻提示。 */
export default function WallpaperDialog() {
  const open = useStore((s) => s.dialog === 'wallpaper');
  const item = useCurrent();
  const [style, setStyle] = useState<WallpaperStyle>('fill');
  const [busy, setBusy] = useState(false);
  const close = () => useStore.getState().setDialog(null);
  if (!open || !item) return null;

  const apply = async () => {
    setBusy(true);
    const ok = await setWallpaper(item.path, style);
    setBusy(false);
    close();
    useStore.getState().toast(ok ? '已设为桌面背景' : '设置桌面背景失败（不支持的格式或无权限）', {
      kind: ok ? 'success' : 'error',
    });
  };

  return (
    <div className="animate-fade-in fixed inset-0 z-[900] flex items-center justify-center bg-black/35 p-4" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="animate-dialog-in w-full max-w-md overflow-hidden rounded-lg border border-stroke bg-dialog text-fg shadow-dialog">
        <div className="flex items-center justify-between px-6 pb-2 pt-5">
          <h2 className="text-xl font-semibold">设为桌面背景</h2>
          <button type="button" aria-label="关闭" onClick={close} className="flex h-8 w-8 items-center justify-center rounded-md text-fg2 hover:bg-subtle">
            <X size={16} />
          </button>
        </div>
        <div className="px-6 pb-5">
          <div className="mb-4 overflow-hidden rounded-md border border-stroke bg-viewer p-3">
            <img src={item.thumb ?? item.url} alt={item.name} className="mx-auto max-h-40 rounded" />
          </div>
          <h3 className="mb-2 text-[13px] font-semibold">摆放方式</h3>
          <div className="grid grid-cols-5 gap-1.5">
            {WALLPAPER_STYLES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStyle(s.value)}
                className={cn('h-9 rounded-[5px] border text-[13px]', style === s.value ? 'border-accent bg-accent-soft text-accent' : 'border-stroke bg-card hover:bg-card-hover')}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid auto-cols-fr grid-flow-col gap-2 border-t border-stroke bg-dialog-footer px-6 py-5">
          <Button variant="accent" disabled={busy} onClick={apply}>
            {busy ? '设置中…' : '设为背景'}
          </Button>
          <Button onClick={close}>取消</Button>
        </div>
      </div>
    </div>
  );
}
