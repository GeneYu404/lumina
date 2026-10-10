//go:build windows

// 便携版（无安装程序）的 Windows 集成：
// 右键菜单、「打开方式」/ 默认应用列表、以及默认打开方式。
//
// 全部只写 HKEY_CURRENT_USER，不需要管理员权限，也不碰系统其他位置；
// Unregister 可以把这些内容原样清掉。
//
// 关于默认打开方式：Windows 8 之后，用户选定的默认程序保存在受哈希保护的
// UserChoice 里，微软明确要求只能通过系统设置界面修改
// （见 "Windows app defaults platform" 文档）。因此这里对「还没有用户选择」的
// 扩展名直接写 HKCU\Software\Classes\.ext 生效；对已被占用的扩展名，
// 用官方支持的 ms-settings:defaultapps?registeredAppUser= 深链接跳到设置页，
// 用户点一次即可。
//
// 与最初的 Tauri + Rust 外壳逐函数对照移植；原始实现见 git 历史
// （`git log --diff-filter=D -- src-tauri/src/register.rs`）。
package winos

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// 图片 / 视频各自共用的 ProgID（与 mygo.config.ts 的 fileAssociations 对齐）。
const (
	ProgID      = "Lumina.Image"
	VideoProgID = "Lumina.Video"
)

// registeredApp 是 HKCU\Software\RegisteredApplications 下的名称，
// 同时也是 ms-settings:defaultapps?registeredAppUser= 的参数。
const registeredApp = "Lumina Portable"

const (
	classes         = `Software\Classes`
	appName         = "拾光 (便携版)"
	capabilitiesKey = `Software\Classes\LuminaPortable`
	menuVerb        = `Software\Classes\*\shell\LuminaPortable`
	registeredApps  = `Software\RegisteredApplications`
	fileExts        = `Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts`
)

// exts 与 mygo.config.ts 里的 fileAssociations 保持一致（图片 + 视频）。
var exts = []string{
	"jpg", "jpeg", "jfif", "png", "gif", "webp", "avif", "bmp", "ico", "svg", "tif", "tiff",
	"mp4", "m4v", "mov", "webm", "mkv",
}

// ProgIDFor 按扩展名返回 ProgID：视频扩展名用 VideoProgID，其余用 ProgID。
// 前导点可有可无，大小写不敏感。
func ProgIDFor(ext string) string {
	switch normalizeExt(ext) {
	case "mp4", "m4v", "mov", "webm", "mkv":
		return VideoProgID
	default:
		return ProgID
	}
}

// normalizeExt 去掉前导点并转小写，方便 ".JPG" / "jpg" 两种写法。
func normalizeExt(ext string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(ext), "."))
}

// ---------------------------------------------------------------------------
// 纯函数小工具
// ---------------------------------------------------------------------------

// openCommand 是写进注册表的打开命令行："<exe>" "%1"。
// %1 由 Explorer 替换成用户选中的文件/文件夹路径。
func openCommand(exe string) string {
	return fmt.Sprintf(`"%s" "%%1"`, exe)
}

// iconValue 是图标字符串："<exe>",0（逗号后的 0 表示默认图标索引）。
func iconValue(exe string) string {
	return fmt.Sprintf(`"%s",0`, exe)
}

// exeName 取可执行文件名（注册表里用作 Applications 下的键名）。
func exeName(exe string) (string, error) {
	clean := strings.TrimRight(exe, `/\`)
	if clean == "" {
		return "", errors.New("无法确定可执行文件名")
	}
	name := filepath.Base(clean)
	if name == "" || name == "." || name == ".." {
		return "", errors.New("无法确定可执行文件名")
	}
	return name, nil
}

// legacyDefault 读 HKCU\Software\Classes\.ext 的旧式默认 ProgID
// （只有当 UserChoice 不存在时才生效）。
func legacyDefault(ext string) (string, bool) {
	k, err := registry.OpenKey(registry.CURRENT_USER, classes+`\.`+ext, registry.QUERY_VALUE)
	if err != nil {
		return "", false
	}
	defer k.Close()
	// "" 表示子键的默认值。
	v, _, err := k.GetStringValue("")
	if err != nil {
		return "", false
	}
	return v, true
}

// userChoice 读用户在设置里选定的 ProgID（Windows 加了哈希保护，改写会被忽略）。
func userChoice(ext string) (string, bool) {
	k, err := registry.OpenKey(registry.CURRENT_USER, fileExts+`\.`+ext+`\UserChoice`, registry.QUERY_VALUE)
	if err != nil {
		return "", false
	}
	defer k.Close()
	v, _, err := k.GetStringValue("ProgId")
	if err != nil {
		return "", false
	}
	return v, true
}

// CommandValue 返回注册表里实际写下的打开命令行（未注册时返回空串）。
func CommandValue() string {
	k, err := registry.OpenKey(registry.CURRENT_USER, classes+`\`+ProgID+`\shell\open\command`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, err := k.GetStringValue("")
	if err != nil {
		return ""
	}
	return v
}

// ---------------------------------------------------------------------------
// 注册表读写封装
// ---------------------------------------------------------------------------

// wrapErr 给底层错误加上面向用户的中文上下文（前端会直接显示这段文案）。
func wrapErr(context string, err error) error {
	return fmt.Errorf("%s：%w", context, err)
}

// createSub 在 root 下创建子键（缺失的中间层会一并创建），返回的句柄由调用方关闭。
func createSub(root registry.Key, path string) (registry.Key, error) {
	k, _, err := registry.CreateKey(root, path, registry.ALL_ACCESS)
	return k, err
}

// openSub 只读地打开子键。
func openSub(path string) (registry.Key, error) {
	return registry.OpenKey(registry.CURRENT_USER, path, registry.QUERY_VALUE)
}

// setString 写 REG_SZ；失败必须返回错误，不能吞掉。
func setString(k registry.Key, name, value, context string) error {
	if err := k.SetStringValue(name, value); err != nil {
		return wrapErr(context, err)
	}
	return nil
}

// hasValue 判断键里是否存在某个值（不看类型），
// OpenWithProgIds 里的值是 REG_NONE，用 GetStringValue 会报类型错误。
func hasValue(k registry.Key, name string) bool {
	_, _, err := k.GetValue(name, nil)
	return err == nil
}

// x/sys/windows 没有封装下面几个 API，用 LazyDLL 直接声明（纯 Go，无 cgo）。
var (
	advapi32          = syscall.NewLazyDLL("advapi32.dll")
	shell32           = syscall.NewLazyDLL("shell32.dll")
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procRegSetValueEx = advapi32.NewProc("RegSetValueExW")
	procRegDeleteTree = advapi32.NewProc("RegDeleteTreeW")
	procSHChangeNotif = shell32.NewProc("SHChangeNotify")
	procAttachConsole = kernel32.NewProc("AttachConsole")
)

// setNoneValue 写一个零长度的 REG_NONE 值 —— 这是 Windows 在
// OpenWithProgIds 下登记 ProgID 的约定（只登记「存在」，不存数据）。
func setNoneValue(k registry.Key, name string) error {
	p, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	ret, _, _ := procRegSetValueEx.Call(
		uintptr(k),
		uintptr(unsafe.Pointer(p)),
		0, // Reserved
		uintptr(registry.NONE),
		0, // 零长度数据
		0,
	)
	if ret != 0 {
		return syscall.Errno(ret)
	}
	return nil
}

// deleteTree 连同所有子键一起删除（等价于 Rust 的 delete_subkey_all）。
// 只用于本程序自己写过的键。
func deleteTree(path string) error {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	ret, _, _ := procRegDeleteTree.Call(uintptr(registry.CURRENT_USER), uintptr(unsafe.Pointer(p)))
	if ret != 0 {
		return syscall.Errno(ret)
	}
	return nil
}

const (
	shcneAssocChanged = 0x08000000
	shcnfIDList       = 0x0000
)

// notifyShell 让 Explorer 重新读取文件关联与右键菜单（否则菜单要重启资源管理器才刷新）。
func notifyShell() {
	_, _, _ = procSHChangeNotif.Call(shcneAssocChanged, shcnfIDList, 0, 0)
}

// ---------------------------------------------------------------------------
// 注册 / 注销
// ---------------------------------------------------------------------------

// Register 写入右键菜单、打开方式、默认应用入口。可重复执行（幂等）。
func Register(exe string) (string, error) {
	cmd := openCommand(exe)
	icon := iconValue(exe)
	binary, err := exeName(exe)
	if err != nil {
		return "", err
	}

	// 1) ProgID：文件类型的打开命令与图标（图片、视频各建一个）。
	for _, prog := range []struct{ id, desc string }{
		{ProgID, "拾光图片"},
		{VideoProgID, "拾光视频"},
	} {
		if err := writeProgID(prog.id, prog.desc, icon, cmd); err != nil {
			return "", err
		}
	}

	classesKey, err := openSub(classes)
	if err != nil {
		return "", wrapErr("打开 Software\\Classes 失败", err)
	}
	defer classesKey.Close()

	// 2) 每个扩展名的 OpenWithProgIds：让本程序出现在「打开方式」里。
	for _, ext := range exts {
		if err := writeOpenWithProgID(classesKey, ext); err != nil {
			return "", err
		}
	}

	// 3) 「选择其他应用」里按可执行文件列出。
	if err := writeApplicationsEntry(classesKey, binary, cmd); err != nil {
		return "", err
	}

	// 4) 设置 → 应用 → 默认应用：列出本程序并给出文件类型映射。
	if err := writeCapabilities(); err != nil {
		return "", err
	}

	// 5) 右键菜单（Windows 11 下显示在「显示更多选项」里）。
	if err := writeShellMenu(icon, cmd); err != nil {
		return "", err
	}

	notifyShell()

	var dotted []string
	for _, e := range exts {
		dotted = append(dotted, "."+e)
	}

	return fmt.Sprintf(`已注册（当前用户，无需管理员）：

• 右键菜单「用拾光打开」
• 「打开方式」/「选择其他应用」
• 设置 → 应用 → 默认应用 中的入口

支持的扩展名：%s

程序路径：%s

注意：exe 移动位置后请重新运行 --register。`, strings.Join(dotted, " "), exe), nil
}

// writeProgID 写一个 ProgID 下的全部内容：描述、图标、打开命令。
func writeProgID(id, desc, icon, cmd string) error {
	prog, err := createSub(registry.CURRENT_USER, classes+`\`+id)
	if err != nil {
		return wrapErr("创建 ProgID 失败", err)
	}
	defer prog.Close()

	if err := setString(prog, "", desc, "写入 ProgID 描述失败"); err != nil {
		return err
	}
	if err := setString(prog, "FriendlyTypeName", desc, "写入 FriendlyTypeName 失败"); err != nil {
		return err
	}

	iconKey, err := createSub(prog, `DefaultIcon`)
	if err != nil {
		return wrapErr("创建 DefaultIcon 失败", err)
	}
	defer iconKey.Close()
	if err := setString(iconKey, "", icon, "写入 DefaultIcon 失败"); err != nil {
		return err
	}

	cmdKey, err := createSub(prog, `shell\open\command`)
	if err != nil {
		return wrapErr("创建打开命令失败", err)
	}
	defer cmdKey.Close()
	return setString(cmdKey, "", cmd, "写入打开命令失败")
}

// writeOpenWithProgID 在 .ext\OpenWithProgIds 下登记本程序的 ProgID。
func writeOpenWithProgID(classesKey registry.Key, ext string) error {
	id := ProgIDFor(ext)
	key, err := createSub(classesKey, "."+ext+`\OpenWithProgIds`)
	if err != nil {
		return wrapErr(fmt.Sprintf("创建 %s OpenWithProgIds 失败", ext), err)
	}
	defer key.Close()
	if err := setNoneValue(key, id); err != nil {
		return wrapErr(fmt.Sprintf("写入 %s OpenWithProgIds 失败", ext), err)
	}
	return nil
}

// writeApplicationsEntry 写 Applications\<exe>：「选择其他应用」按可执行文件列出程序。
func writeApplicationsEntry(classesKey registry.Key, binary, cmd string) error {
	app, err := createSub(classesKey, `Applications\`+binary)
	if err != nil {
		return wrapErr("创建 Applications 项失败", err)
	}
	defer app.Close()

	if err := setString(app, "FriendlyAppName", appName, "写入 FriendlyAppName 失败"); err != nil {
		return err
	}

	cmdKey, err := createSub(app, `shell\open\command`)
	if err != nil {
		return wrapErr("创建应用打开命令失败", err)
	}
	defer cmdKey.Close()
	if err := setString(cmdKey, "", cmd, "写入应用打开命令失败"); err != nil {
		return err
	}

	supported, err := createSub(app, `SupportedTypes`)
	if err != nil {
		return wrapErr("创建 SupportedTypes 失败", err)
	}
	defer supported.Close()
	for _, ext := range exts {
		if err := setString(supported, ext, "", fmt.Sprintf("写入 SupportedTypes.%s 失败", ext)); err != nil {
			return err
		}
	}
	return nil
}

// writeCapabilities 写「设置 → 应用 → 默认应用」里的程序条目与文件类型映射。
func writeCapabilities() error {
	caps, err := createSub(registry.CURRENT_USER, capabilitiesKey)
	if err != nil {
		return wrapErr("创建 Capabilities 失败", err)
	}
	defer caps.Close()

	if err := setString(caps, "ApplicationName", appName, "写入 ApplicationName 失败"); err != nil {
		return err
	}
	desc := "Windows 11 风格的图片与视频查看器（便携版，免安装）"
	if err := setString(caps, "ApplicationDescription", desc, "写入 ApplicationDescription 失败"); err != nil {
		return err
	}

	assoc, err := createSub(caps, `FileAssociations`)
	if err != nil {
		return wrapErr("创建 FileAssociations 失败", err)
	}
	defer assoc.Close()
	for _, ext := range exts {
		if err := setString(assoc, "."+ext, ProgIDFor(ext), fmt.Sprintf("写入 FileAssociations .%s 失败", ext)); err != nil {
			return err
		}
	}

	apps, err := createSub(registry.CURRENT_USER, registeredApps)
	if err != nil {
		return wrapErr("打开 RegisteredApplications 失败", err)
	}
	defer apps.Close()
	return setString(apps, registeredApp, capabilitiesKey, "写入 RegisteredApplications 失败")
}

// writeShellMenu 写资源管理器右键菜单项。
func writeShellMenu(icon, cmd string) error {
	menu, err := createSub(registry.CURRENT_USER, menuVerb)
	if err != nil {
		return wrapErr("创建右键菜单失败", err)
	}
	defer menu.Close()

	if err := setString(menu, "MUIVerb", "用拾光打开", "写入右键菜单文字失败"); err != nil {
		return err
	}
	if err := setString(menu, "Icon", icon, "写入右键菜单图标失败"); err != nil {
		return err
	}

	cmdKey, err := createSub(menu, `command`)
	if err != nil {
		return wrapErr("创建右键菜单命令失败", err)
	}
	defer cmdKey.Close()
	return setString(cmdKey, "", cmd, "写入右键菜单命令失败")
}

// Unregister 清除本程序写入的所有注册表内容。
func Unregister(exe string) (string, error) {
	binary, err := exeName(exe)
	if err != nil {
		return "", err
	}

	// 以下键全部是本程序自己创建的，整棵删掉即可；
	// 删不存在的键不算失败（和 Rust 版一样忽略错误）。
	_ = deleteTree(classes + `\` + ProgID)
	_ = deleteTree(classes + `\` + VideoProgID)
	_ = deleteTree(menuVerb)
	_ = deleteTree(classes + `\Applications\` + binary)
	_ = deleteTree(capabilitiesKey)
	if registered, err := openSub(registeredApps); err == nil {
		_ = registered.DeleteValue(registeredApp)
		registered.Close()
	}

	// 扩展名下面可能还有别的程序写的内容，只删属于本程序 ProgID 的那一个值。
	if classesKey, err := openSub(classes); err == nil {
		for _, ext := range exts {
			if owp, err := registry.OpenKey(classesKey, "."+ext+`\OpenWithProgIds`, registry.QUERY_VALUE); err == nil {
				_ = owp.DeleteValue(ProgIDFor(ext))
				owp.Close()
			}
			// 按微软建议：默认值已被别的程序改写时不要动它。
			if key, err := registry.OpenKey(classesKey, "."+ext, registry.QUERY_VALUE); err == nil {
				if current, _, err := key.GetStringValue(""); err == nil && current == ProgIDFor(ext) {
					_ = key.DeleteValue("")
				}
				key.Close()
			}
		}
		classesKey.Close()
	}

	notifyShell()

	return "已清除本程序写入的注册表项（全部位于 HKEY_CURRENT_USER）。", nil
}

// SetDefault 注册，并把图片格式设为默认打开方式。
func SetDefault(exe string) (string, error) {
	if _, err := Register(exe); err != nil {
		return "", err
	}

	var handled []string
	var needsSettings []string

	for _, ext := range exts {
		id := ProgIDFor(ext)
		current, hasChoice := userChoice(ext)
		switch {
		case hasChoice && current == id:
			// 用户已经选了本程序。
			handled = append(handled, "."+ext)
		case hasChoice:
			// UserChoice 受保护，只能在设置里改。
			needsSettings = append(needsSettings, "."+ext)
		default:
			// 没有 UserChoice 时，旧式默认值仍然生效，直接写 HKCU\Software\Classes\.ext。
			key, err := createSub(registry.CURRENT_USER, classes+`\.`+ext)
			if err != nil {
				return "", wrapErr(fmt.Sprintf("创建 .%s 失败", ext), err)
			}
			err = setString(key, "", id, fmt.Sprintf("设置 .%s 默认值失败", ext))
			key.Close()
			if err != nil {
				return "", err
			}
			handled = append(handled, "."+ext)
		}
	}

	notifyShell()

	var sb strings.Builder
	if len(handled) > 0 {
		fmt.Fprintf(&sb, "已设为默认打开方式：\n%s\n\n", strings.Join(handled, " "))
	}
	if len(needsSettings) > 0 {
		fmt.Fprintf(&sb, `以下扩展名已被 Windows 的 UserChoice 保护，需要在设置里点一次确认：
%s

已打开「默认应用」设置页，请点击「%s」完成选择。
（Windows 10/11 禁止第三方程序直接改写用户的选择，这是官方支持的路径）`,
			strings.Join(needsSettings, " "), appName)
		_ = OpenDefaultApps()
	}

	return sb.String(), nil
}

// OpenDefaultApps 打开 设置 → 应用 → 默认应用，并直接定位到本程序。
func OpenDefaultApps() error {
	uri := fmt.Sprintf("ms-settings:defaultapps?registeredAppUser=%s",
		strings.ReplaceAll(registeredApp, " ", "%20"))
	// start 后面的空串是窗口标题占位，必须带上，否则带空格的参数会被 start 吃掉。
	if err := exec.Command("cmd", "/c", "start", "", uri).Start(); err != nil {
		return wrapErr("打开「默认应用」设置页失败", err)
	}
	return nil
}

// Status 返回当前注册状态与各扩展名的默认打开方式（多行文本）。
func Status(exe string) (string, error) {
	hasMenu := keyExists(menuVerb)
	hasProgID := keyExists(classes + `\` + ProgID)
	hasEntry := false
	if apps, err := openSub(registeredApps); err == nil {
		_, _, err = apps.GetStringValue(registeredApp)
		hasEntry = err == nil
		apps.Close()
	}

	lines := []string{
		"程序路径：" + exe,
		"右键菜单：" + mark(hasMenu),
		"ProgID / 打开命令：" + mark(hasProgID),
		"默认应用入口：" + mark(hasEntry),
		"",
		"各扩展名的默认打开方式：",
	}

	for _, ext := range exts {
		id := ProgIDFor(ext)
		var state string
		if current, ok := userChoice(ext); ok {
			if current == id {
				state = "拾光（设置已确认）"
			} else {
				state = fmt.Sprintf("其他程序（%s）", current)
			}
		} else if current, ok := legacyDefault(ext); ok {
			if current == id {
				state = "拾光"
			} else {
				state = fmt.Sprintf("其他程序（%s）", current)
			}
		} else {
			state = "未指定"
		}
		lines = append(lines, fmt.Sprintf("  .%-6s %s", ext, state))
	}

	return strings.Join(lines, "\n"), nil
}

// keyExists 只判断键是否存在，不写任何东西。
func keyExists(path string) bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, path, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	k.Close()
	return true
}

func mark(ok bool) string {
	if ok {
		return "已注册"
	}
	return "未注册"
}

// HelpText 是 `Lumina.exe --help` 的输出。名字取 mygo.config.ts 里的
// `name`，即打包出来的 Lumina.exe —— 旧 Rust 版叫 lumina.exe。
func HelpText() string {
	return strings.Join([]string{
		"拾光 · 便携版",
		"",
		"Lumina.exe               启动程序",
		"Lumina.exe <图片路径>     打开指定图片（含同目录其他图片）",
		"Lumina.exe --register     注册右键菜单 / 打开方式 / 默认应用入口",
		"Lumina.exe --set-default  注册并把图片格式设为默认打开方式",
		"Lumina.exe --status       查看当前注册状态",
		"Lumina.exe --unregister   清除以上注册表项",
		"Lumina.exe --help         显示本帮助",
		"",
		"所有注册表内容都写在 HKEY_CURRENT_USER 下，无需管理员权限。",
		fmt.Sprintf("ProgID：%s / %s    注册名：%s", ProgID, VideoProgID, registeredApp),
	}, "\n")
}

// ---------------------------------------------------------------------------
// 前端可调用的开关：右键菜单 / 单个扩展名的关联
// ---------------------------------------------------------------------------

// ShellMenu 打开或关闭资源管理器右键菜单项（写入用当前 exe 路径）。
func ShellMenu(enabled bool) error {
	if !enabled {
		_ = deleteTree(menuVerb)
		notifyShell()
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return wrapErr("无法确定程序路径", err)
	}
	if err := writeShellMenu(iconValue(exe), openCommand(exe)); err != nil {
		return err
	}
	notifyShell()
	return nil
}

// ShellMenuState 报告右键菜单项当前是否存在。
func ShellMenuState() bool {
	return keyExists(menuVerb)
}

// AssocState 返回当前已登记文件关联的扩展名（带点，如 ".jpg"）。
func AssocState() []string {
	var on []string
	for _, ext := range exts {
		key, err := openSub(classes + `\.` + ext + `\OpenWithProgIds`)
		if err != nil {
			continue
		}
		registered := hasValue(key, ProgIDFor(ext))
		key.Close()
		if registered {
			on = append(on, "."+ext)
		}
	}
	return on
}

// AssocSet 打开或关闭单个扩展名的文件关联入口。
// 关闭时只删本程序写下的值：默认值若已被别的程序改写，绝不动它。
func AssocSet(ext string, enabled bool) error {
	name := normalizeExt(ext)
	if name == "" {
		return errors.New("扩展名不能为空")
	}
	if !isSupportedExt(name) {
		return fmt.Errorf("不支持的扩展名 .%s", name)
	}
	id := ProgIDFor(name)

	owpPath := "." + name + `\OpenWithProgIds`
	if enabled {
		key, err := createSub(registry.CURRENT_USER, classes+`\`+owpPath)
		if err != nil {
			return wrapErr(fmt.Sprintf("创建 %s OpenWithProgIds 失败", name), err)
		}
		err = setNoneValue(key, id)
		key.Close()
		if err != nil {
			return wrapErr(fmt.Sprintf("写入 %s OpenWithProgIds 失败", name), err)
		}

		assoc, err := createSub(registry.CURRENT_USER, capabilitiesKey+`\FileAssociations`)
		if err != nil {
			return wrapErr("创建 FileAssociations 失败", err)
		}
		err = setString(assoc, "."+name, id, fmt.Sprintf("写入 FileAssociations .%s 失败", name))
		assoc.Close()
		if err != nil {
			return err
		}
	} else {
		if key, err := openSub(classes + `\` + owpPath); err == nil {
			_ = key.DeleteValue(id)
			key.Close()
		}
		if assoc, err := openSub(capabilitiesKey + `\FileAssociations`); err == nil {
			if current, _, err := assoc.GetStringValue("." + name); err == nil && current == id {
				_ = assoc.DeleteValue("." + name)
			}
			assoc.Close()
		}
	}

	notifyShell()
	return nil
}

// isSupportedExt 判断扩展名是否在受支持的列表里（避免写进无关的键）。
func isSupportedExt(ext string) bool {
	for _, e := range exts {
		if e == ext {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// 输出：控制台 / 管道 / 消息框
// ---------------------------------------------------------------------------

const (
	mbOK              = 0x00000000
	mbIconWarning     = 0x00000030
	mbIconInformation = 0x00000040
)

func showMessage(title, body string, kind uint32) {
	text, err := windows.UTF16PtrFromString(body)
	if err != nil {
		return
	}
	caption, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	_, _ = windows.MessageBox(0, text, caption, mbOK|kind)
}

type outputKind int

const (
	// 自带或附加到的控制台。
	outputConsole outputKind = iota
	// 父进程（终端 / CI）已经把标准输出重定向成管道。
	outputStream
	// 双击运行：没有控制台，用消息框。
	outputMessage
)

// output 是最终选定的输出通道：控制台 / 管道写 writer，消息框只看标题与正文。
type output struct {
	kind outputKind
	out  io.Writer // 正常输出（控制台或管道）
	err  io.Writer // 错误输出（仅控制台通道使用）
}

// Report 汇总输出：有控制台就打印到控制台，否则弹消息框。
func Report(title, body string) {
	out := outputTarget()
	if out.kind == outputMessage {
		showMessage(title, body, mbIconInformation)
		return
	}
	fmt.Fprintln(out.out, body)
}

// ReportError 同 Report，但走错误通道。
func ReportError(title, body string) {
	out := outputTarget()
	switch out.kind {
	case outputConsole:
		fmt.Fprintln(out.err, body)
	case outputStream:
		fmt.Fprintln(out.out, "错误："+body)
	case outputMessage:
		showMessage(title, body, mbIconWarning)
	}
}

const (
	attachParentProcess = ^uint32(0) // (DWORD)-1
	fileTypeUnknown     = 0x00000000
)

// outputTarget 决定文字往哪里送。
func outputTarget() output {
	if _, err := windows.GetConsoleCP(); err == nil {
		return output{kind: outputConsole, out: os.Stdout, err: os.Stderr}
	}
	// 终端 / CI 场景：标准输出已经是管道，直接写它。
	if handle, err := windows.GetStdHandle(windows.STD_OUTPUT_HANDLE); err == nil &&
		handle != 0 && handle != windows.InvalidHandle {
		if kind, _ := windows.GetFileType(handle); kind != fileTypeUnknown {
			return output{kind: outputStream, out: os.Stdout, err: os.Stderr}
		}
	}
	if handle, ok := attachParentConsole(); ok {
		return output{kind: outputConsole, out: handle, err: handle}
	}
	return output{kind: outputMessage}
}

// attachParentConsole 附加到父进程控制台（本程序是 GUI 子系统，双击运行时没有控制台）。
// 返回的 writer 是重新打开的 CONOUT$，直接用它写 —— Go 的 os.Stdout 在进程启动时
// 就已固化，光调 SetStdHandle 改不动它。
func attachParentConsole() (io.Writer, bool) {
	ret, _, _ := procAttachConsole.Call(uintptr(attachParentProcess))
	if ret == 0 {
		return nil, false
	}
	name, err := windows.UTF16PtrFromString("CONOUT$")
	if err != nil {
		return nil, false
	}
	handle, err := windows.CreateFile(
		name,
		windows.GENERIC_WRITE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE,
		nil,
		windows.OPEN_EXISTING,
		0,
		0,
	)
	if err != nil || handle == windows.InvalidHandle {
		return nil, false
	}
	// 同时重设子进程继承的标准句柄。
	_ = windows.SetStdHandle(windows.STD_OUTPUT_HANDLE, handle)
	_ = windows.SetStdHandle(windows.STD_ERROR_HANDLE, handle)
	return os.NewFile(uintptr(handle), "CONOUT$"), true
}
