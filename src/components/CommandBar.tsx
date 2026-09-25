import {
  ArrowUpDown,
  ChevronDown,
  ClipboardPaste,
  Crop,
  Ellipsis,
  Film,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  FolderPlus,
  Heart,
  ImagePlus,
  Info,
  Keyboard,
  LayoutGrid,
  Map as MapIcon,
  Maximize,
  Play,
  RotateCcw,
  RotateCw,
  Scan,
  Settings,
  Shrink,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  loadSamples,
  openFiles,
  openFolder,
  pasteFromClipboard,

  requestRemove,
  startCrop,
  startSlideshow,
  toggleImmersive,
} from '../actions';
import { useCurrent, useStore } from '../store';
import { cn } from '../utils/cn';
import type { SortKey, ViewerBg } from '../types';
import { Sep, ToolButton } from './ui/Button';
import { Segmented } from './ui/Controls';
import { Menu, useMenuState, type MenuEntry } from './ui/Menu';

const S = useStore.getState;

const SORT_LABEL: Record<SortKey, string> = {
  name: '名称',
  date: '修改日期',
  size: '文件大小',
  type: '文件类型',
  added: '添加顺序',
};

const BG_LABEL: Record<ViewerBg, string> = {
  theme: '跟随主题',
  black: '黑色',
  white: '白色',
  checker: '透明棋盘格',
  ambient: '氛围模糊',
};

export default function CommandBar() {
  const hasImages = useStore((s) => s.images.length > 0);
  const mode = useStore((s) => s.mode);
  const panel = useStore((s) => s.panel);
  const fit = useStore((s) => s.view.fit);
  const sortKey = useStore((s) => s.sortKey);
  const sortDir = useStore((s) => s.sortDir);
  const filter = useStore((s) => s.filter);
  const settings = useStore((s) => s.settings);
  const item = useCurrent();
  const isVideo = !!item && item.kind === 'video';

  const openMenu = useMenuState();
  const moreMenu = useMenuState();
  const flipMenu = useMenuState();
  const sortMenu = useMenuState();

  const openItems: MenuEntry[] = [
    { label: '打开文件…', icon: ImagePlus, shortcut: 'Ctrl+O', onSelect: () => openFiles(true) },
    { label: '打开文件夹…', icon: FolderOpen, shortcut: 'Ctrl+Shift+O', onSelect: () => openFolder(true) },
    { label: '添加到当前列表…', icon: FolderPlus, onSelect: () => openFiles(false), hidden: !hasImages },
    { label: '从剪贴板粘贴', icon: ClipboardPaste, shortcut: 'Ctrl+V', onSelect: () => pasteFromClipboard() },
    { kind: 'separator' },
    { label: '加载示例图片', icon: Sparkles, onSelect: () => loadSamples() },
    { kind: 'separator', hidden: !hasImages },
    { label: '关闭全部', icon: X, onSelect: () => S().setDialog('closeAll'), hidden: !hasImages },
  ];

  const moreItems: MenuEntry[] = [
    {
      label: '显示胶片栏',
      icon: Film,
      shortcut: 'T',
      checked: settings.showFilmstrip,
      onSelect: () => S().setSetting('showFilmstrip', !settings.showFilmstrip),
      hidden: !hasImages,
    },
    {
      label: '显示导航小地图',
      icon: MapIcon,
      shortcut: 'M',
      checked: settings.showMinimap,
      onSelect: () => S().setSetting('showMinimap', !settings.showMinimap),
      hidden: !hasImages,
    },
    { kind: 'header', label: '查看器背景', hidden: !hasImages },
    ...(Object.keys(BG_LABEL) as ViewerBg[]).map(
      (k): MenuEntry => ({
        label: BG_LABEL[k],
        checked: settings.viewerBg === k,
        onSelect: () => S().setSetting('viewerBg', k),
        hidden: !hasImages,
      }),
    ),
    { kind: 'separator', hidden: !hasImages },
    { label: '键盘快捷键', icon: Keyboard, shortcut: '?', onSelect: () => S().setDialog('shortcuts') },
    { label: '设置', icon: Settings, shortcut: 'Ctrl+,', onSelect: () => S().setDialog('settings') },
  ];

  const sortItems: MenuEntry[] = [
    { kind: 'header', label: '排序依据' },
    ...(Object.keys(SORT_LABEL) as SortKey[]).map(
      (k): MenuEntry => ({ label: SORT_LABEL[k], checked: sortKey === k, onSelect: () => S().setSort(k) }),
    ),
    { kind: 'separator' },
    { label: '升序', checked: sortDir === 'asc', onSelect: () => S().setSort(sortKey, 'asc') },
    { label: '降序', checked: sortDir === 'desc', onSelect: () => S().setSort(sortKey, 'desc') },
  ];

  return (
    <div className="relative z-20 flex h-12 shrink-0 items-center gap-1 px-2">
      <div className="flex shrink-0 items-center gap-1">
        {/* On the welcome screen its big buttons already do this: no duplicate here. */}
        {hasImages && (
        <ToolButton
          icon={FolderOpen}
          label="打开"
          shortcut="Ctrl+O"
          showLabel="sm"
          tipAlign="start"
          trailing={<ChevronDown size={14} className="text-fg2" />}
          onClick={(e) => openMenu.toggle(e.currentTarget)}
          active={openMenu.open}
        />
        )}
        {hasImages && (
          <ToolButton
            icon={LayoutGrid}
            label="图库"
            shortcut="G"
            showLabel="lg"
            active={mode === 'gallery'}
            onClick={() => S().setMode(mode === 'gallery' ? 'viewer' : 'gallery')}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5 max-sm:justify-start max-sm:overflow-x-auto max-sm:[scrollbar-width:none]">
        {hasImages && mode === 'viewer' && item && (
          <>
            {!isVideo && (
            <>
            <ToolButton icon={ZoomIn} label="放大" shortcut="Ctrl + +" className="hidden sm:inline-flex" onClick={() => S().zoomStep(1)} />
            <ToolButton icon={ZoomOut} label="缩小" shortcut="Ctrl + -" className="hidden sm:inline-flex" onClick={() => S().zoomStep(-1)} />
            <ToolButton
              icon={fit ? Scan : Shrink}
              label={fit ? '实际大小' : '适应窗口'}
              shortcut={fit ? '1' : '0'}
              className="hidden sm:inline-flex"
              onClick={() => (fit ? S().actualSize() : S().fitToWindow())}
            />
            <Sep className="hidden sm:block" />
            <ToolButton icon={RotateCcw} label="向左旋转" shortcut="Shift+R" onClick={() => S().rotate(item.id, -90)} />
            <ToolButton icon={RotateCw} label="向右旋转" shortcut="R" onClick={() => S().rotate(item.id, 90)} />
            <ToolButton
              icon={FlipHorizontal2}
              label="翻转"
              className="hidden sm:inline-flex"
              active={flipMenu.open}
              onClick={(e) => flipMenu.toggle(e.currentTarget)}
            />
            <Sep className="hidden md:block" />
            <ToolButton icon={Crop} label="裁剪" shortcut="C" className="hidden md:inline-flex" onClick={startCrop} />
            <ToolButton
              icon={SlidersHorizontal}
              label="编辑与调整"
              shortcut="E"
              className="hidden md:inline-flex"
              active={panel === 'edit'}
              onClick={() => S().togglePanel('edit')}
            />
            </>
            )}
            <Sep className={cn(isVideo && 'hidden')} />
            <ToolButton
              icon={Heart}
              label={item.favorite ? '取消收藏' : '收藏'}
              shortcut="Ctrl+D"
              iconClassName={item.favorite ? 'fill-[#e81123] text-[#e81123]' : ''}
              onClick={() => S().toggleFavorite(item.id)}
            />
            <ToolButton icon={Trash2} label="从列表中移除" shortcut="Delete" onClick={() => requestRemove()} />
            <Sep />
            <ToolButton icon={Info} label="文件信息" shortcut="I" active={panel === 'info'} onClick={() => S().togglePanel('info')} />
          </>
        )}
        {hasImages && mode === 'gallery' && (
          <>
            <ToolButton
              icon={ArrowUpDown}
              label={`排序：${SORT_LABEL[sortKey]}`}
              showLabel="always"
              noTip
              trailing={<ChevronDown size={14} className="text-fg2" />}
              active={sortMenu.open}
              onClick={(e) => sortMenu.toggle(e.currentTarget)}
            />
            <Sep />
            <Segmented
              value={filter}
              options={[
                { value: 'all', label: '全部' },
                { value: 'favorites', label: '收藏', icon: Heart },
              ]}
              onChange={(f) => S().setFilter(f)}
            />
            <Sep className="hidden sm:block" />
            <ToolButton icon={Info} label="文件信息" shortcut="I" className="hidden sm:inline-flex" active={panel === 'info'} onClick={() => S().togglePanel('info')} />
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {hasImages && (
          <ToolButton icon={Play} label="幻灯片放映" shortcut="F5" showLabel="lg" tipAlign="end" onClick={startSlideshow} />
        )}
        {hasImages && mode === 'viewer' && (
          <ToolButton icon={Maximize} label="全屏" shortcut="F11" tipAlign="end" className="hidden sm:inline-flex" onClick={toggleImmersive} />
        )}
        <ToolButton icon={Ellipsis} label="更多选项" tipAlign="end" active={moreMenu.open} onClick={(e) => moreMenu.toggle(e.currentTarget)} />
      </div>

      <Menu open={openMenu.open} anchor={openMenu.anchor} onClose={openMenu.close} items={openItems} />
      <Menu open={moreMenu.open} anchor={moreMenu.anchor} onClose={moreMenu.close} items={moreItems} align="end" minWidth={260} />
      <Menu open={sortMenu.open} anchor={sortMenu.anchor} onClose={sortMenu.close} items={sortItems} minWidth={200} />
      {item && (
        <Menu
          open={flipMenu.open}
          anchor={flipMenu.anchor}
          onClose={flipMenu.close}
          minWidth={200}
          items={[
            { label: '水平翻转', icon: FlipHorizontal2, shortcut: 'H', onSelect: () => S().flip(item.id, 'h') },
            { label: '垂直翻转', icon: FlipVertical2, shortcut: 'V', onSelect: () => S().flip(item.id, 'v') },
          ]}
        />
      )}
    </div>
  );
}
