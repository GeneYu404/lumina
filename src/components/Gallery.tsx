import {
  Copy, ExternalLink, Eye, FileText, FolderOpen, Heart, HeartOff, Images, Info, Printer,
  RotateCcw, RotateCw, Save, Search, Trash2, X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { copyFileName, copyImage, openInNewTab, requestRemove } from '../actions';
import { isDesktop } from '../desktop';
import { useStore, useVisibleImages } from '../store';
import type { ImageItem, Point } from '../types';

import { cn } from '../utils/cn';
import { extOf } from '../utils/format';
import { Menu, type MenuEntry } from './ui/Menu';
import Thumb from './Thumb';

const S = useStore.getState;
const PAGE = 60;

type KindFilter = 'all' | 'image' | 'video';
type TimeFilter = 'all' | 'today' | 'week' | 'month';

const TIME_LABEL: Record<TimeFilter, string> = { all: '全部时间', today: '今天', week: '最近 7 天', month: '最近 30 天' };

const Cell = memo(function Cell({
  item, active, size, cover, onMenu,
}: {
  item: ImageItem; active: boolean; size: number; cover: boolean; onMenu: (id: string, p: Point) => void;
}) {
  return (
    <div
      data-id={item.id}
      role="button"
      tabIndex={0}
      title={item.name}
      onClick={() => { S().goTo(item.id); S().setMode('viewer'); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { S().goTo(item.id); S().setMode('viewer'); } }}
      onContextMenu={(e) => {
        e.preventDefault();
        S().goTo(item.id);
        onMenu(item.id, { x: e.clientX, y: e.clientY });
      }}
      className={cn(
        'group/cell relative aspect-square overflow-hidden rounded-md bg-card outline-offset-2 transition-shadow',
        active ? 'outline-2 outline-accent' : 'hover:shadow-flyout',
      )}
      style={{ contentVisibility: 'auto', containIntrinsicSize: `${size}px ${size}px` }}
    >
      <Thumb item={item} size={size} cover={cover} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-left text-[12px] text-white opacity-0 transition-opacity group-hover/cell:opacity-100">
        <div className="truncate">{item.name}</div>
        {item.width > 0 && (
          <div className="text-[11px] text-white/70">{item.width} × {item.height}</div>
        )}
      </div>
      <button
        type="button"
        aria-label={item.favorite ? '取消收藏' : '收藏'}
        onClick={(e) => { e.stopPropagation(); S().toggleFavorite(item.id); }}
        className={cn(
          'absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-black/35 text-white backdrop-blur transition-opacity hover:bg-black/55',
          item.favorite ? 'opacity-100' : 'opacity-0 group-hover/cell:opacity-100',
        )}
      >
        <Heart size={15} strokeWidth={2} className={item.favorite ? 'fill-[#e81123] text-[#e81123]' : ''} />
      </button>
    </div>
  );
});

export default function Gallery() {
  const all = useVisibleImages();
  const currentId = useStore((s) => s.currentId);
  const size = useStore((s) => s.settings.thumbSize);
  const cover = useStore((s) => s.settings.galleryCover);
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ id: string; p: Point } | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [folder, setFolder] = useState('');
  const [time, setTime] = useState<TimeFilter>('all');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || !currentId) return;
    const t = el.querySelector<HTMLElement>(`[data-id="${currentId}"]`);
    if (t) el.scrollTop = Math.max(0, t.offsetTop - el.clientHeight / 2 + t.offsetHeight / 2);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const folders = useMemo(() => {
    const set = new Set<string>();
    all.forEach((i) => {
      const dir = i.path.includes('/') || i.path.includes('\\') ? i.path.replace(/[\\/][^\\/]*$/, '') : '';
      if (dir) set.add(dir);
    });
    return [...set].sort();
  }, [all]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    const span = time === 'today' ? 86_400_000 : time === 'week' ? 7 * 86_400_000 : time === 'month' ? 30 * 86_400_000 : 0;
    // A folder filter is recursive: "Photos/2024" includes "Photos/2024/August".
    // `i.path` may use either separator; pick whichever the prefix already has.
    const folderPrefix = folder
      ? folder.endsWith('/') || folder.endsWith('\\')
        ? folder
        : (folder.includes('\\') && !folder.includes('/') ? folder + '\\' : folder + '/')
      : '';
    return all.filter((i) => {
      if (kind !== 'all' && i.kind !== kind) return false;
      if (folderPrefix && !i.path.startsWith(folderPrefix) && i.path !== folder) return false;
      if (span && now - i.lastModified > span) return false;
      if (q && !i.name.toLowerCase().includes(q) && !i.path.toLowerCase().includes(q) && !extOf(i.name).includes(q)) return false;
      return true;
    });
  }, [all, query, kind, folder, time]);

  useEffect(() => setPage(0), [query, kind, folder, time, results.length]);

  const imageCount = results.filter((i) => i.kind !== 'video').length;
  const videoCount = results.length - imageCount;
  const last = Math.max(0, Math.ceil(results.length / PAGE) - 1);
  const visible = results.slice(page * PAGE, page * PAGE + PAGE);

  const onMenu = useCallback((id: string, p: Point) => setMenu({ id, p }), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuItem = menu ? all.find((i) => i.id === menu.id) : null;

  const reveal = (it: ImageItem) => {
    if (!isDesktop) return;
    void invoke('reveal_in_folder', { path: it.path }).catch(() => S().toast('无法打开所在文件夹', { kind: 'error' }));
  };

  const items: MenuEntry[] = menuItem
    ? [
        { kind: 'header', label: '文件' },
        { label: '查看', icon: Eye, onSelect: () => S().setMode('viewer') },
        {
          label: menuItem.favorite ? '取消收藏' : '添加到收藏',
          icon: menuItem.favorite ? HeartOff : Heart,
          onSelect: () => S().toggleFavorite(menuItem.id),
        },
        {
          label: '定位到所在文件夹',
          icon: FolderOpen,
          onSelect: () => reveal(menuItem),
          hidden: !isDesktop,
        },
        { label: '复制图片', icon: Copy, shortcut: 'Ctrl+C', onSelect: () => copyImage(menuItem), hidden: menuItem.kind === 'video' },
        { label: '另存为 / 调整大小…', icon: Save, shortcut: 'Ctrl+S', onSelect: () => S().setDialog('saveAs'), hidden: menuItem.kind === 'video' },
        { label: '打印…', icon: Printer, shortcut: 'Ctrl+P', onSelect: () => S().setDialog('print'), hidden: menuItem.kind === 'video' },
        { label: '拼图…', icon: Images, onSelect: () => S().setDialog('collage'), hidden: menuItem.kind === 'video' },
        { label: '在新标签页中打开', icon: ExternalLink, onSelect: () => openInNewTab(menuItem), hidden: isDesktop },
        { label: '复制文件名', icon: FileText, onSelect: () => copyFileName(menuItem) },
        { kind: 'separator', hidden: menuItem.kind === 'video' },
        { kind: 'header', label: '编辑', hidden: menuItem.kind === 'video' },
        { label: '向左旋转', icon: RotateCcw, onSelect: () => S().rotate(menuItem.id, -90), hidden: menuItem.kind === 'video' },
        { label: '向右旋转', icon: RotateCw, onSelect: () => S().rotate(menuItem.id, 90), hidden: menuItem.kind === 'video' },
        { kind: 'separator' },
        { kind: 'header', label: '查看' },
        { label: '文件信息', icon: Info, shortcut: 'I', onSelect: () => S().setPanel('info') },
        { kind: 'separator' },
        { label: '从列表中移除', icon: Trash2, shortcut: 'Delete', danger: true, onSelect: () => requestRemove(menuItem.id) },
      ]
    : [];

  const sections: { key: string; title: string; list: ImageItem[] }[] =
    kind === 'all'
      ? [
          { key: 'img', title: '图片', list: visible.filter((i) => i.kind !== 'video') },
          { key: 'vid', title: '视频', list: visible.filter((i) => i.kind === 'video') },
        ].filter((s) => s.list.length > 0)
      : [{ key: 'one', title: kind === 'video' ? '视频' : '图片', list: visible }];

  return (
    <div ref={ref} className="win-scroll relative h-full overflow-y-auto bg-viewer p-4">
      {/* 搜索与筛选 */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-stroke bg-layer p-2">
        <div className="flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-[5px] border border-stroke bg-card px-2.5 focus-within:border-accent">
          <Search size={15} className="shrink-0 text-fg3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文件名、扩展名或路径…"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg3"
          />
          {query && (
            <button type="button" aria-label="清除搜索" className="rounded p-0.5 text-fg3 hover:bg-subtle" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
        </div>
        <SegmentedLike value={kind} onChange={setKind} />
        <select
          aria-label="文件夹范围"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          className="h-8 max-w-[220px] rounded-[5px] border border-stroke bg-card px-2 text-[13px] text-fg outline-none"
        >
          <option value="">全部文件夹</option>
          {folders.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select
          aria-label="时间范围"
          value={time}
          onChange={(e) => setTime(e.target.value as TimeFilter)}
          className="h-8 rounded-[5px] border border-stroke bg-card px-2 text-[13px] text-fg outline-none"
        >
          {(Object.keys(TIME_LABEL) as TimeFilter[]).map((t) => (
            <option key={t} value={t}>{TIME_LABEL[t]}</option>
          ))}
        </select>
      </div>

      {results.length === 0 ? (
        <div className="flex h-[60%] flex-col items-center justify-center gap-3 text-center text-fg2">
          <Search size={40} strokeWidth={1.2} />
          <div className="text-base font-medium text-fg">没有匹配的文件</div>
          <div className="text-xs">换个关键词，或放宽文件夹 / 时间筛选。</div>
        </div>
      ) : (
        sections.map((sec) => (
          <div key={sec.key} className="mb-5">
            <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg2">
              {sec.title}
              <span className="text-xs font-normal text-fg3">
                {sec.key === 'img' ? imageCount : sec.key === 'vid' ? videoCount : results.length} 项
              </span>
            </h3>
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
              {sec.list.map((it) => (
                <Cell key={it.id} item={it} active={it.id === currentId} size={size} cover={cover} onMenu={onMenu} />
              ))}
            </div>
          </div>
        ))
      )}

      {last > 0 && (
        <div className="flex items-center justify-center gap-3 pb-2 text-xs text-fg2">
          <button type="button" disabled={page <= 0} onClick={() => setPage(page - 1)} className="rounded-md border border-stroke bg-card px-3 py-1 hover:bg-card-hover disabled:opacity-40">
            上一页
          </button>
          <span className="tabular-nums">{page + 1} / {last + 1}</span>
          <button type="button" disabled={page >= last} onClick={() => setPage(page + 1)} className="rounded-md border border-stroke bg-card px-3 py-1 hover:bg-card-hover disabled:opacity-40">
            下一页
          </button>
        </div>
      )}
      <Menu open={!!menu} point={menu?.p ?? null} onClose={closeMenu} items={items} />
    </div>
  );
}

function SegmentedLike({ value, onChange }: { value: KindFilter; onChange: (v: KindFilter) => void }) {
  const opts: { value: KindFilter; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'image', label: '仅图片' },
    { value: 'video', label: '仅视频' },
  ];
  return (
    <div className="inline-flex shrink-0 rounded-md border border-stroke bg-card p-0.5">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 whitespace-nowrap rounded-[4px] px-3 text-[13px] transition-colors',
            o.value === value ? 'bg-accent text-on-accent' : 'text-fg hover:bg-subtle',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
