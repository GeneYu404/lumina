package media

import (
	"path/filepath"
	"strings"
)

// ImageExts is the image-only list (the file picker and associations use
// MediaExts).
var ImageExts = []string{
	"jpg", "jpeg", "jfif", "pjpeg", "pjp", "png", "apng", "gif", "webp",
	"avif", "bmp", "dib", "ico", "cur", "svg", "tif", "tiff",
}

// VideoExts is played by the system WebView; dimensions stay 0 until the page
// reads metadata.
var VideoExts = []string{"mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv"}

// MediaExts is every extension the app can open: file picker, context menu
// and file associations.
var MediaExts = []string{
	"jpg", "jpeg", "jfif", "pjpeg", "pjp", "png", "apng", "gif", "webp",
	"avif", "bmp", "dib", "ico", "cur", "svg", "tif", "tiff", "heic", "heif",
	"jxl", "mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv",
}

// DecodableExts is the set the Go decoder understands. Formats outside it
// (SVG, AVIF, HEIC, JXL) keep the original file as their thumbnail — same as
// the Rust shell, which listed exactly these ten.
//
// AVIF/HEIF are absent on purpose: no pure-Go AV1 decoder exists, and this app
// stays CGO-free. Dimensions are still probed for them by reading the ISOBMFF
// `ispe` box (see Dimensions), which is strictly better than the 0x0 the Rust
// shell reported.
var DecodableExts = []string{
	"jpg", "jpeg", "jfif", "png", "gif", "webp", "bmp", "ico", "tif", "tiff",
}

var (
	mediaSet     = toSet(MediaExts)
	videoSet     = toSet(VideoExts)
	decodableSet = toSet(DecodableExts)
)

func toSet(list []string) map[string]bool {
	m := make(map[string]bool, len(list))
	for _, s := range list {
		m[s] = true
	}
	return m
}

// Ext returns the lowercase extension of path, without the dot.
func Ext(path string) string {
	return strings.ToLower(strings.TrimPrefix(filepath.Ext(path), "."))
}

// IsMedia reports whether the extension is one the app can open.
func IsMedia(path string) bool {
	e := Ext(path)
	return e != "" && mediaSet[e]
}

// IsVideo reports whether the extension is one the system WebView plays.
func IsVideo(path string) bool {
	return videoSet[Ext(path)]
}

// IsDecodable reports whether the pure-Go decoder can decode this extension.
func IsDecodable(path string) bool {
	return decodableSet[Ext(path)]
}

// Safety and batching limits, mirroring the Rust shell.
const (
	// MaxFiles caps one directory walk. The import streams in batches past
	// any practical folder size; this only stops a pathological tree.
	MaxFiles = 100_000
	// ImportBatch is how many paths are described per IPC round trip — the
	// frontend shows the first batch immediately and merges the rest in the
	// background.
	ImportBatch = 1000
	// MaxDepth stops a walk from descending forever.
	MaxDepth = 12
	// MaxPixels guards against a decompression bomb.
	MaxPixels = 80_000_000
	// MaxReadBytes is the ceiling for read_image. Copying the file is what an
	// edit needs; copying a video the size of a movie is what takes the
	// process down.
	MaxReadBytes = 128 * 1024 * 1024
)
