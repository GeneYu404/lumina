//go:build !windows

package app

import "errors"

// SetWallpaper is Windows-only: the desktop wallpaper is set through
// HKCU\Control Panel\Desktop plus SystemParametersInfo, neither of which
// exists elsewhere.
func (l *Lumina) SetWallpaper(path string, style string) error {
	return errors.New("设置壁纸仅支持 Windows")
}
