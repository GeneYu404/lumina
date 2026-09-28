/**
 * Subtitle loading for the video player: decode whatever bytes the file has
 * and convert it to WebVTT (the only format Chromium's <track> understands).
 * Supported inputs: .vtt (pass-through), .srt, .ass/.ssa (best effort —
 * positioning and styling are dropped, the text itself survives).
 */

/** Decode a subtitle buffer to text. Windows-edited SRT/ASS files are
 *  frequently GBK/GB18030; a plain UTF-8 read would turn Chinese dialogue
 *  into mojibake, so decode strictly first and fall back to the GB family. */
export function decodeSubtitleBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('gb18030').decode(bytes).replace(/^\uFEFF/, '');
  }
}

/** Convert SRT / ASS / SSA / VTT text into a WebVTT document. */
export function toWebVtt(text: string): string {
  const t = text.replace(/^\uFEFF/, '');
  if (/^WEBVTT/.test(t)) return t;
  if (/^Dialogue:/m.test(t) && /^\s*\[/m.test(t)) return assToVtt(t);
  return srtToVtt(t);
}

function srtToVtt(srt: string): string {
  const out: string[] = ['WEBVTT', ''];
  const blocks = srt.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    // Optional numeric index line before the timing line.
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const times = lines[ti].replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2');
    // SRT allows tags WebVTT doesn't know (<font …>): strip them, keep the rest.
    const body = lines
      .slice(ti + 1)
      .join('\n')
      .replace(/<\/?font[^>]*>/gi, '');
    if (!body.trim()) continue;
    out.push(times, body, '');
  }
  return out.join('\n');
}

function assToVtt(ass: string): string {
  const out: string[] = ['WEBVTT', ''];
  const lines = ass.replace(/\r\n?/g, '\n').split('\n');
  // Field order comes from the script's own Format line, never assumed.
  let fields: string[] = [];
  let inEvents = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inEvents = trimmed.startsWith('[Events]');
      continue;
    }
    if (!inEvents) continue;
    if (/^Format:/i.test(line)) {
      fields = line.slice(line.indexOf(':') + 1).split(',').map((s) => s.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/i.test(line)) continue;
    const si = fields.indexOf('start');
    const ei = fields.indexOf('end');
    const ti = fields.indexOf('text');
    if (si < 0 || ei < 0 || ti < 0) continue;
    // The text field may contain commas: split only past the last fixed field.
    const parts = line.slice(line.indexOf(':') + 1).split(',');
    if (parts.length <= ti) continue;
    const start = assTime(parts[si].trim());
    const end = assTime(parts[ei].trim());
    if (!start || !end) continue;
    const body = parts
      .slice(ti)
      .join(',')
      .replace(/\\[Nn]/g, '\n')
      .replace(/\{[^}]*\}/g, ''); // style overrides (\an8, \i1, …) carry no plain-text value
    if (!body.trim()) continue;
    out.push(`${start} --> ${end}`, body, '');
  }
  return out.join('\n');
}

/** ASS time `H:MM:SS.cc` → WebVTT `HH:MM:SS.mmm`. */
function assTime(t: string): string | null {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,3})$/.exec(t);
  if (!m) return null;
  const frac = m[4].padEnd(3, '0').slice(0, 3);
  return `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}:${m[3].padStart(2, '0')}.${frac}`;
}
