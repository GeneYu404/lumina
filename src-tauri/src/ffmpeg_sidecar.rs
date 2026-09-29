//! Bundled FFmpeg sidecar — the seam for codecs the WebView cannot decode.
//!
//! WebView2 covers H.264/AAC/VP9/AV1 (and, depending on the machine, HEVC and
//! Dolby Digital — see the capability probe in the About dialog) through Media
//! Foundation. What it cannot do on *some* machines is play an E-AC-3 track.
//! Instead of linking libavcodec (MSVC import-libs, unsafe FFI, ABI pain) we
//! ship a small ffmpeg build and drive it as a **separate process**: licensing
//! stays isolated, the Rust side stays spawn + pipe, and the binary can be
//! swapped for a different build without touching any code here.
//!
//! Two entry points:
//! - [`probe`] — one-shot check, used by the info panel.
//! - [`stream`] — decode from a timestamp and push PCM to the webview over an
//!   IPC channel, which the frontend feeds into WebAudio.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};

/// Tauri externalBin naming: `<name>-<target-triple><ext>`. The bundler copies
/// the sidecar next to the executable under its plain name (`ffmpeg.exe`), while
/// a manually staged build keeps the triple-qualified one — accept both.
pub const SIDECAR: &str = "ffmpeg-x86_64-pc-windows-msvc.exe";
pub const SIDECAR_ALT: &str = "ffmpeg.exe";

/// Probe ceiling: 4 MB of s16le stereo @48 kHz is ~11 s of audio — plenty to
/// prove the decoder works, small enough that a long file cannot turn the
/// check into a full decode.
const PROBE_PCM_CAP: usize = 4 * 1024 * 1024;

/// PCM forwarded per channel message: 64 KB = 16 K stereo frames ≈ 0.17 s at
/// 48 kHz. Big enough to keep the message rate sane, small enough that a seek
/// does not leave a long tail of stale audio in the ring buffer.
const STREAM_CHUNK: usize = 64 * 1024;

/// Where the bundled binary lives, in order:
/// 1. `$LUMINA_FFMPEG` — explicit override (tests, unusual layouts),
/// 2. next to the running exe (installed layout; two accepted names),
/// 3. the profile dir, because `cargo test` runs from `target/<profile>/deps`,
/// 4. `bin/` relative to the package root (cargo runs with CWD = src-tauri).
pub fn sidecar_path() -> PathBuf {
    if let Some(p) = std::env::var_os("LUMINA_FFMPEG") {
        return PathBuf::from(p);
    }
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    let miss = PathBuf::from(SIDECAR);
    for base in [dir.clone(), dir.parent().map(Path::to_path_buf).unwrap_or_default()] {
        for name in [SIDECAR, SIDECAR_ALT] {
            let candidate = base.join(name);
            if candidate.exists() {
                return candidate;
            }
        }
    }
    let dev = PathBuf::from("bin");
    for name in [SIDECAR, SIDECAR_ALT] {
        let candidate = dev.join(name);
        if candidate.exists() {
            return candidate;
        }
    }
    miss
}

#[derive(Debug, Default, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// Sidecar present and able to decode this file.
    pub available: bool,
    /// This build ships the native E-AC-3 decoder — the reason we ship one.
    pub has_eac3: bool,
    /// Decoded PCM layout, read from the WAV header ffmpeg wrote on stdout.
    pub sample_rate: u32,
    pub channels: u16,
    /// Bytes of raw s16le PCM (WAV header stripped).
    pub pcm_bytes: usize,
    /// ffmpeg's own diagnostics (empty on success, error text on failure).
    pub detail: String,
}

/// Decode the first audio stream of `media` to s16le PCM on stdout and report
/// what came back. Reads at most [`PROBE_PCM_CAP`], then stops the child — a
/// probe must not turn into a full-file decode.
///
/// The command deliberately uses the `pcm_s16le` **encoder** rather than
/// `-f s16le -ac .. -ar ..`: the encoder converts fltp → s16 inside libavcodec
/// via libswresample, so the minimal build needs neither libavfilter nor the
/// auto-inserted `aresample`. A WAV header rides along, which is how the caller
/// learns the real rate/layout instead of forcing one.
pub fn probe(media: &Path) -> Result<Probe, String> {
    let ff = sidecar_path();
    if !ff.exists() {
        return Ok(Probe {
            available: false,
            has_eac3: false,
            detail: format!("sidecar missing: {}", ff.display()),
            ..Default::default()
        });
    }
    let has_eac3 = has_eac3_decoder();
    let input = media.to_string_lossy().into_owned();
    let mut child = Command::new(&ff)
        .args(["-v", "error", "-nostdin", "-i", &input, "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "wav", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn ffmpeg: {e}"))?;

    let mut stdout = child.stdout.take().ok_or_else(|| "no stdout pipe".to_string())?;
    let mut raw = Vec::new();
    let read = stdout.by_ref().take(PROBE_PCM_CAP as u64).read_to_end(&mut raw);
    // Either the cap or EOF stopped the read; either way the child is done
    // with us. kill() on an already-exited process is a harmless error.
    let _ = child.kill();
    let mut diagnostics = String::new();
    if let Some(mut err) = child.stderr.take() {
        let _ = err.by_ref().take(8192).read_to_string(&mut diagnostics);
    }
    let _ = child.wait();

    let detail = diagnostics.trim().to_string();
    match read {
        Ok(_) => match parse_wav(&raw) {
            Some(wav) if wav.pcm_bytes > 0 => Ok(Probe {
                available: true,
                has_eac3,
                sample_rate: wav.sample_rate,
                channels: wav.channels,
                pcm_bytes: wav.pcm_bytes,
                detail,
            }),
            _ => Ok(Probe {
                available: false,
                has_eac3,
                detail: if detail.is_empty() { "no audio stream".to_string() } else { detail },
                ..Default::default()
            }),
        },
        Err(e) => Err(format!("read pcm: {e}")),
    }
}

struct WavInfo {
    sample_rate: u32,
    channels: u16,
    pcm_bytes: usize,
    /// Offset of the first PCM byte — the header is stripped before the
    /// samples reach WebAudio.
    data_at: usize,
}

/// Walk RIFF chunks instead of assuming a 44-byte header: ffmpeg may prepend a
/// LIST/INFO chunk, and when writing to a pipe the `data` size is left as
/// 0xFFFFFFFF — neither matters as long as `fmt ` then `data` are found.
fn parse_wav(buf: &[u8]) -> Option<WavInfo> {
    if buf.len() < 12 || &buf[0..4] != b"RIFF" || &buf[8..12] != b"WAVE" {
        return None;
    }
    let (mut rate, mut channels) = (0u32, 0u16);
    let mut pos = 12usize;
    while pos + 8 <= buf.len() {
        let id = &buf[pos..pos + 4];
        let size = u32::from_le_bytes([buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]]) as usize;
        let body = pos + 8;
        if id == b"fmt " && body + 16 <= buf.len() {
            channels = u16::from_le_bytes([buf[body + 2], buf[body + 3]]);
            rate = u32::from_le_bytes([buf[body + 4], buf[body + 5], buf[body + 6], buf[body + 7]]);
        } else if id == b"data" {
            if rate == 0 || channels == 0 {
                return None;
            }
            return Some(WavInfo { sample_rate: rate, channels, pcm_bytes: buf.len() - body, data_at: body });
        }
        // A pipe may cut a chunk in half; wait for the rest before skipping.
        if body + size > buf.len() {
            return None;
        }
        pos = body + size + (size & 1); // chunks are word-aligned
    }
    None
}

/// True when this ffmpeg build ships the native E-AC-3 decoder — the whole
/// reason the sidecar exists. Cached: the build cannot change while we run.
pub fn has_eac3_decoder() -> bool {
    static CACHE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *CACHE.get_or_init(|| {
        let ff = sidecar_path();
        if !ff.exists() {
            return false;
        }
        match Command::new(&ff).args(["-hide_banner", "-decoders"]).output() {
            Ok(out) => String::from_utf8_lossy(&out.stdout)
                .lines()
                .any(|l| l.split_whitespace().nth(1) == Some("eac3")),
            Err(_) => false,
        }
    })
}

/* ------------------------------------------------------------------ */
/* Streaming playback                                                  */
/* ------------------------------------------------------------------ */

/// What the frontend needs to build an `AudioContext` and size its ring buffer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    pub id: u32,
    pub sample_rate: u32,
    pub channels: u16,
    /// Offset in the media this stream starts at, seconds.
    pub start: f64,
}

/// A running ffmpeg decode, killable from the UI (seek, stop, next image).
struct Session {
    child: Mutex<Option<Child>>,
}

static SESSIONS: LazyLock<Mutex<HashMap<u32, Arc<Session>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_ID: AtomicU32 = AtomicU32::new(1);

/// Kill a stream and forget it. Safe to call with a stale id.
pub fn stop(id: u32) {
    let session = SESSIONS.lock().ok().and_then(|mut m| m.remove(&id));
    if let Some(s) = session {
        if let Ok(mut c) = s.child.lock() {
            if let Some(child) = c.as_mut() {
                let _ = child.kill();
            }
            *c = None;
        }
    }
}

fn kill_quietly(session: &Arc<Session>) {
    if let Ok(mut c) = session.child.lock() {
        if let Some(child) = c.as_mut() {
            let _ = child.kill();
        }
        *c = None;
    }
    if let Ok(mut m) = SESSIONS.lock() {
        m.retain(|_, v| !Arc::ptr_eq(v, session));
    }
}

/// Decode the first audio stream from `start` seconds and push interleaved
/// s16le PCM over `on_pcm` until the media ends, the channel closes, or
/// [`stop`] is called with the returned id.
///
/// Blocking, and meant to run on a worker thread: it only returns once the WAV
/// header has arrived (so the caller learns rate/layout) or the pipe died.
pub fn stream(media: &Path, start: f64, on_pcm: Channel<InvokeResponseBody>) -> Result<StreamInfo, String> {
    let ff = sidecar_path();
    if !ff.exists() {
        return Err(format!("sidecar missing: {}", ff.display()));
    }
    let input = media.to_string_lossy().into_owned();
    let start = if start.is_finite() && start > 0.0 { start } else { 0.0 };
    // `-ss` before `-i` seeks by demuxing, which is what audio wants: fast and
    // sample-accurate enough that a scrub does not visibly jump.
    let mut cmd = Command::new(&ff);
    cmd.args(["-v", "error", "-nostdin"]);
    if start > 0.0 {
        cmd.args(["-ss", &format!("{start:.3}")]);
    }
    cmd.args(["-i", &input, "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "wav", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("spawn ffmpeg: {e}"))?;
    let mut stdout = child.stdout.take().ok_or_else(|| "no stdout pipe".to_string())?;
    let mut stderr = child.stderr.take();

    // Read until the header is complete so the caller can size its buffers.
    let mut head: Vec<u8> = Vec::with_capacity(64 * 1024);
    let mut probe = [0u8; 8 * 1024];
    let mut info = loop {
        let n = stdout.read(&mut probe).map_err(|e| format!("read header: {e}"))?;
        if n == 0 {
            let mut err = String::new();
            if let Some(e) = stderr.as_mut() {
                let _ = e.read_to_string(&mut err);
            }
            let _ = child.kill();
            return Err(if err.trim().is_empty() {
                "没有可解码的音轨".to_string()
            } else {
                err.trim().to_string()
            });
        }
        head.extend_from_slice(&probe[..n]);
        if let Some(w) = parse_wav(&head) {
            break w;
        }
        if head.len() > 1024 * 1024 {
            let _ = child.kill();
            return Err("WAV 头过大，ffmpeg 输出异常".to_string());
        }
    };

    // Everything up to `data_at` is header; the rest is PCM.
    let leftover = head.split_off(info.data_at);
    info.pcm_bytes = leftover.len();

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let session = Arc::new(Session { child: Mutex::new(Some(child)) });
    if let Ok(mut m) = SESSIONS.lock() {
        m.insert(id, Arc::clone(&session));
    }

    let reader_session = Arc::clone(&session);
    std::thread::spawn(move || {
        let send = |bytes: &[u8]| on_pcm.send(InvokeResponseBody::from(bytes.to_vec())).is_ok();
        if !leftover.is_empty() && !send(&leftover) {
            kill_quietly(&reader_session);
            return;
        }
        let mut buf = vec![0u8; STREAM_CHUNK];
        loop {
            match stdout.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if !send(&buf[..n]) {
                        break; // frontend went away (seek / next image)
                    }
                }
            }
        }
        // An empty message is the end-of-stream marker.
        let _ = on_pcm.send(InvokeResponseBody::from(Vec::new()));
        kill_quietly(&reader_session);
    });

    Ok(StreamInfo { id, sample_rate: info.sample_rate, channels: info.channels, start })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1 s 48 kHz stereo sine as a plain WAV, written by hand. Generating the
    /// fixture ourselves keeps the sidecar build free of lavfi + the sine
    /// filter — one less reason for it to grow.
    fn write_test_wav(path: &Path) {
        let (rate, channels, bits) = (48_000u32, 2u16, 16u16);
        let frames = rate as usize; // 1 second
        let block = channels as usize * (bits as usize / 8);
        let data_len = (frames * block) as u32;
        let mut w: Vec<u8> = Vec::with_capacity(44 + data_len as usize);
        w.extend_from_slice(b"RIFF");
        w.extend_from_slice(&(36 + data_len).to_le_bytes());
        w.extend_from_slice(b"WAVEfmt ");
        w.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
        w.extend_from_slice(&1u16.to_le_bytes()); // PCM
        w.extend_from_slice(&channels.to_le_bytes());
        w.extend_from_slice(&rate.to_le_bytes());
        w.extend_from_slice(&(rate * block as u32).to_le_bytes()); // byte rate
        w.extend_from_slice(&(block as u16).to_le_bytes()); // block align
        w.extend_from_slice(&bits.to_le_bytes());
        w.extend_from_slice(b"data");
        w.extend_from_slice(&data_len.to_le_bytes());
        for i in 0..frames {
            let t = i as f32 / rate as f32;
            let sample = (t * 440.0 * 2.0 * std::f32::consts::PI).sin() * 20_000.0;
            let pcm = sample as i16;
            for _ in 0..channels {
                w.extend_from_slice(&pcm.to_le_bytes());
            }
        }
        std::fs::write(path, w).expect("write test wav");
    }

    #[test]
    fn sidecar_resolves() {
        let p = sidecar_path();
        assert!(
            p.exists(),
            "sidecar not found at {p:?} — 放 src-tauri\\bin\\{SIDECAR}，或设 LUMINA_FFMPEG"
        );
    }

    #[test]
    fn ships_eac3_decoder() {
        assert!(has_eac3_decoder(), "ffmpeg -decoders 列表里应有 eac3");
    }

    #[test]
    fn decodes_to_pcm() {
        let dir = std::env::temp_dir().join("lumina-ffmpeg-seam");
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("sine.wav");
        write_test_wav(&wav);

        let probe = probe(&wav).expect("probe runs");
        assert!(probe.available, "wav 应该解出 PCM，实际: {}", probe.detail);
        assert_eq!(probe.sample_rate, 48_000, "采样率应原样透传");
        assert_eq!(probe.channels, 2, "声道数应原样透传");
        // 1 s @ 48 kHz stereo s16 = 192 000 bytes; the read is capped, so accept
        // anything close to that rather than an exact match.
        assert!(probe.pcm_bytes >= 96_000, "PCM 太少: {} 字节", probe.pcm_bytes);
    }

    #[test]
    fn wav_header_survives_extra_chunks() {
        // ffmpeg may emit LIST/INFO before `data`, and on a pipe the data size
        // is 0xFFFFFFFF. The player must still find `fmt ` and `data`.
        let mut buf: Vec<u8> = Vec::new();
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        buf.extend_from_slice(b"WAVE");
        buf.extend_from_slice(b"LIST");
        buf.extend_from_slice(&12u32.to_le_bytes()); // INFO + ISFT + 4-byte value
        buf.extend_from_slice(b"INFOISFT\x00\x00\x00\x00");
        buf.extend_from_slice(b"fmt ");
        buf.extend_from_slice(&16u32.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&6u16.to_le_bytes()); // 5.1
        buf.extend_from_slice(&48_000u32.to_le_bytes());
        buf.extend_from_slice(&0u32.to_le_bytes());
        buf.extend_from_slice(&(6u16 * 2).to_le_bytes());
        buf.extend_from_slice(&16u16.to_le_bytes());
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        let pcm_at = buf.len();
        buf.extend_from_slice(&[0u8; 64]);

        let w = parse_wav(&buf).expect("header with a LIST chunk must parse");
        assert_eq!(w.sample_rate, 48_000);
        assert_eq!(w.channels, 6);
        assert_eq!(w.data_at, pcm_at);
        assert_eq!(w.pcm_bytes, 64);
    }

    #[test]
    fn wav_header_waits_for_a_truncated_chunk() {
        // A pipe can split a chunk header; parsing must not claim success on a
        // half-read `data` size, or the player would eat PCM as header.
        let mut buf: Vec<u8> = Vec::new();
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&100u32.to_le_bytes());
        buf.extend_from_slice(b"WAVEfmt ");
        buf.extend_from_slice(&16u32.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&2u16.to_le_bytes());
        buf.extend_from_slice(&44_100u32.to_le_bytes());
        buf.extend_from_slice(&0u32.to_le_bytes());
        buf.extend_from_slice(&4u16.to_le_bytes());
        buf.extend_from_slice(&16u16.to_le_bytes());
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&[0xFF, 0xFF, 0xFF]); // size not fully read yet
        assert!(parse_wav(&buf).is_none(), "半截 data 头不应被当成完整头");
    }

    #[test]
    fn stopping_an_unknown_stream_is_harmless() {
        stop(u32::MAX);
    }
}
