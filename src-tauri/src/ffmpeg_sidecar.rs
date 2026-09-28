//! Bundled FFmpeg sidecar — the seam for codecs the WebView cannot decode.
//!
//! The `<video>` path in WebView2 covers H.264/AAC/VP9/AV1 through Media
//! Foundation, but Dolby Digital Plus (E-AC-3) has no decoder there. Instead
//! of linking libavcodec (MSVC import-libs, unsafe FFI, ABI pain) we ship a
//! small ffmpeg build and drive it as a **separate process**: licensing stays
//! isolated, the Rust side stays spawn + pipe, and the binary can later be
//! swapped for a minimal source build without touching any code here.
//!
//! This round proves the seam end to end: locate → spawn → s16le PCM out of
//! the first audio stream. Feeding that PCM to WebAudio (and A/V sync) is the
//! next round's work.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use serde::Serialize;

/// Tauri externalBin naming: `<name>-<target-triple><ext>`. The bundler copies
/// the sidecar next to the executable under its plain name (`ffmpeg.exe`), while
/// a manually staged build keeps the triple-qualified one — accept both.
pub const SIDECAR: &str = "ffmpeg-x86_64-pc-windows-msvc.exe";
pub const SIDECAR_ALT: &str = "ffmpeg.exe";

/// Probe ceiling: 4 MB of s16le stereo @48 kHz is ~11 s of audio — plenty to
/// prove the decoder works, small enough that a long file cannot turn the
/// check into a full decode.
const PROBE_PCM_CAP: usize = 4 * 1024 * 1024;

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
    /// Bytes of interleaved s16le PCM produced.
    pub pcm_bytes: usize,
    /// ffmpeg's own diagnostics (empty on success, error text on failure).
    pub detail: String,
}

/// Decode the first audio stream of `media` to s16le PCM on stdout and report
/// how many bytes came back. Reads at most [`PROBE_PCM_CAP`], then stops the
/// child — a probe must not turn into a full-file decode.
pub fn probe(media: &Path) -> Result<Probe, String> {
    let ff = sidecar_path();
    if !ff.exists() {
        return Ok(Probe {
            available: false,
            has_eac3: false,
            pcm_bytes: 0,
            detail: format!("sidecar missing: {}", ff.display()),
        });
    }
    let has_eac3 = has_eac3_decoder();
    let input = media.to_string_lossy().into_owned();
    let mut child = Command::new(&ff)
        .args([
            "-v", "error", "-nostdin", "-i", &input, "-map", "0:a:0", "-f", "s16le", "-ac", "2",
            "-ar", "48000", "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn ffmpeg: {e}"))?;

    let mut stdout = child.stdout.take().ok_or_else(|| "no stdout pipe".to_string())?;
    let mut pcm = Vec::new();
    let read = stdout.by_ref().take(PROBE_PCM_CAP as u64).read_to_end(&mut pcm);
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
        Ok(_) if !pcm.is_empty() => Ok(Probe { available: true, has_eac3, pcm_bytes: pcm.len(), detail }),
        Ok(_) => Ok(Probe {
            available: false,
            has_eac3,
            pcm_bytes: 0,
            detail: if detail.is_empty() { "no audio stream".to_string() } else { detail },
        }),
        Err(e) => Err(format!("read pcm: {e}")),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

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
        // Generate the fixture with the sidecar itself: a lavfi source needs
        // no codec support, so this works on any build we might ship.
        let gen = Command::new(sidecar_path())
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-ac", "2"])
            .arg(&wav)
            .status()
            .expect("spawn ffmpeg to write the test wav");
        assert!(gen.success(), "ffmpeg 生成测试 wav 失败");

        let probe = probe(&wav).expect("probe runs");
        assert!(probe.available, "wav 应该解出 PCM，实际: {}", probe.detail);
        // 1 s @ 48 kHz stereo s16 = 192 000 bytes; allow a wide margin.
        assert!(probe.pcm_bytes >= 96_000, "PCM 太少: {} 字节", probe.pcm_bytes);
    }
}
