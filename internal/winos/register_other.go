//go:build !windows

// 非 Windows 平台的空实现：只为让整个模块在别的平台也能编译。
// 所有注册表操作在别的平台上都没有意义，统一返回「Windows 专用」错误。
package winos

import (
	"errors"
	"strings"
)

// 图片 / 视频各自共用的 ProgID（与 Windows 版保持一致，方便跨平台代码引用常量）。
const (
	ProgID      = "Lumina.Image"
	VideoProgID = "Lumina.Video"
)

// errNotWindows 是所有平台相关操作在非 Windows 上的统一错误。
var errNotWindows = errors.New("该功能仅在 Windows 上可用")

// Register 在非 Windows 平台不可用。
func Register(exe string) (string, error) { return "", errNotWindows }

// Unregister 在非 Windows 平台不可用。
func Unregister(exe string) (string, error) { return "", errNotWindows }

// SetDefault 在非 Windows 平台不可用。
func SetDefault(exe string) (string, error) { return "", errNotWindows }

// Status 在非 Windows 平台不可用。
func Status(exe string) (string, error) { return "", errNotWindows }

// HelpText 返回与 Windows 版一致的帮助文案（纯字符串，无需注册表）。
func HelpText() string {
	return "拾光 · 便携版\n\n该功能仅在 Windows 上可用。"
}

// Report 在非 Windows 平台只打印到标准输出。
func Report(title, body string) { println(body) }

// ReportError 在非 Windows 平台只打印到标准输出。
func ReportError(title, body string) { println("错误：" + body) }

// ProgIDFor 的映射规则与 Windows 版一致（纯函数，无需注册表）。
func ProgIDFor(ext string) string {
	switch normalizeExt(ext) {
	case "mp4", "m4v", "mov", "webm", "mkv":
		return VideoProgID
	default:
		return ProgID
	}
}

// normalizeExt 去掉前导点并转小写。
func normalizeExt(ext string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(ext), "."))
}

// ShellMenu 在非 Windows 平台不可用。
func ShellMenu(enabled bool) error { return errNotWindows }

// ShellMenuState 在非 Windows 平台恒为 false。
func ShellMenuState() bool { return false }

// AssocState 在非 Windows 平台恒为空。
func AssocState() []string { return nil }

// AssocSet 在非 Windows 平台不可用。
func AssocSet(ext string, enabled bool) error { return errNotWindows }

// OpenDefaultApps 在非 Windows 平台不可用。
func OpenDefaultApps() error { return errNotWindows }

// CommandValue 在非 Windows 平台没有注册表可读，返回空串。
func CommandValue() string { return "" }
