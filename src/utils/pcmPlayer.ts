/**
 * Plays an audio track that WebView2 cannot decode, by feeding the bundled
 * ffmpeg sidecar's PCM output into WebAudio.
 *
 * The video element is muted in this mode and becomes the clock: it already
 * handles containers, seeking and rate, and the only thing missing is sound.
 * We therefore never try to play the track twice — we decode it separately and
 * keep the two in step, re-seeking when they drift apart.
 *
 * The worklet is built from a Blob URL rather than a separate file so the
 * single-file bundle (vite-plugin-singlefile) stays single-file.
 */
import { Channel, invoke } from '@tauri-apps/api/core';
import { isDesktop } from '../desktop';

export interface PcmStreamInfo {
  id: number;
  sampleRate: number;
  channels: number;
  start: number;
}

interface WorkletIn {
  type: 'pcm' | 'flush' | 'pause' | 'play' | 'rate';
  /** Interleaved s16, only for type 'pcm'. */
  samples?: Int16Array;
  value?: boolean | number;
}

/** The processor: a lock-free-ish ring buffer the main thread fills. */
const WORKLET_SOURCE = `
class PcmRingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 1 << 18;              // 65536 frames
    this.buf = new Float32Array(this.cap * 2);
    this.read = 0;
    this.write = 0;
    this.paused = false;
    this.primed = false;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'pcm') {
        const s = m.samples;
        const n = s.length;
        for (let i = 0; i < n; i += 2) {
          // s16 -> f32; interleaved, so copy both channels per frame.
          this.buf[this.write] = s[i] / 32768;
          this.buf[this.write + 1] = s[i + 1] / 32768;
          this.write = (this.write + 2) % this.buf.length;
        }
        if (!this.primed) this.primed = true;
      } else if (m.type === 'flush') {
        this.read = this.write;
      } else if (m.type === 'pause') {
        this.paused = !!m.value;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const frames = out[0].length;
    const ch = out.length;
    const available = (this.write - this.read + this.buf.length) % this.buf.length;
    if (this.paused || available < frames * 2) {
      // Underrun or paused: emit silence rather than repeat, so a slow decode
      // shows up as a gap instead of a stutter loop.
      for (let c = 0; c < ch; c++) out[c].fill(0);
      return true;
    }
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < ch; c++) {
        out[c][i] = c === 0
          ? this.buf[this.read]
          : this.buf[(this.read + 1) % this.buf.length];
        this.read = (this.read + 2) % this.buf.length;
      }
    }
    return true;
  }
}
registerProcessor('pcm-ring', PcmRingProcessor);
`;

export type PcmPlayerState = 'idle' | 'buffering' | 'playing' | 'ended';

export interface PcmPlayerOptions {
  path: string;
  start?: number;
  volume?: number;
  onState?: (s: PcmPlayerState) => void;
  onError?: (message: string) => void;
}

/** Enough decoded audio to start playing smoothly. */
const PREROLL_FRAMES = 48_000; // ~1 s at 48 kHz

export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private info: PcmStreamInfo | null = null;
  private workletUrl: string | null = null;
  /** Frames handed to the worklet and not yet consumed by it. */
  private queued = 0;
  private consumed = 0;
  private eos = false;
  private starting = false;
  private disposed = false;
  private opts: PcmPlayerOptions;

  constructor(opts: PcmPlayerOptions) {
    this.opts = opts;
  }

  static supported(): boolean {
    return (
      isDesktop &&
      typeof AudioContext !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined'
    );
  }

  get streamId(): number | null {
    return this.info?.id ?? null;
  }

  /** Frames the worklet has already rendered, in seconds from `start`. */
  get playedSeconds(): number {
    if (!this.info) return 0;
    return this.consumed / this.info.sampleRate;
  }

  get bufferedSeconds(): number {
    if (!this.info) return 0;
    return this.queued / this.info.sampleRate;
  }

  /** Begin (or restart at `start`) decoding and playing. */
  async open(start: number): Promise<void> {
    if (!PcmPlayer.supported() || this.disposed) return;
    this.teardownStream();
    this.eos = false;
    this.queued = 0;
    this.consumed = 0;

    try {
      // The context must run at the file's rate or every sample needs
      // resampling; the browser converts to the device rate on the way out.
      if (!this.ctx) {
        this.ctx = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
        if (!this.workletUrl) {
          this.workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
        }
        await this.ctx.audioWorklet.addModule(this.workletUrl);
        this.node = new AudioWorkletNode(this.ctx, 'pcm-ring', { outputChannelCount: [2] });
        this.gain = this.ctx.createGain();
        this.gain.gain.value = this.opts.volume ?? 1;
        this.node.connect(this.gain).connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.node?.port.postMessage({ type: 'flush' } satisfies WorkletIn);

      const channel = new Channel<ArrayBuffer>();
      channel.onmessage = (data) => this.onChunk(data);
      // The channel is kept alive by the pending invoke; holding a reference
      // here documents that, and stops GC from closing it mid-stream.
      this.channelRef = channel;

      this.info = await invoke<PcmStreamInfo>('ffmpeg_stream', {
        path: this.opts.path,
        start,
        onPcm: channel,
      });
      this.opts.onState?.('buffering');
    } catch (e) {
      this.opts.onError?.(String(e));
      this.opts.onState?.('idle');
    }
  }

  private channelRef: Channel<ArrayBuffer> | null = null;

  private onChunk(raw: ArrayBuffer | number[] | null): void {
    // A message from a previous stream (we seeked or switched files) must not
    // land in the new ring buffer.
    if (this.disposed || !this.node || !this.channelRef) return;
    // Tauri hands raw channel bodies over as an ArrayBuffer; a JSON fallback
    // would arrive as a number array, so normalise both.
    const data: ArrayBuffer | null =
      raw instanceof ArrayBuffer ? raw : raw ? new Uint8Array(raw).buffer : null;
    if (!data || data.byteLength === 0) {
      this.eos = true;
      this.opts.onState?.('ended');
      return;
    }
    // Keep the two halves of an interleaved stereo frame together.
    const bytes = data.byteLength & ~3;
    const samples = new Int16Array(data, 0, bytes >> 1);
    const frames = bytes >> 2;
    // Bound the queue: a paused player must not accumulate the whole file.
    if (this.queued + frames > PREROLL_FRAMES * 4) return;
    this.queued += frames;
    this.node.port.postMessage({ type: 'pcm', samples } satisfies WorkletIn, [samples.buffer]);
    if (this.queued >= PREROLL_FRAMES && !this.starting) {
      this.starting = true;
      this.opts.onState?.('playing');
    }
  }

  /** Called from the viewer's rAF loop: the worklet renders ~128 frames per
   *  callback, so approximate consumption from elapsed context time. */
  tick(): void {
    if (!this.ctx || !this.info || this.eos) return;
    const elapsed = this.ctx.currentTime;
    if (this.lastTick === undefined) {
      this.lastTick = elapsed;
      return;
    }
    const dt = elapsed - this.lastTick;
    this.lastTick = elapsed;
    const frames = dt * this.info.sampleRate;
    this.consumed = Math.min(this.queued, this.consumed + frames);
    this.queued = Math.max(0, this.queued - frames);
  }

  private lastTick: number | undefined;

  setPaused(paused: boolean): void {
    this.node?.port.postMessage({ type: 'pause', value: paused } satisfies WorkletIn);
    if (this.ctx && this.ctx.state === 'running' && paused) void this.ctx.suspend();
    else if (this.ctx && this.ctx.state === 'suspended' && !paused) void this.ctx.resume();
    if (paused) this.lastTick = undefined;
  }

  setVolume(v: number): void {
    if (this.gain) this.gain.gain.value = Math.max(0, Math.min(1, v));
  }

  /** Re-anchor to a new media position (the user seeked). */
  async seek(seconds: number): Promise<void> {
    await this.open(Math.max(0, seconds));
  }

  stop(): void {
    this.teardownStream();
    this.opts.onState?.('idle');
  }

  private teardownStream(): void {
    if (this.info) {
      void invoke('ffmpeg_stop', { id: this.info.id }).catch(() => undefined);
      this.info = null;
    }
    this.channelRef = null;
    this.eos = false;
    this.starting = false;
    this.lastTick = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.teardownStream();
    this.node?.disconnect();
    this.gain?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
  }
}
