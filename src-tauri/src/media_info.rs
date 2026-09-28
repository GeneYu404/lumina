//! Container header parsing for the video info panel: duration, codec, frame
//! rate, audio layout. Hand-rolled on purpose — the fields we show are a
//! handful of header numbers, and pulling in a demuxer crate (or FFmpeg) for
//! that would dwarf the whole app. Only headers are read: a 500 GB file costs
//! the same few seeks as a 5 MB one, and malformed files must degrade to
//! "no info" instead of panicking the process.

use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Default, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub container: Option<String>,
    pub duration_ms: Option<u64>,
    pub video: Option<VideoStream>,
    pub audio: Option<AudioStream>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VideoStream {
    pub codec: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioStream {
    pub codec: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
}

/// Sniff the container from the first bytes, then run its parser. Every parse
/// is best-effort: unsupported formats and truncated files simply return
/// whatever was found (possibly nothing), and only an unopenable path errors.
pub fn read(path: &Path) -> Result<MediaInfo, String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut head = [0u8; 16];
    if read_up_to(&mut f, 0, &mut head) < 16 {
        return Ok(MediaInfo::default());
    }
    let mut info = MediaInfo::default();
    if &head[4..8] == b"ftyp" {
        info.container = Some(mp4_container_name(&head[8..12]));
        parse_mp4(&mut f, &mut info);
    } else if head.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        parse_ebml(&mut f, &mut info);
    } else if &head[0..4] == b"RIFF" && &head[8..12] == b"AVI " {
        info.container = Some("AVI".to_string());
        parse_avi(&mut f, &mut info);
    } else if &head[0..3] == b"FLV" {
        info.container = Some("Flash Video (FLV)".to_string());
        parse_flv(&mut f, &mut info);
    } else if &head[0..4] == &[0x30, 0x26, 0xB2, 0x75] {
        info.container = Some("Windows Media Video (ASF)".to_string());
        parse_asf(&mut f, &mut info);
    }
    Ok(info)
}

/* ------------------------------- primitives ------------------------------ */

/// Read up to `buf.len()` bytes starting at `at`. Short reads are fine here:
/// every caller treats missing bytes as "stop parsing", not as an error.
fn read_up_to(f: &mut File, at: u64, buf: &mut [u8]) -> usize {
    if f.seek(SeekFrom::Start(at)).is_err() {
        return 0;
    }
    let mut got = 0;
    while got < buf.len() {
        match f.read(&mut buf[got..]) {
            Ok(0) | Err(_) => break,
            Ok(n) => got += n,
        }
    }
    got
}

fn be_u16(b: &[u8], at: usize) -> Option<u16> {
    b.get(at..at + 2).map(|s| u16::from_be_bytes([s[0], s[1]]))
}

fn be_u32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}

fn be_u64(b: &[u8], at: usize) -> Option<u64> {
    b.get(at..at + 8).map(|s| {
        u64::from_be_bytes([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]])
    })
}

fn le_u16(b: &[u8], at: usize) -> Option<u16> {
    b.get(at..at + 2).map(|s| u16::from_le_bytes([s[0], s[1]]))
}

fn le_u32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn le_i32(b: &[u8], at: usize) -> Option<i32> {
    b.get(at..at + 4).map(|s| i32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn le_u64(b: &[u8], at: usize) -> Option<u64> {
    b.get(at..at + 8).map(|s| {
        u64::from_le_bytes([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]])
    })
}

fn ms_from(dur: u64, timescale: u64) -> Option<u64> {
    if timescale == 0 || dur == 0 {
        return None;
    }
    // u128 intermediate: a long duration at a high timescale overflows u64.
    Some(((dur as u128 * 1000) / timescale as u128) as u64)
}

/* -------------------------------- ISO BMFF -------------------------------- */

/// moov may sit at either end of the file (faststart puts it first, camera
/// files last). Real moov boxes are KBs, occasionally a few MB — past this we
/// assume a corrupt size field rather than allocating for it.
const MAX_MOOV: u64 = 64 * 1024 * 1024;

fn mp4_container_name(brand: &[u8]) -> String {
    if brand == b"qt  " {
        "QuickTime (MOV)".to_string()
    } else if brand == b"M4V " {
        "M4V".to_string()
    } else if brand.starts_with(b"3g") {
        "3GP".to_string()
    } else {
        "MP4".to_string()
    }
}

fn parse_mp4(f: &mut File, info: &mut MediaInfo) {
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let mut pos = 0u64;
    // Top-level boxes are a handful at most; the cap breaks malformed files
    // whose size fields would otherwise walk in circles.
    for _ in 0..64 {
        if pos + 8 > len {
            return;
        }
        let mut hdr = [0u8; 8];
        if read_up_to(f, pos, &mut hdr) < 8 {
            return;
        }
        let mut size = u32::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]) as u64;
        let mut header_len = 8u64;
        if size == 1 {
            let mut ext = [0u8; 8];
            if read_up_to(f, pos + 8, &mut ext) < 8 {
                return;
            }
            size = u64::from_be_bytes(ext);
            header_len = 16;
        } else if size == 0 {
            size = len - pos; // "extends to EOF"
        }
        if size < header_len || pos.checked_add(size).map_or(true, |end| end > len) {
            return;
        }
        if &hdr[4..8] == b"moov" {
            let payload = size - header_len;
            if payload > MAX_MOOV {
                return;
            }
            let mut buf = vec![0u8; payload as usize];
            if read_up_to(f, pos + header_len, &mut buf) == buf.len() {
                parse_moov(&buf, info);
            }
            return;
        }
        pos += size;
    }
}

/// Boxes inside a buffer as (type, payload). A size below 8 or past the
/// buffer ends the list — truncated files should stop, not loop.
fn boxes(b: &[u8]) -> Vec<([u8; 4], &[u8])> {
    let mut out = Vec::new();
    let mut i = 0usize;
    while i + 8 <= b.len() {
        let size = u32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as usize;
        if size < 8 || i + size > b.len() {
            break;
        }
        let mut typ = [0u8; 4];
        typ.copy_from_slice(&b[i + 4..i + 8]);
        out.push((typ, &b[i + 8..i + size]));
        i += size;
    }
    out
}

/// mvhd and mdhd share a layout (v0 packs 32-bit times, v1 64-bit ones).
/// Sentinel durations (all bits set) mean "unknown" and map to None.
fn track_time(b: &[u8]) -> Option<(u64, Option<u64>)> {
    match b.first()? {
        1 => {
            let ts = be_u32(b, 20)? as u64;
            let dur = be_u64(b, 24)?;
            Some((ts, (dur != u64::MAX).then_some(dur)))
        }
        _ => {
            let ts = be_u32(b, 12)? as u64;
            let dur = be_u32(b, 16)? as u64;
            Some((ts, (dur != u32::MAX as u64).then_some(dur)))
        }
    }
}

fn parse_moov(b: &[u8], info: &mut MediaInfo) {
    for (typ, body) in boxes(b) {
        match &typ {
            b"mvhd" => {
                if info.duration_ms.is_none() {
                    info.duration_ms = track_time(body)
                        .and_then(|(ts, d)| d.and_then(|d| ms_from(d, ts)));
                }
            }
            b"trak" => parse_trak(body, info),
            _ => {}
        }
    }
}

fn parse_trak(body: &[u8], info: &mut MediaInfo) {
    for (typ, b) in boxes(body) {
        if &typ == b"mdia" {
            parse_mdia(b, info);
        }
    }
}

fn parse_mdia(body: &[u8], info: &mut MediaInfo) {
    let mut handler = [0u8; 4];
    let mut timescale = 0u64;
    let mut duration = None;
    let mut stsd: &[u8] = &[];
    let mut stts: &[u8] = &[];
    for (typ, b) in boxes(body) {
        match &typ {
            b"mdhd" => {
                if let Some((ts, d)) = track_time(b) {
                    timescale = ts;
                    duration = d;
                }
            }
            b"hdlr" => {
                if let Some(s) = b.get(8..12) {
                    handler.copy_from_slice(s);
                }
            }
            b"minf" => {
                for (t2, b2) in boxes(b) {
                    if &t2 == b"stbl" {
                        for (t3, b3) in boxes(b2) {
                            match &t3 {
                                b"stsd" => stsd = b3,
                                b"stts" => stts = b3,
                                _ => {}
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    if &handler == b"vide" {
        // First video track only — secondary tracks (previews, cover art)
        // would overwrite the info the user actually cares about.
        if info.video.is_none() {
            let (codec, width, height) = stsd_video(stsd);
            let fps = (timescale > 0).then(|| stts_fps(stts, timescale)).flatten();
            info.video = Some(VideoStream { codec, width, height, fps });
        }
        if info.duration_ms.is_none() {
            info.duration_ms = duration.and_then(|d| ms_from(d, timescale));
        }
    } else if &handler == b"soun" && info.audio.is_none() {
        let (codec, sample_rate, channels) = stsd_audio(stsd);
        info.audio = Some(AudioStream { codec, sample_rate, channels });
    }
}

/// First sample entry of an stsd: [size][format][body…]. The format fourcc
/// IS the codec tag.
fn stsd_entry(stsd: &[u8]) -> Option<&[u8]> {
    let entries = stsd.get(8..)?; // version/flags + entry_count
    let size = u32::from_be_bytes([entries[0], entries[1], entries[2], entries[3]]) as usize;
    if size < 8 || size > entries.len() {
        return None;
    }
    Some(&entries[..size])
}

fn stsd_video(stsd: &[u8]) -> (Option<String>, Option<u32>, Option<u32>) {
    let Some(entry) = stsd_entry(stsd) else {
        return (None, None, None);
    };
    let codec = entry.get(4..8).map(video_codec_name);
    // VisualSampleEntry: 8 box header + 8 reserved/dataref + 16 predefined
    // → width/height u16 at 32/34.
    let width = be_u16(entry, 32).filter(|&v| v > 0);
    let height = be_u16(entry, 34).filter(|&v| v > 0);
    (codec, width.map(|v| v as u32), height.map(|v| v as u32))
}

fn stsd_audio(stsd: &[u8]) -> (Option<String>, Option<u32>, Option<u8>) {
    let Some(entry) = stsd_entry(stsd) else {
        return (None, None, None);
    };
    let codec = entry.get(4..8).map(audio_codec_name);
    // AudioSampleEntry: channelcount u16 @24, samplerate as 16.16 fixed @32.
    let channels = be_u16(entry, 24).filter(|&v| v > 0);
    let rate = be_u32(entry, 32).map(|v| v >> 16).filter(|&v| v > 0);
    (
        codec,
        rate,
        channels.and_then(|v| u8::try_from(v).ok()),
    )
}

/// Average frame rate from the time-to-sample table:
/// fps = samples × timescale / Σ(count × delta). The entry count is capped —
/// a corrupt table can claim billions of runs.
fn stts_fps(stts: &[u8], timescale: u64) -> Option<f64> {
    let count = be_u32(stts, 4)? as usize;
    let mut samples = 0u64;
    let mut span = 0u128;
    let mut at = 8usize;
    for _ in 0..count.min(4096) {
        let (Some(c), Some(d)) = (be_u32(stts, at), be_u32(stts, at + 4)) else {
            break;
        };
        samples += c as u64;
        span += c as u128 * d as u128;
        at += 8;
    }
    if samples == 0 || span == 0 || timescale == 0 {
        return None;
    }
    let fps = samples as f64 * timescale as f64 / span as f64;
    (fps.is_finite() && fps > 0.0 && fps < 1000.0).then_some(fps)
}

fn video_codec_name(four: &[u8]) -> String {
    let s = String::from_utf8_lossy(four);
    match s.trim() {
        "avc1" | "avc2" | "avc3" => "H.264 / AVC".to_string(),
        "hev1" | "hvc1" => "H.265 / HEVC".to_string(),
        "vp09" => "VP9".to_string(),
        "vp08" => "VP8".to_string(),
        "av01" => "AV1".to_string(),
        "mp4v" => "MPEG-4 Part 2".to_string(),
        "mjpg" | "jpeg" => "MJPEG".to_string(),
        "theo" => "Theora".to_string(),
        other => other.to_string(),
    }
}

fn audio_codec_name(four: &[u8]) -> String {
    let s = String::from_utf8_lossy(four);
    match s.trim() {
        "mp4a" => "AAC".to_string(),
        ".mp3" | "mp3 " => "MP3".to_string(),
        "ac-3" => "AC-3".to_string(),
        "ec-3" => "E-AC-3".to_string(),
        "Opus" | "opus" => "Opus".to_string(),
        "fLaC" => "FLAC".to_string(),
        "alac" => "ALAC".to_string(),
        "sowt" | "twos" | "in24" | "in32" => "PCM".to_string(),
        other => other.to_string(),
    }
}

/* ------------------------------ EBML (MKV/WebM) -------------------------- */

/// Info + Tracks sit at the head of the Segment (before any Cluster), so a
/// few MB covers virtually every file without reading the media data.
const EBML_CAP: usize = 8 * 1024 * 1024;

fn vint_len(first: u8) -> Option<usize> {
    if first == 0 {
        return None; // VINTs always contain a marker bit
    }
    for k in 0..8 {
        if first & (0x80u8 >> k) != 0 {
            return Some(k + 1);
        }
    }
    Some(8)
}

/// Element ID: length marker kept — EBML IDs are matched with it.
fn read_id(b: &[u8], i: &mut usize) -> Option<u32> {
    let first = *b.get(*i)?;
    let len = vint_len(first)?;
    let s = b.get(*i..*i + len)?;
    let mut v = 0u32;
    for &byte in s {
        v = (v << 8) | byte as u32;
    }
    *i += len;
    Some(v)
}

/// Element data size: marker stripped, so a 1-byte size carries 7 value bits.
/// An all-ones encoding means "unknown" (size runs to the parent's end).
fn read_size(b: &[u8], i: &mut usize) -> Option<(usize, bool)> {
    let first = *b.get(*i)?;
    let len = vint_len(first)?;
    let s = b.get(*i..*i + len)?;
    let mask = (0xFFu32 >> len) as u8; // value bits inside the first byte
    let mut v = (first & mask) as u64;
    let mut unknown = (first & mask) == mask;
    for &byte in s.iter().skip(1) {
        v = (v << 8) | byte as u64;
        if byte != 0xFF {
            unknown = false;
        }
    }
    *i += len;
    Some((v.min(usize::MAX as u64) as usize, unknown))
}

/// One element as (id, payload). Oversized fields clamp to the parent's end
/// instead of failing — a partial payload still carries the numbers we want.
fn next_element<'a>(b: &'a [u8], i: &mut usize) -> Option<(u32, &'a [u8])> {
    let id = read_id(b, i)?;
    let (size, unknown) = read_size(b, i)?;
    let start = *i;
    let avail = b.len().saturating_sub(start);
    let take = if unknown { avail } else { size.min(avail) };
    let payload = b.get(start..start + take)?;
    *i = start + take;
    Some((id, payload))
}

/// EBML floats are stored as 4- or 8-byte big-endian IEEE values.
fn fnum(v: &[u8]) -> Option<f64> {
    match v.len() {
        4 => Some(f32::from_be_bytes([v[0], v[1], v[2], v[3]]) as f64),
        8 => Some(f64::from_be_bytes([v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7]])),
        _ => None,
    }
}

/// EBML unsigned ints are 1..8 bytes, big-endian, zero-padded.
fn ebu64(v: &[u8]) -> Option<u64> {
    match v.len() {
        0 => None,
        1..=3 => Some(v.iter().fold(0u64, |acc, &x| (acc << 8) | x as u64)),
        4 => be_u32(v, 0).map(|x| x as u64),
        8 => be_u64(v, 0),
        n => v.get(0..n).map(|s| {
            s.iter().fold(0u64, |acc, &x| (acc << 8) | x as u64)
        }),
    }
}

fn parse_ebml(f: &mut File, info: &mut MediaInfo) {
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let cap = (len as usize).min(EBML_CAP);
    let mut buf = vec![0u8; cap];
    let got = read_up_to(f, 0, &mut buf);
    parse_ebml_buf(&buf[..got], info);
}

fn parse_ebml_buf(b: &[u8], info: &mut MediaInfo) {
    let mut i = 0usize;
    while let Some((id, payload)) = next_element(b, &mut i) {
        match id {
            0x1A45_DFA3 => {
                // EBML header: DocType tells MKV from WebM.
                let mut j = 0usize;
                while let Some((cid, p)) = next_element(payload, &mut j) {
                    if cid == 0x4282 {
                        let doc = String::from_utf8_lossy(p);
                        info.container = Some(match doc.trim() {
                            "webm" => "WebM".to_string(),
                            "matroska" => "Matroska (MKV)".to_string(),
                            other => other.to_string(),
                        });
                        break;
                    }
                }
            }
            0x1853_8067 => {
                parse_segment(payload, info);
                break; // Segment holds everything else
            }
            _ => {}
        }
    }
}

fn parse_segment(b: &[u8], info: &mut MediaInfo) {
    let mut i = 0usize;
    while let Some((id, payload)) = next_element(b, &mut i) {
        match id {
            0x1549_A966 => parse_info(payload, info),
            0x1654_AE6B => parse_tracks(payload, info),
            0x1F43_B675 => break, // Cluster: raw media from here, stop reading
            _ => {}
        }
    }
}

fn parse_info(b: &[u8], info: &mut MediaInfo) {
    let mut i = 0usize;
    let mut scale: Option<u64> = None;
    let mut dur_ticks: Option<f64> = None;
    while let Some((id, p)) = next_element(b, &mut i) {
        match id {
            0x2AD7_B1 => scale = ebu64(p),  // TimecodeScale, ns per tick
            0x4489 => dur_ticks = fnum(p), // Duration, in ticks
            _ => {}
        }
    }
    // Default per spec: one tick == one millisecond.
    let scale = scale.unwrap_or(1_000_000);
    if let Some(d) = dur_ticks {
        let ms = d * scale as f64 / 1_000_000.0;
        if ms.is_finite() && ms > 0.0 {
            info.duration_ms = Some(ms as u64);
        }
    }
}

fn parse_tracks(b: &[u8], info: &mut MediaInfo) {
    let mut i = 0usize;
    while let Some((id, p)) = next_element(b, &mut i) {
        // TrackEntry (0xAE): first video and first audio win.
        if id == 0xAE && (info.video.is_none() || info.audio.is_none()) {
            parse_track_entry(p, info);
        }
    }
}

fn parse_track_entry(b: &[u8], info: &mut MediaInfo) {
    let mut i = 0usize;
    let mut track_type = 0u64;
    let mut codec: Option<String> = None;
    let mut fps: Option<f64> = None;
    let mut width = None;
    let mut height = None;
    let mut rate = None;
    let mut channels = None;
    while let Some((id, p)) = next_element(b, &mut i) {
        match id {
            0x83 => track_type = ebu64(p).unwrap_or(0), // TrackType: 1 video, 2 audio
            0x86 => codec = Some(matroska_codec_name(&String::from_utf8_lossy(p))),
            0x23E3_83 => {
                // DefaultDuration is nanoseconds per frame → fps.
                if let Some(ns) = ebu64(p).filter(|&x| x > 0) {
                    fps = Some(1e9 / ns as f64);
                }
            }
            0xE0 => {
                let mut j = 0usize; // Video element
                while let Some((vid, vp)) = next_element(p, &mut j) {
                    match vid {
                        0xB0 => width = ebu64(vp).map(|v| v as u32).filter(|&v| v > 0),
                        0xBA => height = ebu64(vp).map(|v| v as u32).filter(|&v| v > 0),
                        _ => {}
                    }
                }
            }
            0xE1 => {
                let mut j = 0usize; // Audio element
                while let Some((aid, ap)) = next_element(p, &mut j) {
                    match aid {
                        0xB5 => rate = fnum(ap).map(|v| v as u32).filter(|&v| v > 0),
                        0x9F => channels = ebu64(ap).map(|v| v as u8).filter(|&v| v > 0),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    let fps = fps.filter(|f| f.is_finite() && *f > 0.0 && *f < 1000.0);
    match track_type {
        1 if info.video.is_none() => {
            info.video = Some(VideoStream { codec, width, height, fps });
        }
        2 if info.audio.is_none() => {
            info.audio = Some(AudioStream {
                codec,
                sample_rate: rate,
                channels,
            });
        }
        _ => {}
    }
}

fn matroska_codec_name(id: &str) -> String {
    match id {
        "V_MPEG4/ISO/AVC" => "H.264 / AVC".to_string(),
        "V_MPEGH/ISO/HEVC" => "H.265 / HEVC".to_string(),
        "V_VP9" => "VP9".to_string(),
        "V_VP8" => "VP8".to_string(),
        "V_AV1" => "AV1".to_string(),
        "V_MPEG4/ISO/SP" | "V_MPEG4/ISO/ASP" | "V_MPEG4/ISO/AP" => "MPEG-4 Part 2".to_string(),
        "V_THEORA" => "Theora".to_string(),
        "V_MPEG2" | "V_MPEG1" => "MPEG".to_string(),
        s if s.starts_with("A_AAC") => "AAC".to_string(),
        "A_OPUS" => "Opus".to_string(),
        "A_VORBIS" => "Vorbis".to_string(),
        "A_AC3" => "AC-3".to_string(),
        "A_EAC3" => "E-AC-3".to_string(),
        "A_MPEG/L3" => "MP3".to_string(),
        "A_MPEG/L2" => "MPEG Audio Layer 2".to_string(),
        "A_FLAC" => "FLAC".to_string(),
        "A_PCM/INT/LIT" | "A_PCM/INT/BIG" | "A_PCM/FLOAT/IEEE" => "PCM".to_string(),
        "A_TRUEHD" => "TrueHD".to_string(),
        other => other.to_string(),
    }
}

/* ---------------------------------- AVI ----------------------------------- */

/// State handed down the hdrl → strl recursion: strh (stream header) always
/// precedes strf (stream format) inside one strl, so strf can rely on it.
#[derive(Default)]
struct AviCtx {
    fcc_type: Option<[u8; 4]>, // "vids" / "auds"
    handler: Option<[u8; 4]>,  // codec hint from the stream header
    scale: u32,
    rate: u32,
    length: u32,
}

fn parse_avi(f: &mut File, info: &mut MediaInfo) {
    // hdrl sits right after the RIFF header; 256 KB covers it many times over.
    const CAP: usize = 256 * 1024;
    let mut buf = vec![0u8; CAP];
    let got = read_up_to(f, 0, &mut buf);
    let mut ctx = AviCtx::default();
    // Offset 12 skips the "RIFF" size "AVI " prologue.
    scan_riff(&buf[..got], 12, got, info, &mut ctx);
}

fn scan_riff(b: &[u8], mut i: usize, end: usize, info: &mut MediaInfo, ctx: &mut AviCtx) {
    while i + 8 <= end {
        let typ: [u8; 4] = [b[i], b[i + 1], b[i + 2], b[i + 3]];
        let size = le_u32(b, i + 4).unwrap_or(0) as usize;
        let body = i + 8;
        if body > end {
            break;
        }
        let stop = body.saturating_add(size).min(end);
        match &typ {
            b"LIST" if size >= 4 && stop >= body + 4 => {
                let seg = &b[body..stop];
                let list: [u8; 4] = [seg[0], seg[1], seg[2], seg[3]];
                if list == *b"hdrl" {
                    scan_riff(b, body + 4, stop, info, ctx);
                } else if list == *b"strl" {
                    // A fresh stream — a strf must not inherit the previous
                    // stream's type, so reset before descending.
                    *ctx = AviCtx::default();
                    scan_riff(b, body + 4, stop, info, ctx);
                }
            }
            b"avih" => parse_avih(&b[body..stop], info),
            b"strh" => parse_strh(&b[body..stop], info, ctx),
            b"strf" => parse_strf(&b[body..stop], info, ctx),
            _ => {}
        }
        i = body + size + (size & 1); // chunks are word aligned
    }
}

/// AVIMAINHEADER: microseconds per frame, total frames, usually the canvas size.
fn parse_avih(b: &[u8], info: &mut MediaInfo) {
    let usec = le_u32(b, 0).unwrap_or(0);
    let frames = le_u32(b, 16).unwrap_or(0);
    if usec > 0 && frames > 0 {
        info.duration_ms = Some(frames as u64 * usec as u64 / 1000);
    }
    if info.video.is_none() {
        let width = le_u32(b, 32).filter(|&v| v > 0);
        let height = le_u32(b, 36).filter(|&v| v > 0);
        let fps = (usec > 0).then(|| 1_000_000.0 / usec as f64);
        info.video = Some(VideoStream { codec: None, width, height, fps });
    }
}

/// AVISTREAMHEADER: rate/scale gives fps and duration for video streams.
fn parse_strh(b: &[u8], info: &mut MediaInfo, ctx: &mut AviCtx) {
    if let Some(s) = b.get(0..4) {
        let mut t = [0u8; 4];
        t.copy_from_slice(s);
        ctx.fcc_type = Some(t);
    }
    if let Some(s) = b.get(4..8) {
        let mut t = [0u8; 4];
        t.copy_from_slice(s);
        ctx.handler = Some(t);
    }
    ctx.scale = le_u32(b, 20).unwrap_or(0);
    ctx.rate = le_u32(b, 24).unwrap_or(0);
    ctx.length = le_u32(b, 32).unwrap_or(0);

    if ctx.fcc_type == Some(*b"vids") {
        if ctx.scale > 0 && ctx.rate > 0 {
            let v = info.video.get_or_insert_with(|| VideoStream {
                codec: None,
                width: None,
                height: None,
                fps: None,
            });
            v.fps = Some(ctx.rate as f64 / ctx.scale as f64);
        }
        if info.duration_ms.is_none() && ctx.scale > 0 && ctx.rate > 0 && ctx.length > 0 {
            info.duration_ms =
                Some(ctx.length as u64 * ctx.scale as u64 * 1000 / ctx.rate as u64);
        }
    }
}

/// Video strf is a BITMAPINFOHEADER (biCompression = codec fourcc), audio
/// strf a WAVEFORMATEX (tag, channels, sample rate).
fn parse_strf(b: &[u8], info: &mut MediaInfo, ctx: &AviCtx) {
    if ctx.fcc_type == Some(*b"vids") {
        if b.len() >= 20 {
            let comp: [u8; 4] = [b[16], b[17], b[18], b[19]];
            // An empty compression field means the hint in strh is all we have.
            let name = if comp.iter().all(|&c| c == 0) {
                ctx.handler.map(|h| avi_video_codec(&h))
            } else {
                Some(avi_video_codec(&comp))
            };
            if let Some(codec) = name {
                if let Some(v) = info.video.as_mut() {
                    if v.codec.is_none() {
                        v.codec = Some(codec);
                    }
                }
            }
            if let Some(v) = info.video.as_mut() {
                // Negative height marks a top-down bitmap — magnitude is the size.
                if v.width.is_none() {
                    v.width = le_i32(b, 4).map(|x| x.unsigned_abs()).filter(|&x| x > 0);
                }
                if v.height.is_none() {
                    v.height = le_i32(b, 8).map(|x| x.unsigned_abs()).filter(|&x| x > 0);
                }
            }
        }
    } else if ctx.fcc_type == Some(*b"auds") {
        let tag = le_u16(b, 0).unwrap_or(0);
        let channels = le_u16(b, 2).unwrap_or(0);
        let rate = le_u32(b, 4).unwrap_or(0);
        if info.audio.is_none() && (tag > 0 || channels > 0) {
            info.audio = Some(AudioStream {
                codec: Some(wave_codec(tag)),
                sample_rate: (rate > 0).then_some(rate),
                channels: u8::try_from(channels).ok().filter(|&c| c > 0),
            });
        }
    }
}

fn avi_video_codec(four: &[u8]) -> String {
    let s = String::from_utf8_lossy(four);
    match s.trim() {
        "H264" | "h264" | "x264" | "avc1" => "H.264 / AVC".to_string(),
        "H265" | "h265" | "x265" | "HEVC" => "H.265 / HEVC".to_string(),
        "MPG2" | "mpg2" | "mpeg" => "MPEG-2".to_string(),
        "MPG1" | "mpg1" => "MPEG-1".to_string(),
        "WMV1" => "Windows Media Video 7".to_string(),
        "WMV2" => "Windows Media Video 8".to_string(),
        "WMV3" => "Windows Media Video 9".to_string(),
        "WVC1" => "VC-1".to_string(),
        "MJPG" | "mjpg" | "DJPG" => "MJPEG".to_string(),
        "XVID" | "DIVX" | "DX50" | "FMP4" | "mp4v" | "MP4V" => "MPEG-4 Part 2 (DivX/Xvid)".to_string(),
        "VP70" | "VP71" => "On2 VP7".to_string(),
        "VP80" => "VP8".to_string(),
        "cvid" => "Cinepak".to_string(),
        "raw " | "RGB " | "DIB " => "未压缩".to_string(),
        other => other.to_string(),
    }
}

fn wave_codec(tag: u16) -> String {
    match tag {
        0x0001 => "PCM".to_string(),
        0x0003 => "PCM (float)".to_string(),
        0x0055 => "MP3".to_string(),
        0x00FF => "AAC".to_string(),
        0x0110 => "ADPCM".to_string(),
        0x0161 => "WMA".to_string(),
        0x0162 => "WMA Pro".to_string(),
        0x0163 => "WMA Lossless".to_string(),
        0x2000 => "AC-3".to_string(),
        0xF1AC => "FLAC".to_string(),
        other => format!("格式 0x{other:04X}"),
    }
}

/* ---------------------------------- FLV ----------------------------------- */

fn parse_flv(f: &mut File, info: &mut MediaInfo) {
    let mut buf = vec![0u8; 64 * 1024]; // audio+video tags announce early
    let got = read_up_to(f, 0, &mut buf);
    parse_flv_buf(&buf[..got], info);
}

fn parse_flv_buf(b: &[u8], info: &mut MediaInfo) {
    if b.len() < 13 {
        return;
    }
    let mut i = 13usize; // 9-byte header + first PreviousTagSize
    // Tags until both codecs are known — a bound against pathological files.
    for _ in 0..128 {
        if i + 11 > b.len() {
            break;
        }
        let tag = b[i];
        let size =
            ((b[i + 1] as usize) << 16) | ((b[i + 2] as usize) << 8) | b[i + 3] as usize;
        let start = i + 11;
        let Some(end) = start.checked_add(size).filter(|&e| e <= b.len()) else {
            break;
        };
        let payload = &b[start..end];
        if tag == 9 && info.video.is_none() {
            // Low nibble of the first byte is the codec id (7 = AVC/H.264).
            if let Some(&first) = payload.first() {
                let code = first & 0x0F;
                info.video = Some(VideoStream {
                    codec: Some(flv_video_codec(code)),
                    width: None,
                    height: None,
                    fps: None,
                });
            }
        } else if tag == 8 && info.audio.is_none() {
            // High nibble of the first byte is the audio format (10 = AAC).
            if let Some(&first) = payload.first() {
                info.audio = Some(AudioStream {
                    codec: Some(flv_audio_codec(first >> 4)),
                    sample_rate: None,
                    channels: None,
                });
            }
        }
        if info.video.is_some() && info.audio.is_some() {
            break;
        }
        i = end + 4; // skip PreviousTagSize
    }
}

fn flv_video_codec(code: u8) -> String {
    match code {
        2 => "Sorenson H.263".to_string(),
        4 | 5 => "On2 VP6".to_string(),
        6 => "Screen video".to_string(),
        7 => "H.264 / AVC".to_string(),
        12 => "H.265 / HEVC".to_string(),
        other => format!("FLV 编码 id {other}"),
    }
}

fn flv_audio_codec(fmt: u8) -> String {
    match fmt {
        0 | 5 => "PCM".to_string(),
        1 => "ADPCM".to_string(),
        2 | 14 => "MP3".to_string(),
        6 => "Nellymoser".to_string(),
        10 => "AAC".to_string(),
        11 => "Speex".to_string(),
        other => format!("FLV 音频格式 {other}"),
    }
}

/* --------------------------------- ASF/WMV -------------------------------- */

/// ASF header objects all start with a 16-byte GUID, stored little-endian in
/// the first three fields: {75B22635-668E-11CF-A6D9-00AA0062CE6C} is the File
/// Properties object.
const ASF_FILE_PROPS: [u8; 16] = [
    0x35, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11, 0xA6, 0xD9, 0x00, 0xAA, 0x00, 0x62, 0xCE, 0x6C,
];

fn parse_asf(f: &mut File, info: &mut MediaInfo) {
    // Header objects cluster at the head of the file.
    let mut buf = vec![0u8; 64 * 1024];
    let got = read_up_to(f, 0, &mut buf);
    let b = &buf[..got];
    // GUID(16) + ObjectSize(8) + FileID(16) + FileSize(8) + CreationDate(8)
    // + DataPackets(8) → PlayDuration, counted in 100-ns ticks.
    for off in 0..b.len().saturating_sub(16 + 64 + 8) {
        if b[off..off + 16] == ASF_FILE_PROPS {
            if let Some(ticks) = le_u64(b, off + 64) {
                let ms = ticks / 10_000;
                if ms > 0 {
                    info.duration_ms = Some(ms);
                }
            }
            break; // codec streams are deliberately not parsed — see module docs
        }
    }
}
