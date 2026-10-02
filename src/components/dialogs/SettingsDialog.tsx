import {
  Check,
  Droplet,
  Film,
  Image as ImageIcon,
  Map as MapIcon,
  Monitor,
  Moon,
  MousePointer2,
  Palette,
  Play,
  Repeat,
  Scale,
  Scan,
  Shuffle,
  Sun,
  Timer,
  Trash2,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../../store';
import type { SlideTransition, ViewerBg } from '../../types';
import { cn } from '../../utils/cn';
import { Button } from '../ui/Button';
import { Checkbox, Segmented, Select, Toggle } from '../ui/Controls';
import { assocSet, assocState, openDefaultApps, setShellMenu, shellMenuState } from '../../native';
import { ASSOC_EXTS, VIDEO_EXTS } from '../../utils/files';
import { Dialog } from '../ui/Dialog';
import { LicensesDialog } from './LicensesDialog';
import { AppIcon } from '../ui/Icons';

const S = useStore.getState;

const ACCENTS = ['#0078D4', '#0099BC', '#00B294', '#10893E', '#FFB900', '#F7630C', '#E81123', '#E3008C', '#8764B8', '#6B69D6', '#7A7574'];

const BG_OPTIONS: { value: ViewerBg; label: string; cls: string }[] = [
  { value: 'theme', label: '跟随主题', cls: 'set-bg-swatch--theme' },
  { value: 'black', label: '黑色', cls: 'set-bg-swatch--black' },
  { value: 'white', label: '白色', cls: 'set-bg-swatch--white' },
  { value: 'checker', label: '棋盘格', cls: 'set-bg-swatch--checker' },
  { value: 'ambient', label: '氛围模糊', cls: 'set-bg-swatch--ambient' },
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="set-group">
      <h3 className="set-group-title">{title}</h3>
      <div className="set-group-body">{children}</div>
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  desc,
  children,
  vertical,
}: {
  icon: LucideIcon;
  title: string;
  desc?: string;
  children: ReactNode;
  vertical?: boolean;
}) {
  return (
    <div className={cn('set-card', vertical ? 'set-card--col' : 'set-card--row')}>
      <div className="set-card-main">
        <Icon size={18} strokeWidth={1.6} className="set-card-icon" />
        <div className="set-card-body">
          <div className="set-card-title">{title}</div>
          {desc && <div className="set-card-desc">{desc}</div>}
        </div>
      </div>
      <div className={cn(vertical ? 'set-card-ctrl--col' : 'set-card-ctrl')}>{children}</div>
    </div>
  );
}

export default function SettingsDialog() {
  const open = useStore((s) => s.dialog === 'settings');
  const st = useStore((s) => s.settings);
  const close = useCallback(() => S().setDialog(null), []);
  const set = S().setSetting;
  const [shell, setShell] = useState(false);
  const [assoc, setAssoc] = useState<Set<string>>(() => new Set());
  const [assocOpen, setAssocOpen] = useState(false);
  const [licenses, setLicenses] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const [menu, registered] = await Promise.all([shellMenuState(), assocState()]);
      if (alive) {
        setShell(menu);
        setAssoc(registered);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={close}
      title="设置"
      width={580}
      footer={
        <Button variant="accent" onClick={close}>
          完成
        </Button>
      }
    >
      <Group title="外观">
        <Card icon={Palette} title="应用主题" desc="选择浅色、深色，或跟随系统设置">
          <Segmented
            value={st.theme}
            options={[
              { value: 'light', label: '浅色', icon: Sun },
              { value: 'dark', label: '深色', icon: Moon },
              { value: 'system', label: '系统', icon: Monitor },
            ]}
            onChange={(v) => set('theme', v)}
          />
        </Card>
        <Card icon={Droplet} title="强调色" desc="用于按钮、选中项和高亮" vertical>
          <div className="set-swatches">
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`强调色 ${c}`}
                onClick={() => set('accent', c)}
                className={cn('set-swatch', st.accent.toLowerCase() === c.toLowerCase() && 'set-swatch--on')}
                style={{ background: c }}
              >
                {st.accent.toLowerCase() === c.toLowerCase() && <Check size={16} className="fav-shadow" strokeWidth={2.5} />}
              </button>
            ))}
          </div>
        </Card>
        <Card icon={ImageIcon} title="查看器背景" vertical>
          <div className="set-bgs">
            {BG_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => set('viewerBg', o.value)}
                className={cn('set-bg', st.viewerBg === o.value ? 'set-bg--on' : 'set-bg--off')}
              >
                <span className={cn('set-bg-swatch', o.cls, st.viewerBg === o.value && 'set-bg-swatch--on')} />
                {o.label}
              </button>
            ))}
          </div>
        </Card>
      </Group>

      <Group title="浏览">
        <Card icon={MousePointer2} title="鼠标滚轮" desc="按住 Ctrl 滚动始终为缩放">
          <Select
            className="select-w32"
            value={st.wheelAction}
            options={[
              { value: 'zoom', label: '缩放' },
              { value: 'navigate', label: '切换图片' },
            ]}
            onChange={(v) => set('wheelAction', v)}
          />
        </Card>
        <Card icon={Repeat} title="循环浏览" desc="在最后一张之后回到第一张">
          <Toggle checked={st.loop} onChange={(v) => set('loop', v)} label="循环浏览" />
        </Card>
        <Card icon={ZoomIn} title="小图片放大以适应窗口">
          <Toggle checked={st.upscaleSmall} onChange={(v) => set('upscaleSmall', v)} label="小图片放大" />
        </Card>
        <Card icon={Scan} title="高倍放大时显示像素" desc="缩放超过 300% 时使用最近邻插值">
          <Toggle checked={st.pixelated} onChange={(v) => set('pixelated', v)} label="显示像素" />
        </Card>
        <Card icon={MapIcon} title="显示导航小地图" desc="放大图片时在右下角显示">
          <Toggle checked={st.showMinimap} onChange={(v) => set('showMinimap', v)} label="导航小地图" />
        </Card>
        <Card icon={Film} title="显示胶片栏">
          <Toggle checked={st.showFilmstrip} onChange={(v) => set('showFilmstrip', v)} label="胶片栏" />
        </Card>
        <Card icon={Trash2} title="移除图片前确认">
          <Toggle checked={st.confirmRemove} onChange={(v) => set('confirmRemove', v)} label="移除前确认" />
        </Card>
      </Group>

      <Group title="幻灯片放映">
        <Card icon={Timer} title="切换间隔">
          <Select
            className="select-w32"
            value={st.slideInterval}
            options={[2, 3, 4, 5, 8, 10, 15, 30].map((n) => ({ value: n, label: `${n} 秒` }))}
            onChange={(v) => set('slideInterval', v)}
          />
        </Card>
        <Card icon={Play} title="过渡效果">
          <Select<SlideTransition>
            className="select-w32"
            value={st.slideTransition}
            options={[
              { value: 'fade', label: '淡入淡出' },
              { value: 'slide', label: '滑动' },
              { value: 'zoom', label: '缩放' },
              { value: 'none', label: '无' },
            ]}
            onChange={(v) => set('slideTransition', v)}
          />
        </Card>
        <Card icon={Shuffle} title="随机顺序">
          <Toggle checked={st.slideShuffle} onChange={(v) => set('slideShuffle', v)} label="随机顺序" />
        </Card>
      </Group>

      <Group title="系统集成">
        <Card icon={MousePointer2} title="右键菜单" desc="在资源管理器中显示“用拾光打开”；关闭后不再向系统注册">
          <Toggle
            checked={shell}
            label="右键菜单"
            onChange={(v) => {
              const next = v;
              setShell(next);
              void setShellMenu(next).then((ok) => {
                setShell(ok);
                useStore.getState().toast(ok ? '右键菜单已启用' : '右键菜单已关闭', { kind: ok ? 'success' : 'info' });
              });
            }}
          />
        </Card>
        <Card icon={Monitor} title="启动时恢复上次打开位置" desc="下次启动自动打开上次浏览的文件夹与图片">
          <Toggle checked={st.restoreSession} onChange={(v) => set('restoreSession', v)} label="启动时恢复" />
        </Card>
        <Card icon={Palette} title="文件关联" desc="选择拾光可以打开的文件类型；已关联的类型不再在首页重复推荐" vertical>
          <div className="set-assoc-wrap">
            <Button className="btn--px3" onClick={() => setAssocOpen((v) => !v)}>
              {assocOpen ? '收起' : '管理关联'}
            </Button>
            <Button className="btn--px3" onClick={() => void openDefaultApps()}>
              打开 Windows 默认应用
            </Button>
          </div>
          {assocOpen && (
            <div className="set-assoc-more">
              <div className="set-assoc-btns">
                <Button
                  className="btn--px3"
                  onClick={async () => {
                    for (const e of ASSOC_EXTS) await assocSet(e, true);
                    setAssoc(new Set(ASSOC_EXTS));
                  }}
                >
                  全选
                </Button>
                <Button
                  className="btn--px3"
                  onClick={async () => {
                    for (const e of [...assoc]) await assocSet(e, false);
                    setAssoc(new Set());
                  }}
                >
                  取消全选
                </Button>
                <Button
                  className="btn--px3"
                  onClick={async () => {
                    const defaults = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4'];
                    for (const e of ASSOC_EXTS) await assocSet(e, defaults.includes(e));
                    setAssoc(new Set(defaults));
                  }}
                >
                  恢复默认
                </Button>
              </div>
              <div className="set-assoc-grid">
                {ASSOC_EXTS.map((ext) => (
                  <Checkbox
                    key={ext}
                    checked={assoc.has(ext)}
                    onChange={async (v: boolean) => {
                      const ok = await assocSet(ext, v);
                      setAssoc((prev: Set<string>) => {
                        const next = new Set(prev);
                        if (ok && v) next.add(ext);
                        else next.delete(ext);
                        return next;
                      });
                    }}
                  >
                    .{ext} <span className="set-ext">{VIDEO_EXTS.has(ext) ? '视频' : '图片'}</span>
                  </Checkbox>
                ))}
              </div>
              <p className="set-assoc-note">
                出于安全原因，Windows 11 不允许程序自行设为“默认应用”，请在弹出的系统设置页中选择拾光。
              </p>
            </div>
          )}
        </Card>
      </Group>

      <Group title="关于">
        <div className="set-about">
          <AppIcon size={40} />
          <div className="set-about-body">
            <div className="set-about-title">拾光 Lumina 1.0</div>
            <div className="set-about-desc">
              Windows 11 风格 · React + Vite + Tailwind CSS。所有图片仅在本地浏览器中处理，不会上传。
            </div>
          </div>
          <Button variant="standard" onClick={() => setLicenses(true)}>
            <Scale size={14} />
            开源许可
          </Button>
        </div>
      </Group>

      {licenses && <LicensesDialog open onClose={() => setLicenses(false)} />}
    </Dialog>
  );
}
