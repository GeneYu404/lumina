//! 便携版（无安装程序）的 Windows 集成：
//! 右键菜单、「打开方式」/ 默认应用列表、以及默认打开方式。
//!
//! 全部只写 `HKEY_CURRENT_USER`，不需要管理员权限，也不碰系统其他位置；
//! `--unregister` 可以把这些内容原样清掉。
//!
//! 关于默认打开方式：Windows 8 之后，用户选定的默认程序保存在受哈希保护的
//! `UserChoice` 里，微软明确要求只能通过系统设置界面修改
//! （见 "Windows app defaults platform" 文档）。因此这里对「还没有用户选择」的
//! 扩展名直接写 `HKCU\Software\Classes\.ext` 生效；对已被占用的扩展名，
//! 用官方支持的 `ms-settings:defaultapps?registeredAppUser=` 深链接跳到设置页，
//! 用户点一次即可。

use std::borrow::Cow;
use std::path::Path;
use std::process::Command;

use winreg::enums::REG_NONE;
use winreg::{RegValue, HKCU};

/// 图片 / 视频各自共用的 ProgID（与 `tauri.conf.json` 的 `fileAssociations` 对齐）。
pub const PROG_ID: &str = "Lumina.Image";
pub const VIDEO_PROG_ID: &str = "Lumina.Video";
/// `HKCU\Software\RegisteredApplications` 下的名称，
/// 同时也是 `ms-settings:defaultapps?registeredAppUser=` 的参数。
pub const REGISTERED_APP: &str = "Lumina Portable";

const CLASSES: &str = r"Software\Classes";
const APP_NAME: &str = "拾光 (便携版)";
const CAPABILITIES_KEY: &str = r"Software\Classes\LuminaPortable";
const MENU_VERB: &str = r"Software\Classes\*\shell\LuminaPortable";
const REGISTERED_APPS: &str = r"Software\RegisteredApplications";
const FILE_EXTS: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts";

/// 与 `tauri.conf.json` 里的 `fileAssociations` 保持一致（图片 + 视频）。
const EXTS: &[&str] = &[
    "jpg", "jpeg", "jfif", "png", "gif", "webp", "avif", "bmp", "ico", "svg", "tif", "tiff",
    "mp4", "m4v", "mov", "webm", "mkv",
];

/// 扩展名 → ProgID（视频单独一个，和安装版的两条 fileAssociations 一一对应）。
fn prog_id_for(ext: &str) -> &'static str {
    match ext {
        "mp4" | "m4v" | "mov" | "webm" | "mkv" => VIDEO_PROG_ID,
        _ => PROG_ID,
    }
}

const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
const GENERIC_WRITE: u32 = 0x4000_0000;
const FILE_SHARE_READ_WRITE: u32 = 0x0000_0003;
const OPEN_EXISTING: u32 = 3;
const INVALID_HANDLE_VALUE: isize = -1;
const STD_OUTPUT_HANDLE: u32 = u32::MAX - 11 + 1;
const STD_ERROR_HANDLE: u32 = u32::MAX - 12 + 1;

const SHCNE_ASSOCCHANGED: u32 = 0x0800_0000;
const SHCNF_IDLIST: u32 = 0x0000;

const MB_OK: u32 = 0x0000_0000;
const MB_ICONWARNING: u32 = 0x0000_0030;
const MB_ICONINFORMATION: u32 = 0x0000_0040;

#[link(name = "shell32")]
extern "system" {
    fn SHChangeNotify(w_event_id: u32, u_flags: u32, dw_item1: usize, dw_item2: usize);
}

#[link(name = "kernel32")]
extern "system" {
    fn AttachConsole(dw_process_id: u32) -> i32;
    fn GetConsoleCP() -> u32;
    fn CreateFileW(
        file_name: *const u16,
        desired_access: u32,
        share_mode: u32,
        security: *mut core::ffi::c_void,
        creation_disposition: u32,
        flags_and_attributes: u32,
        template_file: isize,
    ) -> isize;
    fn SetStdHandle(std_handle: u32, handle: isize) -> i32;
}

#[link(name = "user32")]
extern "system" {
    fn MessageBoxW(owner: usize, text: *const u16, caption: *const u16, kind: u32) -> i32;
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn io_msg(context: &str, error: std::io::Error) -> String {
    format!("{context}：{error}")
}

/// 让 Explorer 重新读取文件关联与右键菜单。
fn notify_shell() {
    unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0) };
}

fn open_command(exe: &Path) -> String {
    format!("\"{}\" \"%1\"", exe.to_string_lossy())
}

fn icon_value(exe: &Path) -> String {
    format!("\"{}\",0", exe.to_string_lossy())
}

fn exe_name(exe: &Path) -> Result<String, String> {
    exe.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| "无法确定可执行文件名".to_string())
}

/// `HKCU\Software\Classes\.ext` 的旧式默认 ProgID（没有 UserChoice 时才生效）。
fn legacy_default(ext: &str) -> Option<String> {
    HKCU.open_subkey(format!(r"{CLASSES}\.{ext}"))
        .ok()?
        .get_value::<String, _>("")
        .ok()
}

/// 用户在设置里选定的 ProgID（Windows 保护，改写会被忽略）。
fn user_choice(ext: &str) -> Option<String> {
    HKCU.open_subkey(format!(r"{FILE_EXTS}\.{ext}\UserChoice"))
        .ok()?
        .get_value::<String, _>("ProgId")
        .ok()
}

/// 写入右键菜单、打开方式、默认应用入口。可重复执行（幂等）。
pub fn register(exe: &Path) -> Result<String, String> {
    let cmd = open_command(exe);
    let icon = icon_value(exe);
    let binary = exe_name(exe)?;

    // 1) ProgID：文件类型的打开命令与图标（图片、视频各建一个）。
    for (id, desc) in [(PROG_ID, "拾光图片"), (VIDEO_PROG_ID, "拾光视频")] {
        let prog = HKCU
            .create_subkey(format!(r"{CLASSES}\{id}"))
            .map_err(|e| io_msg("创建 ProgID 失败", e))?
            .0;
        prog.set_value("", &desc)
            .map_err(|e| io_msg("写入 ProgID 描述失败", e))?;
        prog.set_value("FriendlyTypeName", &desc)
            .map_err(|e| io_msg("写入 FriendlyTypeName 失败", e))?;
        prog.create_subkey("DefaultIcon")
            .map_err(|e| io_msg("创建 DefaultIcon 失败", e))?
            .0
            .set_value("", &icon)
            .map_err(|e| io_msg("写入 DefaultIcon 失败", e))?;
        prog.create_subkey(r"shell\open\command")
            .map_err(|e| io_msg("创建打开命令失败", e))?
            .0
            .set_value("", &cmd)
            .map_err(|e| io_msg("写入打开命令失败", e))?;
    }

    let classes = HKCU
        .open_subkey(CLASSES)
        .map_err(|e| io_msg("打开 Software\\Classes 失败", e))?;

    // 2) 每个扩展名的 OpenWithProgIds：让本程序出现在「打开方式」里。
    for ext in EXTS {
        let key = classes
            .create_subkey(format!(r".{ext}\OpenWithProgIds"))
            .map_err(|e| io_msg(&format!("创建 {ext} OpenWithProgIds 失败"), e))?
            .0;
        key.set_raw_value(
            prog_id_for(ext),
            &RegValue {
                bytes: Cow::Owned(Vec::new()),
                vtype: REG_NONE,
            },
        )
        .map_err(|e| io_msg(&format!("写入 {ext} OpenWithProgIds 失败"), e))?;
    }

    // 3) 「选择其他应用」里按可执行文件列出。
    let app = classes
        .create_subkey(format!(r"Applications\{binary}"))
        .map_err(|e| io_msg("创建 Applications 项失败", e))?
        .0;
    app.set_value("FriendlyAppName", &APP_NAME)
        .map_err(|e| io_msg("写入 FriendlyAppName 失败", e))?;
    app.create_subkey(r"shell\open\command")
        .map_err(|e| io_msg("创建应用打开命令失败", e))?
        .0
        .set_value("", &cmd)
        .map_err(|e| io_msg("写入应用打开命令失败", e))?;
    let supported = app
        .create_subkey("SupportedTypes")
        .map_err(|e| io_msg("创建 SupportedTypes 失败", e))?
        .0;
    for ext in EXTS {
        supported
            .set_value(*ext, &"")
            .map_err(|e| io_msg(&format!("写入 SupportedTypes.{ext} 失败"), e))?;
    }

    // 4) 设置 → 应用 → 默认应用：列出本程序并给出文件类型映射。
    let caps = HKCU
        .create_subkey(CAPABILITIES_KEY)
        .map_err(|e| io_msg("创建 Capabilities 失败", e))?
        .0;
    caps.set_value("ApplicationName", &APP_NAME)
        .map_err(|e| io_msg("写入 ApplicationName 失败", e))?;
    caps.set_value(
        "ApplicationDescription",
        &"Windows 11 风格的图片与视频查看器（便携版，免安装）",
    )
    .map_err(|e| io_msg("写入 ApplicationDescription 失败", e))?;
    let associations = caps
        .create_subkey("FileAssociations")
        .map_err(|e| io_msg("创建 FileAssociations 失败", e))?
        .0;
    for ext in EXTS {
        associations
            .set_value(format!(".{ext}"), &prog_id_for(ext))
            .map_err(|e| io_msg(&format!("写入 FileAssociations .{ext} 失败"), e))?;
    }
    HKCU.create_subkey(REGISTERED_APPS)
        .map_err(|e| io_msg("打开 RegisteredApplications 失败", e))?
        .0
        .set_value(REGISTERED_APP, &CAPABILITIES_KEY)
        .map_err(|e| io_msg("写入 RegisteredApplications 失败", e))?;

    // 5) 右键菜单（Windows 11 下显示在「显示更多选项」里）。
    let menu = HKCU
        .create_subkey(MENU_VERB)
        .map_err(|e| io_msg("创建右键菜单失败", e))?
        .0;
    menu.set_value("MUIVerb", &"用拾光打开")
        .map_err(|e| io_msg("写入右键菜单文字失败", e))?;
    menu.set_value("Icon", &icon)
        .map_err(|e| io_msg("写入右键菜单图标失败", e))?;
    menu.create_subkey("command")
        .map_err(|e| io_msg("创建右键菜单命令失败", e))?
        .0
        .set_value("", &cmd)
        .map_err(|e| io_msg("写入右键菜单命令失败", e))?;

    notify_shell();

    Ok(format!(
        "已注册（当前用户，无需管理员）：\n\n\
         • 右键菜单「用拾光打开」\n\
         • 「打开方式」/「选择其他应用」\n\
         • 设置 → 应用 → 默认应用 中的入口\n\n\
         支持的扩展名：{}\n\n\
         程序路径：{}\n\n\
         注意：exe 移动位置后请重新运行 --register。",
        EXTS.iter().map(|e| format!(".{e}")).collect::<Vec<_>>().join(" "),
        exe.display()
    ))
}

/// 清除本程序写入的所有注册表内容。
pub fn unregister(exe: &Path) -> Result<String, String> {
    let binary = exe_name(exe)?;

    let _ = HKCU.delete_subkey_all(format!(r"{CLASSES}\{PROG_ID}"));
    let _ = HKCU.delete_subkey_all(format!(r"{CLASSES}\{VIDEO_PROG_ID}"));
    let _ = HKCU.delete_subkey_all(MENU_VERB);
    let _ = HKCU.delete_subkey_all(format!(r"{CLASSES}\Applications\{binary}"));
    let _ = HKCU.delete_subkey_all(CAPABILITIES_KEY);
    if let Ok(registered) = HKCU.open_subkey(REGISTERED_APPS) {
        let _ = registered.delete_value(REGISTERED_APP);
    }

    if let Ok(classes) = HKCU.open_subkey(CLASSES) {
        for ext in EXTS {
            if let Ok(owp) = classes.open_subkey(format!(r".{ext}\OpenWithProgIds")) {
                let _ = owp.delete_value(prog_id_for(ext));
            }
            // 按微软建议：默认值已被别的程序改写时不要动它。
            if let Ok(key) = classes.open_subkey(format!(".{ext}")) {
                if let Ok(current) = key.get_value::<String, _>("") {
                    if current == prog_id_for(ext) {
                        let _ = key.delete_value("");
                    }
                }
            }
        }
    }

    notify_shell();

    Ok("已清除本程序写入的注册表项（全部位于 HKEY_CURRENT_USER）。".to_string())
}

/// 注册，并把图片格式设为默认打开方式。
pub fn set_default(exe: &Path) -> Result<String, String> {
    register(exe)?;

    let mut handled: Vec<String> = Vec::new();
    let mut needs_settings: Vec<String> = Vec::new();

    for ext in EXTS {
        match user_choice(ext) {
            // 用户已经选了本程序。
            Some(current) if current == prog_id_for(ext) => handled.push(format!(".{ext}")),
            // UserChoice 受保护，只能在设置里改。
            Some(_) => needs_settings.push(format!(".{ext}")),
            None => {
                // 没有 UserChoice 时，旧式默认值仍然生效。
                let key = HKCU
                    .create_subkey(format!(r"{CLASSES}\.{ext}"))
                    .map_err(|e| io_msg(&format!("创建 .{ext} 失败"), e))?
                    .0;
                key.set_value("", &prog_id_for(ext))
                    .map_err(|e| io_msg(&format!("设置 .{ext} 默认值失败"), e))?;
                handled.push(format!(".{ext}"));
            }
        }
    }

    notify_shell();

    let mut message = String::new();
    if !handled.is_empty() {
        message.push_str(&format!(
            "已设为默认打开方式：\n{}\n\n",
            handled.join(" ")
        ));
    }
    if !needs_settings.is_empty() {
        message.push_str(&format!(
            "以下扩展名已被 Windows 的 UserChoice 保护，需要在设置里点一次确认：\n{}\n\n\
             已打开「默认应用」设置页，请点击「{}」完成选择。\n\
             （Windows 10/11 禁止第三方程序直接改写用户的选择，这是官方支持的路径）",
            needs_settings.join(" "),
            APP_NAME
        ));
        open_default_apps_settings();
    }

    Ok(message)
}

/// 打开 设置 → 应用 → 默认应用，并直接定位到本程序。
fn open_default_apps_settings() {
    let uri = format!(
        "ms-settings:defaultapps?registeredAppUser={}",
        REGISTERED_APP.replace(' ', "%20")
    );
    let _ = Command::new("cmd").args(["/c", "start", ""]).arg(uri).spawn();
}

/// 当前注册状态与各扩展名的默认打开方式。
pub fn status(exe: &Path) -> Result<String, String> {
    let has_menu = HKCU.open_subkey(MENU_VERB).is_ok();
    let has_progid = HKCU.open_subkey(format!(r"{CLASSES}\{PROG_ID}")).is_ok();
    let has_entry = HKCU
        .open_subkey(REGISTERED_APPS)
        .map(|key| key.get_value::<String, _>(REGISTERED_APP).is_ok())
        .unwrap_or(false);

    let mut lines = vec![
        format!("程序路径：{}", exe.display()),
        format!("右键菜单：{}", mark(has_menu)),
        format!("ProgID / 打开命令：{}", mark(has_progid)),
        format!("默认应用入口：{}", mark(has_entry)),
        String::new(),
        "各扩展名的默认打开方式：".to_string(),
    ];

    for ext in EXTS {
        let state = match user_choice(ext) {
            Some(current) if current == prog_id_for(ext) => "拾光（设置已确认）".to_string(),
            Some(current) => format!("其他程序（{current}）"),
            None => match legacy_default(ext) {
                Some(current) if current == prog_id_for(ext) => "拾光".to_string(),
                Some(current) => format!("其他程序（{current}）"),
                None => "未指定".to_string(),
            },
        };
        lines.push(format!("  .{ext:<6} {state}"));
    }

    Ok(lines.join("\n"))
}

fn mark(ok: bool) -> &'static str {
    if ok {
        "已注册"
    } else {
        "未注册"
    }
}

pub fn help_text() -> String {
    format!(
        "拾光 · 便携版\n\n\
         lumina.exe               启动程序\n\
         lumina.exe <图片路径>     打开指定图片（含同目录其他图片）\n\
         lumina.exe --register     注册右键菜单 / 打开方式 / 默认应用入口\n\
         lumina.exe --set-default  注册并把图片格式设为默认打开方式\n\
         lumina.exe --status       查看当前注册状态\n\
         lumina.exe --unregister   清除以上注册表项\n\
         lumina.exe --help         显示本帮助\n\n\
         所有注册表内容都写在 HKEY_CURRENT_USER 下，无需管理员权限。\n\
         ProgID：{PROG_ID} / {VIDEO_PROG_ID}    注册名：{REGISTERED_APP}"
    )
}

/// 汇总输出：有控制台就打印到控制台，否则弹消息框。
pub fn report(title: &str, body: &str) {
    match output_target() {
        OutputTarget::Console => println!("{body}"),
        OutputTarget::Stream => println!("{body}"),
        OutputTarget::Message => show_message(title, body, MB_ICONINFORMATION),
    }
}

pub fn report_error(title: &str, body: &str) {
    match output_target() {
        OutputTarget::Console => eprintln!("{body}"),
        OutputTarget::Stream => println!("错误：{body}"),
        OutputTarget::Message => show_message(title, body, MB_ICONWARNING),
    }
}

enum OutputTarget {
    /// 自带或附加到的控制台。
    Console,
    /// 父进程（终端 / CI）已经把标准输出重定向成管道。
    Stream,
    /// 双击运行：没有控制台，用消息框。
    Message,
}

const FILE_TYPE_UNKNOWN: u32 = 0x0000_0000;

#[link(name = "kernel32")]
extern "system" {
    fn GetStdHandle(std_handle: u32) -> isize;
    fn GetFileType(handle: isize) -> u32;
}

fn show_message(title: &str, body: &str, kind: u32) {
    let text = wide(body);
    let caption = wide(title);
    unsafe {
        MessageBoxW(0, text.as_ptr(), caption.as_ptr(), MB_OK | kind);
    }
}

fn output_target() -> OutputTarget {
    unsafe {
        if GetConsoleCP() != 0 {
            return OutputTarget::Console;
        }
        // 终端 / CI 场景：标准输出已经是管道，直接写它。
        let handle = GetStdHandle(STD_OUTPUT_HANDLE);
        if handle != 0
            && handle != INVALID_HANDLE_VALUE
            && GetFileType(handle) != FILE_TYPE_UNKNOWN
        {
            return OutputTarget::Stream;
        }
        if attach_parent_console() {
            return OutputTarget::Console;
        }
        OutputTarget::Message
    }
}

/// 附加到父进程控制台（本程序是 GUI 子系统，双击运行时没有控制台）。
fn attach_parent_console() -> bool {
    unsafe {
        if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            return false;
        }
        let console = wide("CONOUT$");
        let handle = CreateFileW(
            console.as_ptr(),
            GENERIC_WRITE,
            FILE_SHARE_READ_WRITE,
            core::ptr::null_mut(),
            OPEN_EXISTING,
            0,
            0,
        );
        if handle == INVALID_HANDLE_VALUE {
            return false;
        }
        SetStdHandle(STD_OUTPUT_HANDLE, handle);
        SetStdHandle(STD_ERROR_HANDLE, handle);
        true
    }
}
