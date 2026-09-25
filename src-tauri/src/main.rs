// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashSet,
    hash::{Hash, Hasher},
    io::Cursor,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::UNIX_EPOCH,
};

use image::image_dimensions;
use rayon::prelude::*;
use serde::Serialize;
use tauri::{ipc::Response, State};
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
use winreg::RegKey;

use std::fs;
use std::io::BufReader;

/// Camera orientation values as stored in EXIF. Only the ones that swap width
/// and height matter for us; the others (mirror-only) keep the aspect ratio.
fn apply_orientation(width: u32, height: u32, orientation: u16) -> (u32, u32) {
    // 1=normal, 2=mirror H, 3=rotate 180, 4=mirror V,
    // 5=mirror H + rotate 270 CW, 6=rotate 90 CW,
    // 7=mirror H + rotate 90 CW, 8=rotate 270 CW (= 90 CCW).
    match orientation {
        5 | 6 | 7 | 8 => (height, width),
        2 | 3 | 4 => (width, height),
        _ => (width, height),
    }
}

/// Cheap probe for EXIF orientation. Returns 1 when no EXIF block is present.
fn read_orientation(path: &Path) -> u16 {
    let Ok(file) = fs::File::open(path) else {
        return 1;
    };
    let mut bufreader = BufReader::new(file);
    let Ok(reader) = exif::Reader::new().read_from_container(&mut bufreader) else {
        return 1;
    };
    if let Some(field) = reader.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
        if let Some(num) = field.value.get_uint(0) {
            if (1..=8).contains(&num) {
                return num as u16;
            }
        }
    }
    1
}

mod register;

/// Image-only list (the file picker / associations use `MEDIA_EXTS`).
#[allow(dead_code)]
const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "jfif", "pjpeg", "pjp", "png", "apng", "gif", "webp", "avif", "bmp", "dib",
    "ico", "cur", "svg", "tif", "tiff",
];
/// Played by the system WebView; dimensions stay 0 until the page reads metadata.
const VIDEO_EXTS: &[&str] = &["mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv"];
/// Every extension the app can open (file picker, context menu, associations).
const MEDIA_EXTS: &[&str] = &[
    "jpg", "jpeg", "jfif", "pjpeg", "pjp", "png", "apng", "gif", "webp", "avif", "bmp", "dib",
    "ico", "cur", "svg", "tif", "tiff", "heic", "heif", "jxl",
    "mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv",
];
/// Formats the Rust decoder understands. Others keep the original file as thumbnail.
const DECODABLE: &[&str] = &[
    "jpg", "jpeg", "jfif", "png", "gif", "webp", "bmp", "ico", "tif", "tiff",
];
const MAX_FILES: usize = 2000;
const MAX_DEPTH: usize = 12;
const MAX_PIXELS: u64 = 80_000_000;

/// Paths the frontend may read (imported / launched images).
#[derive(Default)]
struct Registry {
    allowed: Mutex<HashSet<PathBuf>>,
}

#[derive(Serialize, Clone)]
struct Entry {
    path: String,
    name: String,
    size: u64,
    modified: f64,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
struct LaunchSet {
    entries: Vec<Entry>,
    selected: usize,
}

type Shared = Arc<Registry>;

fn ext_of(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

fn is_media(p: &Path) -> bool {
    let e = ext_of(p);
    !e.is_empty() && MEDIA_EXTS.contains(&e.as_str())
}

/* ------------------------ Windows shell integration ------------------------ */

fn command_value() -> String {
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    format!("\"{exe}\" \"%1\"")
}

fn prog_id(ext: &str) -> &'static str {
    if VIDEO_EXTS.contains(&ext) {
        "Lumina.Video"
    } else {
        "Lumina.Image"
    }
}

/// Enable/disable the “用拾光打开” entry in the Explorer context menu (HKCU,
/// no admin rights needed and no reboot).
#[tauri::command]
fn shell_menu(enabled: bool) -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for ext in MEDIA_EXTS {
        let base = format!("Software\\Classes\\SystemFileAssociations\\.{ext}\\shell\\lumina");
        if enabled {
            hkcu.create_subkey(&base)
                .map_err(|e| e.to_string())?
                .0
                .set_value("", &format!("用拾光打开 .{ext}"))
                .map_err(|e| e.to_string())?;
            hkcu
                .create_subkey(format!("{base}\\command"))
                .map_err(|e| e.to_string())?
                .0
                .set_value("", &command_value())
                .map_err(|e| e.to_string())?;
        } else {
            let _ = hkcu.delete_subkey_all(&base);
        }
    }
    Ok(enabled)
}

#[tauri::command]
fn shell_menu_state() -> bool {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Classes\\SystemFileAssociations\\.jpg\\shell\\lumina")
        .is_ok()
}

/// Extensions currently registered to Lumina (ProgID owned by us).
#[tauri::command]
fn assoc_state() -> Vec<String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    MEDIA_EXTS
        .iter()
        .filter(|ext| {
            hkcu.open_subkey(format!("Software\\Classes\\.{ext}"))
                .ok()
                .and_then(|k| k.get_value::<String, _>("").ok())
                .map(|v| v.eq_ignore_ascii_case(prog_id(ext)))
                .unwrap_or(false)
        })
        .map(|e| e.to_string())
        .collect()
}

#[tauri::command]
fn assoc_set(ext: String, enabled: bool) -> Result<(), String> {
    let e = ext.trim_start_matches('.').to_lowercase();
    if !MEDIA_EXTS.contains(&e.as_str()) {
        return Err(format!("不支持的扩展名：{e}"));
    }
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let id = prog_id(&e);
    if enabled {
        hkcu.create_subkey(format!("Software\\Classes\\{id}"))
            .map_err(|e| e.to_string())?
            .0
            .set_value("", &format!("拾光 {}", e.to_uppercase()))
            .map_err(|e| e.to_string())?;
        hkcu
            .create_subkey(format!("Software\\Classes\\{id}\\shell\\open\\command"))
            .map_err(|e| e.to_string())?
            .0
            .set_value("", &command_value())
            .map_err(|e| e.to_string())?;
        hkcu
            .create_subkey(format!("Software\\Classes\\.{e}"))
            .map_err(|e| e.to_string())?
            .0
            .set_value("", &id)
            .map_err(|e| e.to_string())?;
    } else if hkcu
        .open_subkey(format!("Software\\Classes\\.{e}"))
        .ok()
        .and_then(|k| k.get_value::<String, _>("").ok())
        .map(|v| v.eq_ignore_ascii_case(id))
        .unwrap_or(false)
    {
        // Only clear the value we own.
        if let Ok(k) = hkcu.open_subkey_with_flags(format!("Software\\Classes\\.{e}"), KEY_WRITE) {
            let _ = k.delete_value("");
        }
    }
    Ok(())
}

/// Reveal a file in Explorer with its name selected.
#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .args(["/select,", &path])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Windows 11 protects the user’s default-app choice: open the real page for it.
#[tauri::command]
fn open_default_apps() -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/c", "start", "", "ms-settings:defaultapps"])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Set the desktop wallpaper: copy to a stable folder, pick the style in the
/// registry, then ask Windows to reload it.
#[tauri::command]
fn set_wallpaper(path: String, style: String, reg: State<'_, Shared>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !allowed(&reg, &p) {
        return Err("path not allowed".to_string());
    }
    let ext = ext_of(&p);
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Lumina");
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let dest = base.join(format!("wallpaper.{ext}"));
    std::fs::copy(&p, &dest).map_err(|e| e.to_string())?;

    let (wallpaper_style, tile) = match style.as_str() {
        "center" => ("0", "0"),
        "stretch" => ("2", "0"),
        "fit" => ("6", "0"),
        "fill" => ("10", "0"),
        "tile" => ("0", "1"),
        _ => ("10", "0"),
    };
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let desktop = hkcu
        .open_subkey_with_flags("Control Panel\\Desktop", KEY_READ | KEY_WRITE)
        .map_err(|e| e.to_string())?;
    desktop
        .set_value("WallpaperStyle", &wallpaper_style)
        .map_err(|e| e.to_string())?;
    desktop.set_value("TileWallpaper", &tile).map_err(|e| e.to_string())?;
    let wallpaper = dest.to_string_lossy().into_owned();
    desktop
        .set_value("Wallpaper", &wallpaper)
        .map_err(|e| e.to_string())?;

    let mut wide: Vec<u16> = wallpaper.encode_utf16().collect();
    wide.push(0);
    let ok = unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::SystemParametersInfoW;
        // SPI_SETDESKWALLPAPER = 20, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE = 3
        SystemParametersInfoW(20, 0, wide.as_mut_ptr() as *mut _, 3)
    };
    if ok == 0 {
        return Err("Windows 未能应用壁纸".to_string());
    }
    Ok(())
}

fn describe(p: &Path) -> Option<Entry> {
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() {
        return None;
    }
    // Header-only probe: cheap enough to run in parallel for a whole folder.
    let (width, height) = if VIDEO_EXTS.contains(&ext_of(p).as_str()) {
        (0, 0)
    } else {
        let (w, h) = image_dimensions(p).unwrap_or((0, 0));
        if w == 0 || h == 0 {
            (0, 0)
        } else {
            apply_orientation(w, h, read_orientation(p))
        }
    };
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    Some(Entry {
        path: p.to_string_lossy().into_owned(),
        name: p.file_name()?.to_string_lossy().into_owned(),
        size: meta.len(),
        modified,
        width,
        height,
    })
}

fn by_name(a: &Path, b: &Path) -> std::cmp::Ordering {
    a.file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default()
        .cmp(
            &b.file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .unwrap_or_default(),
        )
}

fn sort_entries(entries: &mut [Entry]) {
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
}

fn collect_dir(root: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        return;
    }
    let Ok(rd) = std::fs::read_dir(root) else {
        return;
    };
    let mut children: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    children.sort_by(|a, b| by_name(a, b));
    for path in children {
        if out.len() >= MAX_FILES {
            return;
        }
        if path.is_dir() {
            collect_dir(&path, out, depth + 1);
        } else if path.is_file() && is_media(&path) {
            out.push(path);
        }
    }
}

/// Expand files and folders into a bounded, de-duplicated image list.
fn collect_paths(inputs: &[PathBuf]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for p in inputs {
        if p.is_dir() {
            collect_dir(p, &mut out, 0);
        } else if p.is_file() && is_media(p) {
            out.push(p.clone());
        }
    }
    let mut seen = HashSet::new();
    out.retain(|p| seen.insert(p.clone()));
    out.truncate(MAX_FILES);
    out
}

/// Images reachable from `target`'s folder, recursively (phone/photo
/// libraries are routinely nested by year/month/event). Path-sorted, capped
/// to MAX_FILES around the target. The target keeps its exact path string so
/// the frontend can match it against the item it already shows.
fn siblings_of(target: &Path) -> Vec<PathBuf> {
    let Some(dir) = target.parent() else {
        return vec![target.to_path_buf()];
    };
    let mut all: Vec<PathBuf> = Vec::new();
    collect_dir(dir, &mut all, 0);
    all.sort_by(|a, b| by_path(a, b));

    let wanted = target.to_string_lossy().to_lowercase();
    let pos = match all.iter().position(|p| p.to_string_lossy().to_lowercase() == wanted) {
        Some(i) => {
            // Replace the lowercase path string with the real one (case matters
            // on Windows). Surrounding items keep their place in the sort.
            all[i] = target.to_path_buf();
            i
        }
        None => {
            all.push(target.to_path_buf());
            all.sort_by(|a, b| by_path(a, b));
            all.iter().position(|p| p.as_path() == target).unwrap_or(0)
        }
    };
    if all.len() > MAX_FILES {
        let start = pos.saturating_sub(MAX_FILES / 2).min(all.len() - MAX_FILES);
        all = all[start..start + MAX_FILES].to_vec();
    }
    all
}

/// Compare two paths by their lowercase string form so traversal order is
/// stable across case differences on Windows.
fn by_path(a: &Path, b: &Path) -> std::cmp::Ordering {
    a.to_string_lossy()
        .to_lowercase()
        .cmp(&b.to_string_lossy().to_lowercase())
}

/// Image paths Windows passed on the command line ("打开方式" / double click).
fn launch_targets() -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .filter(|p| is_media(p) && p.is_file())
        .map(|p| std::path::absolute(&p).unwrap_or(p))
        .filter(|p| seen.insert(p.clone()))
        .collect()
}

fn thumb_pool() -> &'static rayon::ThreadPool {
    static POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();
    POOL.get_or_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(4)
            .thread_name(|i| format!("thumb-{i}"))
            .build()
            .expect("thumb pool")
    })
}

fn cache_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("TEMP"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("Lumina").join("thumbs")
}

fn cache_file(path: &Path, size: u64, modified: f64, width: u32) -> PathBuf {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    size.hash(&mut h);
    modified.to_bits().hash(&mut h);
    width.hash(&mut h);
    cache_dir().join(format!("{:016x}.bin", h.finish()))
}

/// Decode + resize + encode one image. `Ok((kind, bytes))`, kind 0/Err = none.
fn make_thumb(path: &Path, size: u64, modified: f64, target: u32) -> Result<(u8, Vec<u8>), ()> {
    let ext = ext_of(path);
    if !DECODABLE.contains(&ext.as_str()) {
        return Err(());
    }
    let cache = cache_file(path, size, modified, target);
    if let Ok(bytes) = std::fs::read(&cache) {
        let kind = *bytes.first().unwrap_or(&0);
        if kind != 0 {
            return Ok((kind, bytes.into_iter().skip(1).collect()));
        }
    }

    let img = image::open(path).map_err(|_| ())?;
    if (img.width() as u64) * (img.height() as u64) > MAX_PIXELS {
        return Err(());
    }
    let resized = img.resize(target, target, image::imageops::FilterType::Triangle);
    let mut payload: Vec<u8> = Vec::with_capacity(64 * 1024);
    let kind = if resized.has_alpha() {
        use image::codecs::png::PngEncoder;
        resized
            .write_with_encoder(PngEncoder::new(Cursor::new(&mut payload)))
            .map_err(|_| ())?;
        2u8
    } else {
        use image::codecs::jpeg::JpegEncoder;
        resized
            .write_with_encoder(JpegEncoder::new_with_quality(Cursor::new(&mut payload), 82))
            .map_err(|_| ())?;
        1u8
    };

    if let Some(dir) = cache.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = cache.with_extension("tmp");
    let mut file = Vec::with_capacity(payload.len() + 1);
    file.push(kind);
    file.extend_from_slice(&payload);
    if std::fs::write(&tmp, &file).is_ok() {
        let _ = std::fs::rename(&tmp, &cache);
    }
    Ok((kind, payload))
}

fn remember(paths: &[PathBuf], reg: &Registry) {
    if let Ok(mut set) = reg.allowed.lock() {
        set.extend(paths.iter().cloned());
    }
}

fn allowed(reg: &Registry, p: &Path) -> bool {
    reg.allowed.lock().map(|s| s.contains(p)).unwrap_or(false)
}

/* -------------------------------- commands -------------------------------- */

/// Background step after a direct open: the rest of the launched image's
/// folder. The launched image itself is already on screen (injected at
/// window creation), so nothing waits on this.
#[tauri::command]
async fn launch_siblings(reg: State<'_, Shared>, launch: State<'_, Arc<Launch>>) -> Result<LaunchSet, String> {
    let reg = reg.inner().clone();
    let launch = launch.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if launch.targets.len() != 1 {
            return LaunchSet { entries: Vec::new(), selected: 0 };
        }
        let target = launch.targets[0].clone();
        let paths = siblings_of(&target);
        // Header-only probes, in parallel (collect keeps order).
        let mut entries: Vec<Entry> = paths.par_iter().filter_map(|p| describe(p)).collect();
        sort_entries(&mut entries);
        let wanted = target.to_string_lossy();
        let selected = entries.iter().position(|e| e.path == wanted).unwrap_or(0);
        remember(&paths, &reg);
        LaunchSet { entries, selected }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Register files/folders, probe their dimensions in parallel.
#[tauri::command]
async fn import_paths(paths: Vec<String>, reg: State<'_, Shared>) -> Result<Vec<Entry>, String> {
    let reg = reg.inner().clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let inputs: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        let paths = collect_paths(&inputs);
        let mut entries: Vec<Entry> = paths.par_iter().filter_map(|p| describe(p)).collect();
        sort_entries(&mut entries);
        remember(&paths, &reg);
        entries
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(out)
}

/// Packed thumbnail batch — one IPC call per import, never one per file.
/// Record: u32 index, u8 kind, u32 offset, u32 length; then the payload.
#[tauri::command]
async fn thumb_batch(paths: Vec<String>, width: u32, reg: State<'_, Shared>) -> Result<Response, String> {
    let reg = reg.inner().clone();
    let width = width.clamp(64, 1024);
    tauri::async_runtime::spawn_blocking(move || {
        // Keep the caller's indices: filter into (index, path) pairs.
        let checked: Vec<(usize, PathBuf)> = paths
            .iter()
            .enumerate()
            .filter(|(_, p)| allowed(&reg, Path::new(p)))
            .map(|(i, p)| (i, PathBuf::from(p)))
            .collect();

        let made: Vec<(usize, u8, Vec<u8>)> = thumb_pool().install(|| {
            checked
                .par_iter()
                .filter_map(|(idx, p)| {
                    let meta = std::fs::metadata(p).ok()?;
                    let mtime = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as f64)
                        .unwrap_or(0.0);
                    make_thumb(p, meta.len(), mtime, width)
                        .ok()
                        .map(|(kind, bytes)| (*idx, kind, bytes))
                })
                .collect()
        });

        let mut out = Vec::with_capacity(4 + made.len() * 13);
        out.extend_from_slice(&(made.len() as u32).to_le_bytes());
        let mut payload = Vec::new();
        for (idx, kind, bytes) in &made {
            out.extend_from_slice(&(*idx as u32).to_le_bytes());
            out.push(*kind);
            out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            payload.extend_from_slice(bytes);
        }
        out.extend_from_slice(&payload);
        Response::new(out)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Raw file bytes, used only when an edit/export needs same-origin canvas data.
#[tauri::command]
async fn read_image(path: String, reg: State<'_, Shared>) -> Result<Response, String> {
    let reg = reg.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        if !allowed(&reg, &p) {
            return Err("path not allowed".to_string());
        }
        std::fs::read(&p).map(Response::new).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What Windows asked us to open, kept for `launch_siblings`.
struct Launch {
    targets: Vec<PathBuf>,
}

/// Data the page needs for its FIRST render, injected before any page script
/// runs — so an image opened from Explorer is shown immediately, with no
/// welcome screen and no IPC round trip in front of it.
#[derive(Serialize)]
struct Boot {
    entries: Vec<Entry>,
    selected: usize,
    /// true: exactly one image was opened, load its folder in the background.
    siblings: bool,
}

/// 注册 / 默认打开方式相关的命令行开关，双击 exe 时不带任何参数则正常启动窗口。
const CLI_FLAGS: &[&str] = &[
    "--register",
    "--unregister",
    "--set-default",
    "--status",
    "--help",
    "-h",
];

fn run_cli(flag: &str) -> i32 {
    const TITLE: &str = "拾光 · 便携版";

    let result = match flag {
        "--help" | "-h" => Ok(register::help_text()),
        "--register" => std::env::current_exe()
            .map_err(|e| format!("无法定位自身路径：{e}"))
            .and_then(|exe| register::register(&exe)),
        "--unregister" => std::env::current_exe()
            .map_err(|e| format!("无法定位自身路径：{e}"))
            .and_then(|exe| register::unregister(&exe)),
        "--set-default" => std::env::current_exe()
            .map_err(|e| format!("无法定位自身路径：{e}"))
            .and_then(|exe| register::set_default(&exe)),
        "--status" => std::env::current_exe()
            .map_err(|e| format!("无法定位自身路径：{e}"))
            .and_then(|exe| register::status(&exe)),
        other => Err(format!("未知参数：{other}")),
    };

    match result {
        Ok(message) => {
            register::report(TITLE, &message);
            0
        }
        Err(error) => {
            register::report_error(TITLE, &error);
            1
        }
    }
}

fn main() {
    if let Some(flag) = std::env::args().skip(1).find(|arg| CLI_FLAGS.contains(&arg.as_str())) {
        std::process::exit(run_cli(&flag));
    }

    let targets = launch_targets();
    // Only the launched files themselves: metadata + header probe, a few ms.
    let entries: Vec<Entry> = targets.iter().filter_map(|p| describe(p)).collect();
    let registry = Arc::new(Registry::default());
    remember(&targets, &registry);
    let boot = Boot {
        siblings: targets.len() == 1 && !entries.is_empty(),
        entries,
        selected: 0,
    };
    let script = format!(
        "window.__PV_BOOT__ = {};",
        serde_json::to_string(&boot).unwrap_or_else(|_| "null".into())
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(registry)
        .manage(Arc::new(Launch { targets }))
        .setup(move |app| {
            // The window is declared with `create: false, visible: false`:
            // build it here so the boot data is in place before the page loads.
            let conf = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .ok_or("missing window config")?;
            let window = tauri::WebviewWindowBuilder::from_config(app, &conf)?
                .initialization_script(&script)
                .build()?;
            // The page shows the window after its first render (no white
            // flash, no welcome flash). Safety net: never stay hidden.
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                let _ = window.show();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_siblings,
            import_paths,
            thumb_batch,
            read_image,
            shell_menu,
            shell_menu_state,
            assoc_state,
            assoc_set,
            open_default_apps,
            reveal_in_folder,
            set_wallpaper
        ])
        .run(tauri::generate_context!())
        .expect("error while running the photo viewer");
}
