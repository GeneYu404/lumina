package app

import (
	"errors"
	"sync"

	"github.com/egoist/mygo"
)

var (
	errPathNotAllowed = errors.New("path not allowed")
	errFileTooLarge   = errors.New("file too large")
)

var (
	windowMu sync.RWMutex
	window   *mygo.Window
)

// SetMainWindow records the app's main window so bound methods can act on it
// (showing it after first paint, parenting dialogs to it).
func SetMainWindow(w *mygo.Window) {
	windowMu.Lock()
	window = w
	windowMu.Unlock()
}

func mainWindow() *mygo.Window {
	windowMu.RLock()
	defer windowMu.RUnlock()
	return window
}

// MainWindow returns the app's main window, or nil before it is created.
func MainWindow() *mygo.Window { return mainWindow() }

// pickImages shows the native file picker.
//
// The filters mirror the Rust shell's dialog exactly, including the
// three-way 图片和视频 / 图片 / 视频 split that Explorer shows.
func pickImages(parent *mygo.Window) ([]string, error) {
	return mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:   parent,
		Title:    "选择图片或视频",
		Multiple: true,
		Filters: []mygo.FileFilter{
			{
				Name: "图片和视频",
				Extensions: []string{
					"jpg", "jpeg", "jfif", "png", "apng", "gif", "webp", "avif", "bmp", "ico", "svg", "tif", "tiff",
					"mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv",
				},
			},
			{
				Name:       "图片",
				Extensions: []string{"jpg", "jpeg", "jfif", "png", "apng", "gif", "webp", "avif", "bmp", "ico", "svg", "tif", "tiff"},
			},
			{Name: "视频", Extensions: []string{"mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv"}},
		},
	})
}

func pickFolder(parent *mygo.Window) ([]string, error) {
	return mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:    parent,
		Title:     "选择包含图片的文件夹",
		Directory: true,
	})
}
