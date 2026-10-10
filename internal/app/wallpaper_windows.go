//go:build windows

package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows/registry"
)

const (
	// SPI_SETDESKWALLPAPER tells the shell to load a new wallpaper.
	spiSetDesktopWallpaper = 20
	// SPIF_UPDATEINIFILE writes the setting to the user profile;
	// SPIF_SENDCHANGE broadcasts the change to every window.
	spiUpdateIniFile = 0x01
	spiSendChange    = 0x02
)

var (
	user32              = syscall.NewLazyDLL("user32.dll")
	procSystemParamInfo = user32.NewProc("SystemParametersInfoW")
)

// SetWallpaper sets the desktop wallpaper: copy the file to a stable folder,
// pick the style in the registry, then ask Windows to reload it.
//
// Copying matters — the original may live in a folder the user later moves,
// renames or deletes, and a wallpaper that points at a dead path comes back
// as a black desktop.
func (l *Lumina) SetWallpaper(path string, style string) error {
	if !l.allowedOne(path) {
		return errPathNotAllowed
	}
	base := wallpaperDir()
	if err := os.MkdirAll(base, 0o755); err != nil {
		return err
	}
	ext := filepath.Ext(path)
	if ext == "" {
		ext = ".png"
	}
	dest := filepath.Join(base, "wallpaper"+ext)
	if err := copyFile(path, dest); err != nil {
		return err
	}

	wallpaperStyle, tile := wallpaperStyleFor(style)
	desktop, err := registry.OpenKey(registry.CURRENT_USER,
		`Control Panel\Desktop`, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return err
	}
	defer desktop.Close()

	if err := desktop.SetStringValue("WallpaperStyle", wallpaperStyle); err != nil {
		return err
	}
	if err := desktop.SetStringValue("TileWallpaper", tile); err != nil {
		return err
	}
	if err := desktop.SetStringValue("Wallpaper", dest); err != nil {
		return err
	}

	wide, err := syscall.UTF16PtrFromString(dest)
	if err != nil {
		return err
	}
	ok, _, _ := procSystemParamInfo.Call(
		uintptr(spiSetDesktopWallpaper), 0,
		uintptr(unsafe.Pointer(wide)),
		uintptr(spiUpdateIniFile|spiSendChange),
	)
	if ok == 0 {
		return errors.New("Windows 未能应用壁纸")
	}
	return nil
}

// wallpaperStyleFor maps the UI's style names onto the registry pair
// Windows actually reads. "fill" is also the fallback, matching the Rust
// shell.
func wallpaperStyleFor(style string) (wallpaperStyle, tile string) {
	switch style {
	case "center":
		return "0", "0"
	case "stretch":
		return "2", "0"
	case "fit":
		return "6", "0"
	case "tile":
		return "0", "1"
	case "fill":
		return "10", "0"
	default:
		return "10", "0"
	}
}

func wallpaperDir() string {
	if dir := os.Getenv("LOCALAPPDATA"); dir != "" {
		return filepath.Join(dir, "Lumina")
	}
	return filepath.Join(os.TempDir(), "Lumina")
}

func copyFile(src, dest string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return fmt.Errorf("文件为空：%s", src)
	}
	return os.WriteFile(dest, data, 0o644)
}
