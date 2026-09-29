/**
 * Which audio tracks this WebView2 can play on its own.
 *
 * The list is deliberately *probed*, not assumed: Dolby Digital and E-AC-3 are
 * exactly the case where machines differ (Windows ships Media Foundation
 * decoders for them, and Chromium may or may not route to them), and HEVC
 * depends on whether the HEVC Video Extension is installed. When a track is not
 * in the set, playback falls back to the bundled ffmpeg sidecar.
 */

/** MIME type to probe for a track, by the codec name our container parser reports. */
const CODEC_MIME: Record<string, string> = {
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  mp3: 'audio/mpeg',
  mp2: 'audio/mpeg',
  opus: 'audio/webm; codecs="opus"',
  vorbis: 'audio/ogg; codecs="vorbis"',
  flac: 'audio/flac',
  alac: 'audio/mp4; codecs="alac"',
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
  dts: 'audio/mp4; codecs="dtsc"',
  truehd: 'audio/mp4; codecs="mlpa"',
  pcm_s16le: 'audio/wav',
  pcm_s24le: 'audio/wav',
  pcm_s32le: 'audio/wav',
  pcm_f32le: 'audio/wav',
  'pcm_s16be': 'audio/wav',
  'pcm_s24be': 'audio/wav',
  'pcm_f32be': 'audio/wav',
  'pcm_mulaw': 'audio/wav',
  'pcm_alaw': 'audio/wav',
};

/** Human label for the message we show when a track needs the sidecar. */
const CODEC_LABEL: Record<string, string> = {
  aac: 'AAC',
  ac3: 'Dolby Digital (AC-3)',
  eac3: 'Dolby Digital Plus (E-AC-3)',
  dts: 'DTS',
  truehd: 'Dolby TrueHD',
  alac: 'Apple Lossless',
  flac: 'FLAC',
  opus: 'Opus',
  vorbis: 'Vorbis',
};

export function codecLabel(codec: string | undefined): string {
  if (!codec) return '';
  return CODEC_LABEL[codec] ?? codec.toUpperCase();
}

let cache: Map<string, boolean> | null = null;

/** True when this WebView2 claims it can decode `codec` natively. */
export function canPlayAudio(codec: string | undefined): boolean {
  if (!codec) return true; // no track at all — nothing to decode
  if (!cache) cache = new Map();
  const key = codec.toLowerCase();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  // Unknown codec: assume it works, so we never spawn ffmpeg on a guess.
  const mime = CODEC_MIME[key];
  if (!mime) {
    cache.set(key, true);
    return true;
  }
  const el = document.createElement('video');
  const v = el.canPlayType(mime);
  const ok = v === 'probably' || v === 'maybe';
  cache.set(key, ok);
  return ok;
}

/** Forget probe results (the WebView2 runtime never changes while we run, but
 *  a future extension install would). */
export function resetCodecCache(): void {
  cache = null;
}
