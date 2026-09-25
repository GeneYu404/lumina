import { useEffect, useRef, type CSSProperties } from 'react';
import { extOf } from '../utils/format';

/**
 * Animated GIF / APNG / animated WebP player.
 *
 * Why not <img>: for large or long animations Blink's decoded-frame cache is
 * too small, so every loop re-decodes from frame 0 (visible as stutter), and
 * every <img> showing the file decodes it again. Here the WebCodecs
 * ImageDecoder decodes off the main thread into ImageBitmaps:
 *   - all frames are kept when they fit a memory budget → after the first
 *     loop, playback costs one drawImage per frame and zero decoding;
 *   - otherwise one frame is decoded ahead (ring mode);
 *   - timing follows each frame's own duration and drops frames when late
 *     instead of slowing the animation down;
 *   - requestAnimationFrame stops by itself when the window is hidden.
 */

interface DecodeResult {
  image: {
    displayWidth: number;
    displayHeight: number;
    duration: number | null;
    close(): void;
  };
}
interface ImageTrackLike {
  frameCount: number;
  repetitionCount: number;
  animated: boolean;
}
interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: ImageTrackLike | null };
  decode(opts: { frameIndex: number }): Promise<DecodeResult>;
  close(): void;
}
interface ImageDecoderCtor {
  new (init: { data: ArrayBuffer; type: string }): ImageDecoderLike;
  isTypeSupported(type: string): Promise<boolean>;
}

/** Memory for decoded frames kept for the whole animation. */
const CACHE_BUDGET = 384 * 1024 * 1024;

function decoderCtor(): ImageDecoderCtor | null {
  const ctor = (globalThis as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  return typeof ctor === 'function' ? ctor : null;
}

/** MIME the decoder should use, or null when the file is not an animation candidate. */
export function animatedMime(name: string, type: string): string | null {
  if (!decoderCtor()) return null;
  const ext = extOf(name);
  if (ext === 'gif' || type === 'image/gif') return 'image/gif';
  if (ext === 'apng' || type === 'image/apng') return 'image/png';
  if (ext === 'webp' || type === 'image/webp') return 'image/webp';
  return null;
}

interface Frame {
  bitmap: ImageBitmap;
  /** ms */
  duration: number;
}

export default function AnimatedImage({
  src,
  mime,
  paused,
  className,
  style,
  onReady,
  onFail,
}: {
  src: string;
  mime: string;
  paused: boolean;
  className?: string;
  style?: CSSProperties;
  onReady: (width: number, height: number) => void;
  onFail: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const failRef = useRef(onFail);
  failRef.current = onFail;

  useEffect(() => {
    const Ctor = decoderCtor();
    const canvas = canvasRef.current;
    if (!Ctor || !canvas) {
      failRef.current();
      return;
    }
    let cancelled = false;
    let raf = 0;
    let decoder: ImageDecoderLike | null = null;
    const cache: (Frame | undefined)[] = [];
    let cacheAll = false;
    let shown: Frame | null = null;

    const toFrame = async (index: number): Promise<Frame> => {
      const { image } = await (decoder as ImageDecoderLike).decode({ frameIndex: index });
      try {
        const us = image.duration ?? 100_000;
        let duration = us / 1000;
        // Same rule as browsers: “0 / 10 ms” GIF delays mean 100 ms.
        if (!(duration > 10)) duration = 100;
        const bitmap = await createImageBitmap(image as unknown as ImageBitmapSource);
        return { bitmap, duration };
      } finally {
        image.close();
      }
    };

    const getFrame = async (index: number): Promise<Frame> => {
      const hit = cache[index];
      if (hit) return hit;
      const f = await toFrame(index);
      if (cacheAll) cache[index] = f;
      return f;
    };

    const release = (f: Frame | null) => {
      // In ring mode frames are not shared with the cache: free them.
      if (f && !cacheAll) f.bitmap.close();
    };

    (async () => {
      try {
        if (!(await Ctor.isTypeSupported(mime))) throw new Error('unsupported');
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        if (cancelled) return;
        decoder = new Ctor({ data, type: mime });
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        if (!track) throw new Error('no track');
        const count = Math.max(1, track.frameCount);

        const first = await toFrame(0);
        if (cancelled) {
          first.bitmap.close();
          return;
        }
        const w = first.bitmap.width;
        const h = first.bitmap.height;
        cacheAll = count === 1 || w * h * 4 * count <= CACHE_BUDGET;
        if (cacheAll) cache[0] = first;

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        const draw = (f: Frame) => {
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(f.bitmap, 0, 0);
        };
        draw(first);
        shown = first;
        readyRef.current(w, h);
        if (count < 2) return;

        // repetitionCount: Infinity = loop forever, n = play n extra times.
        const maxLoops = Number.isFinite(track.repetitionCount) ? track.repetitionCount + 1 : Infinity;
        let loops = 0;
        let index = 0;
        let shownAt = performance.now();
        let pending: Promise<Frame> | null = getFrame(1);
        let pendingIndex = 1;
        let ready: Frame | null = null;
        pending.then((f) => {
          if (pendingIndex === 1) ready = f;
        }, () => undefined);

        const prefetch = (next: number) => {
          pendingIndex = next;
          ready = null;
          pending = getFrame(next);
          const want = next;
          pending.then(
            (f) => {
              if (cancelled) {
                release(f);
                return;
              }
              if (pendingIndex === want) ready = f;
              else release(f);
            },
            () => undefined,
          );
        };

        const tick = (now: number) => {
          if (cancelled) return;
          raf = requestAnimationFrame(tick);
          if (pausedRef.current || !shown) {
            shownAt = now;
            return;
          }
          const due = shownAt + shown.duration;
          if (now < due || !ready) return; // not yet time, or next frame still decoding
          const nextIndex = pendingIndex;
          const f: Frame = ready;
          const prev = shown;
          draw(f);
          shown = f;
          if (prev !== f) release(prev);
          index = nextIndex;
          // Keep the schedule; if we fell far behind (tab was busy), resync instead of bursting.
          shownAt = now - due > 250 ? now : due;

          let after = index + 1;
          if (after >= count) {
            loops += 1;
            if (loops >= maxLoops) {
              cancelAnimationFrame(raf);
              return; // animation finished: last frame stays
            }
            after = 0;
          }
          prefetch(after);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) failRef.current();
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cache.forEach((f) => f?.bitmap.close());
      if (shown && !cacheAll) shown.bitmap.close();
      try {
        decoder?.close();
      } catch {
        /* already closed */
      }
    };
  }, [src, mime]);

  return <canvas ref={canvasRef} className={className} style={style} />;
}
