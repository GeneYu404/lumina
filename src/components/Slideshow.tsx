import { Minimize, Pause, Play, Shuffle, SkipBack, SkipForward, X, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { stopSlideshow } from '../actions';
import { getVisible, useStore, useVisibleImages } from '../store';
import type { ImageItem, SlideTransition } from '../types';
import { cn } from '../utils/cn';
import { blurNatural, cssFilter, temperatureColor, vignetteGradient, visualSize } from '../utils/image';
import { readOrientationIfFile } from '../utils/orientation';

const S = useStore.getState;

function Slide({
  item,
  vp,
  transition,
  animate,
  upscale,
}: {
  item: ImageItem;
  vp: { w: number; h: number };
  transition: SlideTransition;
  animate: boolean;
  upscale: boolean;
}) {
  const anim = animate
    ? { fade: 'pv-slide-fade', slide: 'pv-slide-slide', zoom: 'pv-slide-zoom', none: '' }[transition]
    : '';
  const style = anim ? { animation: `${anim} .8s cubic-bezier(.2,.7,.2,1) both` } : undefined;
  if (item.kind === 'video') {
    return (
      <div className="absolute inset-0 flex items-center justify-center" style={style}>
        <video
          key={item.url}
          src={item.url}
          autoPlay
          muted
          playsInline
          className="max-h-full max-w-full"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      </div>
    );
  }
  if (!item.width || !item.height) {
    return (
      <div className="absolute inset-0" style={style}>
        <img
          src={item.url}
          alt=""
          draggable={false}
          className="absolute inset-0 m-auto max-h-full max-w-full"
          style={{ imageOrientation: 'none' }}
          onLoad={(e) => {
            const im = e.currentTarget;
            if (item.width) return;
            // File objects carry no EXIF-derived dimensions; `naturalWidth` is
            // the physical pixel count, so we have to swap it for EXIF 5–8.
            const file = item.file;
            const w = im.naturalWidth || 1024;
            const h = im.naturalHeight || 1024;
            if (file) {
              void readOrientationIfFile(file).then((rot) => {
                const swap = (rot ?? 1) >= 5;
                S().setMeta(item.id, {
                  width: swap ? h : w,
                  height: swap ? w : h,
                  origWidth: swap ? h : w,
                  origHeight: swap ? w : h,
                });
              });
            } else {
              S().setMeta(item.id, { width: w, height: h, origWidth: w, origHeight: h });
            }
          }}
        />
      </div>
    );
  }
  const { w: ew, h: eh } = visualSize(item);
  const fit = Math.min(vp.w / ew, vp.h / eh);
  const scale = upscale ? fit : Math.min(1, fit);
  const dw = item.width * scale;
  const dh = item.height * scale;
  const tc = temperatureColor(item.adjust.temperature);
  const vg = vignetteGradient(item.adjust.vignette);
  return (
    <div className="absolute inset-0" style={style}>
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: dw,
          height: dh,
          marginLeft: -dw / 2,
          marginTop: -dh / 2,
          transform: `rotate(${item.rotation}deg) scale(${item.flipH ? -1 : 1}, ${item.flipV ? -1 : 1})`,
          isolation: 'isolate',
        }}
      >
        <img
          src={item.url}
          alt={item.name}
          draggable={false}
          className="h-full w-full max-w-none"
          style={{ filter: cssFilter(item.adjust, blurNatural(item.adjust, item.width, item.height) * scale) }}
        />
        {tc && <div className="absolute inset-0" style={{ background: tc, mixBlendMode: 'soft-light' }} />}
        {vg && <div className="absolute inset-0" style={{ background: vg }} />}
      </div>
    </div>
  );
}

function SlideBtn({
  icon: Icon,
  label,
  onClick,
  active,
  big,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  big?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15 active:bg-white/10',
        big ? 'h-11 w-11 bg-white/10' : 'h-9 w-9',
        active && 'bg-white/20 text-accent',
      )}
    >
      <Icon size={big ? 22 : 18} strokeWidth={1.7} className={big ? 'fill-current' : ''} />
    </button>
  );
}

export default function Slideshow() {
  const list = useVisibleImages();
  const images = useStore((s) => s.images);
  const currentId = useStore((s) => s.currentId);
  const settings = useStore((s) => s.settings);
  const [playing, setPlaying] = useState(true);
  const [showUi, setShowUi] = useState(true);
  const [layers, setLayers] = useState<{ id: string; key: number }[]>(() => (currentId ? [{ id: currentId, key: 0 }] : []));
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const hideTimer = useRef<number | undefined>(undefined);
  const keySeq = useRef(1);

  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  useEffect(() => {
    if (!currentId) return;
    setLayers((ls) =>
      ls.length && ls[ls.length - 1].id === currentId ? ls : [...ls.slice(-1), { id: currentId, key: keySeq.current++ }],
    );
  }, [currentId]);

  useEffect(() => {
    if (layers.length < 2) return;
    const t = window.setTimeout(() => setLayers((ls) => ls.slice(-1)), 900);
    return () => window.clearTimeout(t);
  }, [layers]);

  const next = useCallback(() => {
    const s = S();
    const l = getVisible(s);
    if (l.length < 2) return;
    const ci = l.findIndex((i) => i.id === s.currentId);
    if (s.settings.slideShuffle) {
      let r = Math.floor(Math.random() * (l.length - 1));
      if (r >= ci) r++;
      s.goTo(l[r].id);
    } else {
      s.goTo(l[(ci + 1) % l.length].id);
    }
  }, []);

  const prev = useCallback(() => {
    const s = S();
    const l = getVisible(s);
    if (l.length < 2) return;
    const ci = l.findIndex((i) => i.id === s.currentId);
    s.goTo(l[(ci - 1 + l.length) % l.length].id);
  }, []);

  useEffect(() => {
    if (!playing || list.length < 2) return;
    const t = window.setTimeout(next, settings.slideInterval * 1000);
    return () => window.clearTimeout(t);
  }, [playing, currentId, settings.slideInterval, list.length, next]);

  const poke = useCallback(() => {
    setShowUi(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShowUi(false), 2600);
  }, []);

  useEffect(() => {
    poke();
    window.addEventListener('mousemove', poke);
    window.addEventListener('pointerdown', poke);
    return () => {
      window.removeEventListener('mousemove', poke);
      window.removeEventListener('pointerdown', poke);
      window.clearTimeout(hideTimer.current);
    };
  }, [poke]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (S().dialog) return;
      switch (e.key) {
        case 'Escape':
        case 'F5':
          e.preventDefault();
          stopSlideshow();
          break;
        case ' ':
          e.preventDefault();
          setPlaying((p) => !p);
          poke();
          break;
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault();
          next();
          poke();
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          prev();
          poke();
          break;
        default:
          return;
      }
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, prev, poke]);

  const cur = currentId ? images.find((i) => i.id === currentId) : null;
  const idx = list.findIndex((i) => i.id === currentId);

  return createPortal(
    <div className={cn('fixed inset-0 z-[800] select-none overflow-hidden bg-black text-white', !showUi && 'cursor-none')}>
      {layers.map((l, i) => {
        const it = images.find((x) => x.id === l.id);
        if (!it) return null;
        return (
          <Slide
            key={l.key}
            item={it}
            vp={vp}
            transition={settings.slideTransition}
            animate={i === layers.length - 1 && layers.length > 1}
            upscale={settings.upscaleSmall}
          />
        );
      })}

      {playing && list.length > 1 && (
        <div className="absolute inset-x-0 top-0 h-[3px] bg-white/10">
          <div
            key={`${currentId}-${settings.slideInterval}`}
            className="h-full bg-accent"
            style={{ animation: `pv-progress ${settings.slideInterval}s linear forwards` }}
          />
        </div>
      )}

      <div
        className={cn(
          'absolute inset-x-0 top-0 flex items-start justify-between bg-linear-to-b from-black/60 to-transparent px-5 pb-10 pt-5 transition-opacity duration-300',
          showUi ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{cur?.name}</div>
          <div className="text-xs text-white/60">
            {idx + 1} / {list.length}
            {playing ? ` · 每 ${settings.slideInterval} 秒切换` : ' · 已暂停'}
          </div>
        </div>
        <button type="button" aria-label="退出放映" onClick={stopSlideshow} className="rounded-md p-2 hover:bg-white/10">
          <X size={20} />
        </button>
      </div>

      <div
        className={cn(
          'absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-black/55 p-1.5 shadow-2xl backdrop-blur-xl transition-all duration-300',
          showUi ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
        )}
      >
        <SlideBtn icon={SkipBack} label="上一张 (←)" onClick={prev} />
        <SlideBtn icon={playing ? Pause : Play} label={playing ? '暂停 (空格)' : '播放 (空格)'} onClick={() => setPlaying((p) => !p)} big />
        <SlideBtn icon={SkipForward} label="下一张 (→)" onClick={next} />
        <div className="mx-1 h-6 w-px bg-white/15" />
        <select
          aria-label="切换间隔"
          value={settings.slideInterval}
          onChange={(e) => S().setSetting('slideInterval', Number(e.target.value))}
          className="h-9 rounded-md bg-transparent px-2 text-sm text-white outline-none hover:bg-white/10 [&>option]:text-black"
        >
          {[2, 3, 4, 5, 8, 10, 15, 30].map((n) => (
            <option key={n} value={n}>
              {n} 秒
            </option>
          ))}
        </select>
        <select
          aria-label="过渡效果"
          value={settings.slideTransition}
          onChange={(e) => S().setSetting('slideTransition', e.target.value as SlideTransition)}
          className="h-9 rounded-md bg-transparent px-2 text-sm text-white outline-none hover:bg-white/10 [&>option]:text-black"
        >
          <option value="fade">淡入淡出</option>
          <option value="slide">滑动</option>
          <option value="zoom">缩放</option>
          <option value="none">无</option>
        </select>
        <SlideBtn
          icon={Shuffle}
          label="随机播放"
          active={settings.slideShuffle}
          onClick={() => S().setSetting('slideShuffle', !settings.slideShuffle)}
        />
        <div className="mx-1 h-6 w-px bg-white/15" />
        <SlideBtn icon={Minimize} label="退出放映 (Esc)" onClick={stopSlideshow} />
      </div>
    </div>,
    document.body,
  );
}
