// Package app holds the service the frontend binds to: one exported method
// per capability the Rust shell exposed as a Tauri command, plus the dialogs
// that used to live in the Tauri dialog plugin.
package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/egoist/mygo"

	"lumina/internal/media"
)

// Lumina is the bound service. MyGo names it after the type, so the page
// calls `Lumina.describeBatch(paths)` and friends.
type Lumina struct {
	// Launch holds what Windows asked us to open, for LaunchSiblings.
	Launch []string

	mu      sync.RWMutex
	allowed map[string]bool
}

// New returns the service with the launch targets already trusted.
func New(launch []string) *Lumina {
	l := &Lumina{allowed: make(map[string]bool, 256)}
	l.Launch = launch
	l.remember(launch)
	return l
}

// Entry is the display record, matching the frontend's DesktopEntry.
type Entry = media.Entry

// LaunchSet is what LaunchSiblings hands back.
type LaunchSet struct {
	Entries []Entry `json:"entries"`
	// Selected is the index of the opened image inside Entries.
	Selected int `json:"selected"`
	// Rest holds paths beyond the first batch: the frontend describes these
	// in background chunks so launch never waits on a giant folder.
	Rest []string `json:"rest"`
}

// Boot is the data the page needs for its FIRST render, injected before any
// page script runs — so an image opened from Explorer is shown immediately,
// with no welcome screen and no IPC round trip in front of it.
type Boot struct {
	Entries []Entry `json:"entries"`
	// Selected is the index of the opened image.
	Selected int `json:"selected"`
	// Siblings is true when exactly one image was opened, so the page knows
	// to load its folder in the background.
	Siblings bool `json:"siblings"`
}

/* ------------------------------- registry ------------------------------- */

// remember trusts paths the frontend is allowed to read. Every path that
// reaches the page goes through here, so the asset scheme and the
// path-returning methods can enforce it.
func (l *Lumina) remember(paths []string) {
	l.mu.Lock()
	for _, p := range paths {
		if p != "" {
			l.allowed[normalizePath(p)] = true
		}
	}
	l.mu.Unlock()
}

// allowed reports whether the page may read path.
func (l *Lumina) allowedOne(path string) bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.allowed[normalizePath(path)]
}

func (l *Lumina) allowedAny(paths []string) bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	for _, p := range paths {
		if l.allowed[normalizePath(p)] {
			return true
		}
	}
	return false
}

// normalizePath puts a path in the one form the registry is keyed by:
// absolute, and case-folded, because Windows paths are case-insensitive and
// the page may hand back a differently-cased spelling of the same file.
func normalizePath(p string) string {
	if abs, err := filepath.Abs(p); err == nil {
		p = abs
	}
	return strings.ToLower(filepath.Clean(p))
}

// /* -------------------------------- files -------------------------------- */

// CollectPaths expands folders and files into media paths. Listing is cheap
// even at 100k files — header probes happen later, one batch at a time.
func (l *Lumina) CollectPaths(inputs []string) ([]string, error) {
	if len(inputs) == 0 {
		return nil, nil
	}
	out := media.ExpandPaths(inputs)
	l.remember(out)
	return out, nil
}

// DescribeBatch registers and probes one bounded batch of paths. The frontend
// keeps batches at ImportBatch so huge folders stay responsive.
func (l *Lumina) DescribeBatch(paths []string) ([]Entry, error) {
	if len(paths) == 0 {
		return nil, nil
	}
	l.remember(paths)
	return media.DescribeAll(paths), nil
}

// ReadImage returns raw file bytes, used only when an edit/export needs
// same-origin canvas data.
func (l *Lumina) ReadImage(path string) ([]byte, error) {
	if !l.allowedOne(path) {
		return nil, errPathNotAllowed
	}
	fi, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	// Copying the file is what an edit needs; copying a video the size of a
	// movie is what takes the process down. One shared ceiling keeps a bad
	// caller from turning into an OOM.
	if uint64(fi.Size()) > media.MaxReadBytes {
		return nil, errFileTooLarge
	}
	return os.ReadFile(path)
}

// ThumbBatch renders a whole batch in one call — never one call per file.
// It returns the packed record stream the frontend decodes into blob URLs.
func (l *Lumina) ThumbBatch(paths []string, width uint32) ([]byte, error) {
	if len(paths) == 0 {
		return nil, nil
	}
	thumbs := media.ThumbBatch(paths, width, l.allowedOne)
	if len(thumbs) == 0 {
		return nil, nil
	}
	return media.PackThumbs(thumbs), nil
}

// ReadMediaInfo parses container headers for the video info panel: duration,
// codec, frame rate, audio layout. Headers only — no decoding, so a 500 GB
// file costs the same handful of seeks as a 5 MB one.
func (l *Lumina) ReadMediaInfo(path string) (media.MediaInfo, error) {
	if !l.allowedOne(path) {
		return media.MediaInfo{}, errPathNotAllowed
	}
	return media.Read(path)
}

/* -------------------------------- launch -------------------------------- */

// LaunchSiblings is the background step after a direct open: the rest of the
// launched image's folder. The launched image itself is already on screen
// (injected at window creation), so nothing waits on this — and only one
// batch around the target gets probed here; the remainder streams in through
// DescribeBatch.
func (l *Lumina) LaunchSiblings() (LaunchSet, error) {
	if len(l.Launch) != 1 {
		return LaunchSet{}, nil
	}
	target := l.Launch[0]
	paths := media.SiblingsOf(target)
	l.remember(paths)

	// Front batch centred on the target so its neighbours are what the
	// viewer shows first; everything else is handed over as raw paths.
	pos := 0
	for i, p := range paths {
		if p == target {
			pos = i
			break
		}
	}
	start := pos - media.ImportBatch/2
	if start < 0 {
		start = 0
	}
	if start > len(paths)-media.ImportBatch {
		start = len(paths) - media.ImportBatch
	}
	if start < 0 {
		start = 0
	}
	end := min(start+media.ImportBatch, len(paths))

	entries := media.DescribeAll(paths[start:end])
	selected := 0
	for i, e := range entries {
		if e.Path == target {
			selected = i
			break
		}
	}
	rest := make([]string, 0, len(paths)-(end-start))
	for i, p := range paths {
		if i < start || i >= end {
			rest = append(rest, p)
		}
	}
	return LaunchSet{Entries: entries, Selected: selected, Rest: rest}, nil
}

/* ------------------------------- dialogs ------------------------------- */

// PickImages opens the native file picker. The paths come back into Go
// straight from the dialog, so the whole batch stays out of JavaScript.
func (l *Lumina) PickImages(ctx context.Context) ([]string, error) {
	return pickImages(mygo.CallerWindow(ctx))
}

// PickFolder opens the native folder picker.
func (l *Lumina) PickFolder(ctx context.Context) ([]string, error) {
	return pickFolder(mygo.CallerWindow(ctx))
}

/* -------------------------------- window -------------------------------- */

// ShowWindow reveals the window once the page has rendered its first frame.
// The window is created hidden so the page never flashes empty.
func (l *Lumina) ShowWindow() error {
	if w := mainWindow(); w != nil {
		w.Show()
		w.Focus()
	}
	return nil
}

// SetFullscreen puts the window into, or takes it out of, full screen.
//
// This lives here rather than in the page because MyGo's window controls
// only offer a toggle; the page has always asked for an explicit state.
func (l *Lumina) SetFullscreen(fullscreen bool) error {
	if w := mainWindow(); w != nil {
		w.SetFullScreen(fullscreen)
	}
	return nil
}

// SetTheme forces the app appearance. Pass "light", "dark", or "" to follow
// the system.
func (l *Lumina) SetTheme(theme string) error {
	switch strings.ToLower(theme) {
	case "dark":
		mygo.Theme.SetSource(mygo.ThemeDark)
	case "light":
		mygo.Theme.SetSource(mygo.ThemeLight)
	default:
		mygo.Theme.SetSource(mygo.ThemeSystem)
	}
	return nil
}

// OnFilesDropped is called by the window's file-drop handler so the page
// learns about paths dropped from Explorer, which DOM drop events hide.
var OnFilesDropped = mygo.NewEvent[[]string]("files-dropped")

// OpenPathsEvent carries paths handed to a running instance: a second launch,
// Shell → Open With, or a file dropped on the window.
//
// Only the paths travel: the page runs its own import pipeline over them
// (collect → describe in batches → thumbnails), which is already tuned for
// huge folders. Doing it in Go too would mean two implementations of the
// same streaming logic.
var OpenPathsEvent = mygo.NewEvent[[]string]("open-paths")

// OpenPaths hands a set of paths to the running window.
func (l *Lumina) OpenPaths(paths []string) {
	if len(paths) == 0 {
		if w := mainWindow(); w != nil {
			w.Show()
			w.Focus()
		}
		return
	}
	absolute := make([]string, 0, len(paths))
	for _, p := range paths {
		if abs, err := filepath.Abs(p); err == nil {
			absolute = append(absolute, abs)
		}
	}
	if len(absolute) == 0 {
		return
	}
	l.remember(absolute)
	if w := mainWindow(); w != nil {
		w.Show()
		w.Focus()
		_ = OpenPathsEvent.Emit(w, absolute)
	}
}

// AllowFunc returns the registry's gate for the lumina:// protocol handler.
//
// It is a package function rather than a method on purpose: MyGo binds every
// exported method of the service to the page, and the page has no business
// asking what the registry holds.
func AllowFunc(l *Lumina) func(string) bool { return l.allowedOne }
