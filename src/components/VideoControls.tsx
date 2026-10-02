import {
  Captions,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  TriangleAlert,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { exitImmersive, openInSystemPlayer, toggleImmersive, toggleVideoMute, toggleVideoPlay } from '../actions';
import { useStore } from '../store';
import type { ImageItem, SubtitleFile } from '../types';
import { cn } from '../utils/cn';
import { clamp, formatDuration } from '../utils/format';

const S = useStore.getState;
const RATES = [1, 1.25, 1.5, 2, 0.5, 0.75];

/** Codecs WebView2's own pipeline decodes. Anything else — AC-3, DTS,
 *  TrueHD… — plays video silently: Chromium never hands demuxed audio to
 *  Media Foundation, and the GPU decoders only do video. */
const PLAYABLE_AUDIO = ['AAC', 'MP3', 'OPUS', 'VORBIS', 'FLAC', 'PCM'];

const fmt = (s: number) => (Number.isFinite(s) && s > 0 ? formatDuration(s) : '0:00');

function CtrlBtn({
  label,
  onClick,
  active,
  children,
  wide,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn('vbtn', wide && 'vbtn--wide', active && 'vbtn--active')}
    >
      {children}
    </button>
  );
}

/**
 * The video player's own controls (replacing the browser's): seek bar with
 * hover preview, transport, volume, speed, subtitles and full screen. The bar
 * fades out while playing until the mouse moves or playback pauses.
 */
export default function VideoControls({
  videoRef,
  item,
  total,
  subtitle,
  audioCodec,
  immersive,
  onImportSubtitle,
  onClearSubtitle,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  item: ImageItem;
  total: number;
  subtitle: SubtitleFile | null;
  audioCodec: string | null;
  immersive: boolean;
  onImportSubtitle: () => void;
  onClearSubtitle: () => void;
}) {
  const [media, setMedia] = useState({
    playing: false,
    current: 0,
    duration: 0,
    buffered: 0,
    volume: 1,
    muted: false,
    rate: 1,
  });
  const [visible, setVisible] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const playingRef = useRef(false);
  const hoverBar = useRef(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const warned = useRef('');

  const poke = () => {
    setVisible(true);
    window.clearTimeout(hideTimer.current);
    // While paused (or hovered) the bar stays until playback resumes.
    if (!playingRef.current || hoverBar.current) return;
    hideTimer.current = window.setTimeout(() => setVisible(false), 2600);
  };

  /* follow the element: playback position/state + persistent preferences */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => {
      let buffered = 0;
      try {
        for (let i = 0; i < v.buffered.length; i++) {
          if (v.buffered.start(i) <= v.currentTime + 0.5) buffered = Math.max(buffered, v.buffered.end(i));
        }
      } catch {
        buffered = 0;
      }
      playingRef.current = !v.paused && !v.ended;
      setMedia({
        playing: playingRef.current,
        current: v.currentTime || 0,
        duration: Number.isFinite(v.duration) ? v.duration : 0,
        buffered,
        volume: v.volume,
        muted: v.muted,
        rate: v.playbackRate,
      });
    };
    const onState = () => {
      sync();
      poke();
    };
    const syncEvents = ['timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'volumechange', 'ratechange', 'seeked'];
    const stateEvents = ['play', 'pause', 'ended'];
    syncEvents.forEach((e) => v.addEventListener(e, sync));
    stateEvents.forEach((e) => v.addEventListener(e, onState));
    window.addEventListener('mousemove', poke);
    sync();
    return () => {
      syncEvents.forEach((e) => v.removeEventListener(e, sync));
      stateEvents.forEach((e) => v.removeEventListener(e, onState));
      window.removeEventListener('mousemove', poke);
      window.clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* unsupported-audio warning: once per file, with an escape hatch */
  const audioUp = (audioCodec ?? '').toUpperCase();
  const codecOk = !audioCodec || PLAYABLE_AUDIO.some((p) => audioUp.includes(p));
  const warn = !!audioCodec && !codecOk;

  useEffect(() => {
    if (!warn) return;
    const key = `${item.id}:${audioCodec}`;
    if (warned.current === key) return;
    warned.current = key;
    S().toast(`此视频的音频编码（${audioCodec}）不受支持，播放将没有声音`, {
      actionLabel: '用系统播放器打开',
      action: () => openInSystemPlayer(item.path),
      duration: 10000,
    });
  }, [warn, audioCodec, item.id, item.path]);

  const dur = media.duration;
  const playedPct = dur > 0 ? clamp(media.current / dur, 0, 1) * 100 : 0;
  const bufferedPct = dur > 0 ? clamp(media.buffered / dur, 0, 1) * 100 : 0;
  const vol = media.muted ? 0 : media.volume;

  const ratioAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return clamp((clientX - r.left) / (r.width || 1), 0, 1);
  };
  const seekTo = (ratio: number) => {
    const v = videoRef.current;
    if (!v || dur <= 0) return;
    const t = ratio * dur;
    v.currentTime = t;
    setMedia((m) => ({ ...m, current: t }));
  };
  const setVolume = (x: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = x;
    if (x > 0 && v.muted) v.muted = false;
    S().setSetting('videoVolume', x);
  };
  const cycleRate = () => {
    const v = videoRef.current;
    if (!v) return;
    const i = RATES.findIndex((r) => Math.abs(r - media.rate) < 0.01);
    const next = RATES[(i + 1) % RATES.length];
    v.playbackRate = next;
    S().setSetting('videoRate', next);
  };

  return (
    <div
      data-no-pan
      onMouseEnter={() => {
        hoverBar.current = true;
        window.clearTimeout(hideTimer.current);
      }}
      onMouseLeave={() => {
        hoverBar.current = false;
        poke();
      }}
      className={cn('vbar', visible ? 'vbar--on' : 'vbar--off')}
    >
      {warn && (
        <div className="vbar-warn">
          <TriangleAlert size={13} className="u-shrink-0" />
          <span className="u-truncate">音频编码 {audioCodec} 不受 WebView2 支持 · 播放将无声</span>
          <button
            type="button"
            onClick={() => openInSystemPlayer(item.path)}
            className="vbar-warn-btn"
          >
            用系统播放器打开
          </button>
        </div>
      )}

      {/* seek bar: click / drag to jump, hover shows the target time */}
      <div
        ref={trackRef}
        className="seek"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          const r = ratioAt(e.clientX);
          setHover(r);
          seekTo(r);
        }}
        onPointerMove={(e) => {
          const r = ratioAt(e.clientX);
          if (dragging.current) {
            setHover(r);
            seekTo(r);
          } else {
            setHover(r);
          }
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onPointerLeave={() => {
          if (!dragging.current) setHover(null);
        }}
      >
        <div className="seek-track">
          <div className="seek-buffer" style={{ width: `${bufferedPct}%` }} />
          <div className="seek-play" style={{ width: `${playedPct}%` }} />
          <div className="seek-knob" style={{ left: `${playedPct}%` }} />
        </div>
        {hover !== null && dur > 0 && (
          <div
            className="seek-tip"
            style={{ left: `${clamp(hover, 0.05, 0.95) * 100}%` }}
          >
            {fmt(hover * dur)}
          </div>
        )}
      </div>

      {/* buttons */}
      <div className="vbar-btns">
        {total > 1 && (
          <CtrlBtn label="上一个文件 (←)" onClick={() => S().step(-1)}>
            <ChevronLeft size={18} strokeWidth={1.8} />
          </CtrlBtn>
        )}
        <CtrlBtn label={media.playing ? '暂停 (Space / K)' : '播放 (Space / K)'} onClick={toggleVideoPlay}>
          {media.playing ? <Pause size={19} strokeWidth={1.8} /> : <Play size={19} strokeWidth={1.8} />}
        </CtrlBtn>
        {total > 1 && (
          <CtrlBtn label="下一个文件 (→)" onClick={() => S().step(1)}>
            <ChevronRight size={18} strokeWidth={1.8} />
          </CtrlBtn>
        )}
        <span className="vbar-time">
          {fmt(media.current)} / {fmt(dur)}
        </span>

        <div className="vbar-gap" />

        <CtrlBtn label={media.muted ? '取消静音 (M)' : '静音 (M)'} onClick={toggleVideoMute}>
          {vol === 0 || media.muted ? (
            <VolumeX size={17} strokeWidth={1.8} />
          ) : media.volume < 0.5 ? (
            <Volume1 size={17} strokeWidth={1.8} />
          ) : (
            <Volume2 size={17} strokeWidth={1.8} />
          )}
        </CtrlBtn>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={vol}
          aria-label="音量"
          title="音量"
          onChange={(e) => setVolume(Number(e.target.value))}
          // Release focus so Space/J/K/L return to the global key handler
          // instead of being swallowed by the focused range input.
          onPointerUp={(e) => e.currentTarget.blur()}
          className="pv-vol vbar-vol"
        />
        <CtrlBtn label={`播放速度 ${media.rate}×`} onClick={cycleRate} wide>
          {media.rate}×
        </CtrlBtn>
        <CtrlBtn label="导入字幕（SRT / VTT / ASS）" onClick={onImportSubtitle} active={!!subtitle}>
          <Captions size={18} strokeWidth={1.8} />
        </CtrlBtn>
        {subtitle && (
          <span className="vbar-sub">
            <span className="u-truncate">{subtitle.name}</span>
            <button
              type="button"
              title="移除字幕"
              aria-label="移除字幕"
              onClick={onClearSubtitle}
              className="vbar-sub-x"
            >
              <X size={12} />
            </button>
          </span>
        )}
        <CtrlBtn
          label={immersive ? '退出全屏 (F)' : '全屏 (F)'}
          onClick={() => (immersive ? exitImmersive() : toggleImmersive())}
        >
          {immersive ? <Minimize2 size={17} strokeWidth={1.8} /> : <Maximize2 size={17} strokeWidth={1.8} />}
        </CtrlBtn>
      </div>
    </div>
  );
}
