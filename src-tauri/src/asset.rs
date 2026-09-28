//! Bounded replacement for Tauri's built-in `asset` protocol.
//!
//! The stock handler answers a request that arrives **without** a `Range`
//! header by reading the *entire* file into one buffer. `<video>` normally
//! asks with `Range`, but anything else that touches a video URL — a stray
//! `<img>` preload, an `OPTIONS` preflight (the poster generator loads with
//! `crossOrigin`), `window.open`, a CSS `mask-image` — pulls every byte of a
//! multi-gigabyte file into the core process, and Windows kills the app. That
//! is the "闪退": the window simply disappears.
//!
//! Here every response is capped, so no single request can take the process
//! down. Media keeps streaming through ordinary 206 range responses; an `<img>`
//! that points at a video just fails to decode instead of taking us with it.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path};

use tauri::http::header::{
    ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
    ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_EXPOSE_HEADERS, CONTENT_LENGTH, CONTENT_RANGE,
    CONTENT_TYPE, ORIGIN, RANGE,
};
use tauri::http::response::Builder as ResponseBuilder;
use tauri::http::{Method, Request, Response, StatusCode};
use tauri::utils::mime_type::MimeType;
use tauri::{Manager, UriSchemeContext};

/// One `Range` response never holds more than this.
const MAX_RANGE: u64 = 1024 * 1024;
/// A request without `Range` is refused (`413`) past this size; it is also
/// the ceiling `read_image` enforces. Images sit far below it, so a huge
/// video can never be yanked into RAM in a single piece.
const MAX_WHOLE: u64 = 128 * 1024 * 1024;

/// Registered as the `asset` scheme, which makes Tauri skip its own handler.
pub fn handler<R: tauri::Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    // Echo the caller's origin so `crossOrigin` requests (video posters, canvas
    // reads) stay CORS-clean in both the dev server and the packaged app.
    let origin = request
        .headers()
        .get(ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .unwrap_or_else(|| "*".to_string());
    let builder = ResponseBuilder::new()
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .header(ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header(ACCESS_CONTROL_ALLOW_HEADERS, "range")
        .header(ACCESS_CONTROL_EXPOSE_HEADERS, "content-range")
        .header(ACCEPT_RANGES, "bytes");

    let raw = request.uri().path().strip_prefix('/').unwrap_or("");
    let path = percent_decode(raw);

    // Preflight only approves the method and headers; no file access needed.
    if *request.method() == Method::OPTIONS {
        return finish(builder.status(StatusCode::NO_CONTENT), Vec::new());
    }

    // The scheme hands us a raw filesystem path: absolute, no escaping `..`.
    let file_path = Path::new(&path);
    if path.is_empty() || !file_path.is_absolute() || file_path.components().any(|c| matches!(c, Component::ParentDir)) {
        return finish(builder.status(StatusCode::FORBIDDEN), Vec::new());
    }
    if !ctx.app_handle().asset_protocol_scope().is_allowed(file_path) {
        return finish(builder.status(StatusCode::FORBIDDEN), Vec::new());
    }

    let mut file = match File::open(file_path) {
        Ok(f) => f,
        Err(e) => {
            let status = match e.kind() {
                std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
                std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            return finish(builder.status(status), Vec::new());
        }
    };
    let len = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => return finish(builder.status(StatusCode::INTERNAL_SERVER_ERROR), Vec::new()),
    };

    // Sniff the magic bytes for the content type, then rewind for the body.
    let mut magic = Vec::with_capacity(8192.min(len as usize));
    let _ = (&mut file).take(8192).read_to_end(&mut magic);
    let _ = file.rewind();
    let builder = builder.header(CONTENT_TYPE, mime_for(&path, &magic));

    // `Range` → at most MAX_RANGE bytes. Multi-range requests fall through to
    // the unranged path below (RFC 7233 lets a server ignore `Range`, and the
    // browser never sends a second form here).
    let range = request
        .headers()
        .get(RANGE)
        .and_then(|v| v.to_str().ok())
        .filter(|r| !r.contains(','));
    let parsed = range.and_then(|spec| parse_range(spec, len));

    // A ranged HEAD mirrors the exact (clamped) window its GET would return.
    // An unranged HEAD reports the true `len`: clients size the resource from
    // it, and a later GET still frames itself with its own Content-Length, so
    // the honest size can never hang anyone — while promising the capped size
    // would tell a 500 MB video it is only 128 MiB and break every seek.
    if *request.method() == Method::HEAD {
        if range.is_some() && parsed.is_none() {
            let b = builder.header(CONTENT_RANGE, format!("bytes */{len}"));
            return finish(b.status(StatusCode::RANGE_NOT_SATISFIABLE), Vec::new());
        }
        let (status, total) = match parsed {
            Some((start, end)) => (StatusCode::PARTIAL_CONTENT, end - start + 1),
            None => (StatusCode::OK, len),
        };
        let mut b = builder.header(CONTENT_LENGTH, total).status(status);
        if let Some((start, end)) = parsed {
            b = b.header(CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
        }
        return finish(b, Vec::new());
    }

    if range.is_some() {
        match parsed {
            None => {
                let b = builder.header(CONTENT_RANGE, format!("bytes */{len}"));
                return finish(b.status(StatusCode::RANGE_NOT_SATISFIABLE), Vec::new());
            }
            Some((start, end)) => {
                let nbytes = end - start + 1;
                let mut buf = Vec::with_capacity(nbytes as usize);
                let read = file
                    .seek(SeekFrom::Start(start))
                    .and_then(|_| (&mut file).take(nbytes).read_to_end(&mut buf));
                if read.is_err() {
                    return finish(builder.status(StatusCode::INTERNAL_SERVER_ERROR), Vec::new());
                }
                let b = builder
                    .header(CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
                    .header(CONTENT_LENGTH, buf.len() as u64)
                    .status(StatusCode::PARTIAL_CONTENT);
                return finish(b, buf);
            }
        }
    }

    // Whole-file responses hold the body in memory, so past MAX_WHOLE we
    // refuse instead of sending a silently short 200 — the client sees the
    // real size from HEAD, learns we accept ranges, and can retry ranged
    // (which is what `<video>` does anyway). This is the path a stray
    // `<img>` or `fetch` takes at a video URL: 0 bytes now, rather than a
    // 128 MiB transfer that cannot decode and only burns memory.
    if len > MAX_WHOLE {
        return finish(builder.status(StatusCode::PAYLOAD_TOO_LARGE), Vec::new());
    }
    let mut buf = Vec::with_capacity(len as usize);
    if (&mut file).take(len).read_to_end(&mut buf).is_err() {
        return finish(builder.status(StatusCode::INTERNAL_SERVER_ERROR), Vec::new());
    }
    // Content-Length must describe *this* body (the file could shrink
    // mid-read), so a client sees a complete response, not a hang.
    finish(builder.header(CONTENT_LENGTH, buf.len() as u64), buf)
}

fn finish(builder: ResponseBuilder, body: Vec<u8>) -> Response<Vec<u8>> {
    builder.body(body).unwrap_or_else(|_| Response::new(Vec::new()))
}

/// `bytes=100-199` / `bytes=100-` / `bytes=-50`, clamped to `MAX_RANGE` and to
/// the real file length. `None` means "not satisfiable".
fn parse_range(spec: &str, len: u64) -> Option<(u64, u64)> {
    if len == 0 {
        return None;
    }
    let value = spec.trim().strip_prefix("bytes=")?;
    let (from, to) = value.split_once('-')?;
    // Resolve the requested window first: in the suffix form `to` is a count
    // ("the last N bytes"), not an end offset, so the two forms must not share
    // the end calculation.
    let (start, end) = if from.is_empty() {
        let suffix: u64 = to.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        (len.saturating_sub(suffix), len - 1)
    } else {
        let start = from.parse::<u64>().ok()?;
        if start >= len {
            return None;
        }
        let end = if to.is_empty() {
            len - 1
        } else {
            to.parse::<u64>().ok()?.min(len - 1)
        };
        if end < start {
            return None;
        }
        (start, end)
    };
    Some((start, end.min(start + MAX_RANGE - 1)))
}

/// Content type from the extension we already know, falling back to Tauri's
/// sniffing. Extension first: `infer` cannot identify every container we play
/// (`.webm`/`.mkv`/`.mov` …), and Tauri's fallback for those is `text/html`.
fn mime_for(path: &str, magic: &[u8]) -> String {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let known = match ext.as_str() {
        "jpg" | "jpeg" | "jfif" | "pjpeg" | "pjp" => "image/jpeg",
        "png" | "apng" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" | "dib" => "image/bmp",
        "ico" | "cur" => "image/x-icon",
        "svg" => "image/svg+xml",
        "tif" | "tiff" => "image/tiff",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "jxl" => "image/jxl",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        _ => "",
    };
    if known.is_empty() {
        MimeType::parse(magic, path)
    } else {
        known.to_string()
    }
}

/// Decode what `encodeURIComponent` produced (`C%3A%5Cphotos%5Ca.jpg`).
fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(hi * 16 + lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}
