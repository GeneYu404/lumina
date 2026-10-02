import {
  Copy, ExternalLink, Eye, FileText, FolderOpen, Heart, HeartOff, Images, Info, Printer,
  RotateCcw, RotateCw, Save, Search, Trash2, X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { copyFileName, copyImage, openInNewTab, requestRemove } from '../actions';
import { isDesktop } from '../desktop';
import { useStore, useVisibleImages } from '../store';
import type { GalleryFilter, GalleryKind, GalleryTime, ImageItem, Point } from '../types';

import { cn } from '../utils/cn';
import { extOf } from '../utils/format';
import { Menu, type MenuEntry } from './ui/Menu';
import Thumb from './Thumb';

const S = useStore.getState;
const PAGE = 60;

const TIME_LABEL: Record<GalleryTime, string> = { all: '全部时间', today: '今天', week: '最近 7 天', month: '最近 30 天' };

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
      className={cn('cell', active ? 'cell--active' : 'cell--off')}
      style={{ contentVisibility: 'auto', containIntrinsicSize: `${size}px ${size}px` }}
    >
      <Thumb item={item} size={size} cover={cover} />
      <div className="cell-label">
        <div className="u-truncate">{item.name}</div>
        {item.width > 0 && (
          <div className="cell-dims">{item.width} × {item.height}</div>
        )}
      </div>
      <button
        type="button"
        aria-label={item.favorite ? '取消收藏' : '收藏'}
        onClick={(e) => { e.stopPropagation(); S().toggleFavorite(item.id); }}
        className={cn('cell-fav', item.favorite ? 'cell-fav--on' : 'cell-fav--off')}
      >
        <Heart size={15} strokeWidth={2} className={item.favorite ? 'fav-on' : ''} />
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
  // Filters live in the store: the gallery unmounts while an item is open in
  // the viewer, so component state would lose the user's filtering on return.
  const galleryFilter = useStore((s) => s.galleryFilter);
  const { query, kind, folder, time } = galleryFilter;

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

  // Page is local (a transient view choice) but lands on the page holding the
  // current item — returning from the viewer resumes where the user left off
  // instead of jumping to page one.
  const [page, setPage] = useState(() => {
    const idx = currentId ? results.findIndex((i) => i.id === currentId) : -1;
    return idx >= 0 ? Math.floor(idx / PAGE) : 0;
  });
  const setFilter = (patch: Partial<GalleryFilter>) => {
    setPage(0); // a new filter starts back at the first page
    S().setGalleryFilter(patch);
  };

  const imageCount = results.filter((i) => i.kind !== 'video').length;
  const videoCount = results.length - imageCount;
  const last = Math.max(0, Math.ceil(results.length / PAGE) - 1);
  // Items can disappear while away (deletes, replaced folders): clamp instead
  // of leaving an empty page on screen.
  const shownPage = Math.min(page, last);
  const visible = results.slice(shownPage * PAGE, shownPage * PAGE + PAGE);

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
    <div ref={ref} className="gallery win-scroll">
      {/* 搜索与筛选 */}
      <div className="gallery-bar">
        <div className="gallery-search">
          <Search size={15} className="u-shrink-0 u-fg3" />
          <input
            value={query}
            onChange={(e) => setFilter({ query: e.target.value })}
            placeholder="搜索文件名、扩展名或路径…"
            className="gallery-search-input"
          />
          {query && (
            <button type="button" aria-label="清除搜索" className="gallery-clear" onClick={() => setFilter({ query: '' })}>
              <X size={13} />
            </button>
          )}
        </div>
        <SegmentedLike value={kind} onChange={(v) => setFilter({ kind: v })} />
        <select
          aria-label="文件夹范围"
          value={folder}
          onChange={(e) => setFilter({ folder: e.target.value })}
          className="gallery-select gallery-select--w"
        >
          <option value="">全部文件夹</option>
          {folders.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
          {/* Keep a persisted folder selectable even when the current item set
              no longer contains it, so the select doesn't render blank. */}
          {folder && !folders.includes(folder) && <option value={folder}>{folder}</option>}
        </select>
        <select
          aria-label="时间范围"
          value={time}
          onChange={(e) => setFilter({ time: e.target.value as GalleryTime })}
          className="gallery-select"
        >
          {(Object.keys(TIME_LABEL) as GalleryTime[]).map((t) => (
            <option key={t} value={t}>{TIME_LABEL[t]}</option>
          ))}
        </select>
      </div>

      {results.length === 0 ? (
        <div className="gallery-empty">
          <Search size={40} strokeWidth={1.2} />
          <div className="gallery-empty-title">没有匹配的文件</div>
          <div className="gallery-empty-desc">换个关键词，或放宽文件夹 / 时间筛选。</div>
          {(query || kind !== 'all' || folder || time !== 'all') && (
            <button
              type="button"
              onClick={() => setFilter({ query: '', kind: 'all', folder: '', time: 'all' })}
              className="gallery-empty-btn"
            >
              清除全部筛选
            </button>
          )}
        </div>
      ) : (
        sections.map((sec) => (
          <div key={sec.key} className="gallery-section">
            <h3 className="gallery-section-title">
              {sec.title}
              <span className="gallery-section-count">
                {sec.key === 'img' ? imageCount : sec.key === 'vid' ? videoCount : results.length} 项
              </span>
            </h3>
            <div className="gallery-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
              {sec.list.map((it) => (
                <Cell key={it.id} item={it} active={it.id === currentId} size={size} cover={cover} onMenu={onMenu} />
              ))}
            </div>
          </div>
        ))
      )}

      {last > 0 && (
        <div className="gallery-pager">
          <button type="button" disabled={shownPage <= 0} onClick={() => setPage(shownPage - 1)} className="pager-btn">
            上一页
          </button>
          <span className="u-tabular">{shownPage + 1} / {last + 1}</span>
          <button type="button" disabled={shownPage >= last} onClick={() => setPage(shownPage + 1)} className="pager-btn">
            下一页
          </button>
        </div>
      )}
      <Menu open={!!menu} point={menu?.p ?? null} onClose={closeMenu} items={items} />
    </div>
  );
}

function SegmentedLike({ value, onChange }: { value: GalleryKind; onChange: (v: GalleryKind) => void }) {
  const opts: { value: GalleryKind; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'image', label: '仅图片' },
    { value: 'video', label: '仅视频' },
  ];
  return (
    <div className="segmented">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn('seg-item', o.value === value ? 'seg-item--on' : 'seg-item--off')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
