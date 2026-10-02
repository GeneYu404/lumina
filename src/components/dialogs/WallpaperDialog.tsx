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
    <div className="dialog-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog wall-dialog">
        <div className="wall-head">
          <h2 className="collage-title">设为桌面背景</h2>
          <button type="button" aria-label="关闭" onClick={close} className="dialog-close">
            <X size={16} />
          </button>
        </div>
        <div className="wall-body">
          <div className="wall-preview">
            <img src={item.thumb ?? item.url} alt={item.name} className="wall-img" />
          </div>
          <h3 className="mini-title">摆放方式</h3>
          <div className="wall-styles">
            {WALLPAPER_STYLES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStyle(s.value)}
                className={cn('wall-style', style === s.value ? 'wall-style--on' : 'wall-style--off')}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="dialog-footer">
          <Button variant="accent" disabled={busy} onClick={apply}>
            {busy ? '设置中…' : '设为背景'}
          </Button>
          <Button onClick={close}>取消</Button>
        </div>
      </div>
    </div>
  );
}
