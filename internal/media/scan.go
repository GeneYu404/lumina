package media

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Entry is one displayable file. The JSON field names are the frontend's
// DesktopEntry interface.
type Entry struct {
	Path     string  `json:"path"`
	Name     string  `json:"name"`
	Size     uint64  `json:"size"`
	Modified float64 `json:"modified"`
	Width    uint32  `json:"width"`
	Height   uint32  `json:"height"`
}

func modTimeMS(t time.Time) float64 {
	if t.IsZero() {
		return 0
	}
	return float64(t.UnixMilli())
}

// Describe probes one file into an Entry. It returns nil when the path is
// not a regular file.
//
// The dimension probe is header-only, which is what makes it cheap enough to
// run across a whole folder in parallel.
func Describe(path string) *Entry {
	fi, err := os.Stat(path)
	if err != nil || !fi.Mode().IsRegular() {
		return nil
	}
	var w, h uint32
	if !IsVideo(path) {
		w, h = Dimensions(path)
		if w == 0 || h == 0 {
			w, h = 0, 0
		} else {
			// Phone photos carry their rotation in the EXIF Orientation tag,
			// so report the *visual* size — otherwise a portrait shot is
			// laid out landscape and every tile is the wrong shape.
			w, h = ApplyOrientation(w, h, ReadOrientation(path))
		}
	}
	return &Entry{
		Path:     path,
		Name:     filepath.Base(path),
		Size:     uint64(fi.Size()),
		Modified: modTimeMS(fi.ModTime()),
		Width:    w,
		Height:   h,
	}
}

// DescribeAll probes a batch in parallel and returns the results sorted by
// name. Unreadable paths are dropped.
func DescribeAll(paths []string) []Entry {
	if len(paths) == 0 {
		return nil
	}
	out := make([]Entry, len(paths))
	var wg sync.WaitGroup
	for i, p := range paths {
		wg.Add(1)
		go func(i int, p string) {
			defer wg.Done()
			if e := Describe(p); e != nil {
				out[i] = *e
			}
		}(i, p)
	}
	wg.Wait()

	entries := make([]Entry, 0, len(paths))
	for _, e := range out {
		if e.Path != "" {
			entries = append(entries, e)
		}
	}
	SortEntries(entries)
	return entries
}

// SortEntries orders entries case-insensitively by file name.
func SortEntries(entries []Entry) {
	sort.Slice(entries, func(i, j int) bool {
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
}

// collectDir appends the media files under root, at most depth levels deep.
// The cap is a safety net: the import streams in batches past any practical
// folder size, so this only stops a pathological tree.
func collectDir(root string, out *[]string, depth int) {
	if depth > MaxDepth || len(*out) >= MaxFiles {
		return
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	// Sort children by name so a walk is reproducible run to run.
	names := make([]string, 0, len(entries))
	dirs := make([]string, 0, len(entries))
	for _, e := range entries {
		full := filepath.Join(root, e.Name())
		if e.IsDir() {
			dirs = append(dirs, full)
		} else if !e.Type().IsRegular() {
			continue
		} else if IsMedia(full) {
			names = append(names, full)
		}
	}
	byLower := func(s []string) {
		sort.Slice(s, func(i, j int) bool {
			return strings.ToLower(filepath.Base(s[i])) < strings.ToLower(filepath.Base(s[j]))
		})
	}
	byLower(names)
	byLower(dirs)

	*out = append(*out, names...)
	if len(*out) >= MaxFiles {
		return
	}
	for _, d := range dirs {
		collectDir(d, out, depth+1)
		if len(*out) >= MaxFiles {
			return
		}
	}
}

// ExpandPaths turns files and folders into a bounded, de-duplicated media
// list. Listing is cheap even at 100k files — header probes happen later, one
// DescribeBatch at a time.
func ExpandPaths(inputs []string) []string {
	out := make([]string, 0, 64)
	seen := make(map[string]bool, 64)
	for _, p := range inputs {
		if p == "" {
			continue
		}
		if fi, err := os.Stat(p); err == nil && fi.IsDir() {
			collectDir(p, &out, 0)
			continue
		}
		if IsMedia(p) {
			if abs, err := filepath.Abs(p); err == nil {
				p = abs
			}
			if !seen[strings.ToLower(p)] {
				seen[strings.ToLower(p)] = true
				out = append(out, p)
			}
		}
		if len(out) >= MaxFiles {
			break
		}
	}
	return out
}

// SiblingsOf returns the media files reachable from target's folder,
// recursively: phone/photo libraries are routinely nested by year/month.
// Path-sorted and capped to MaxFiles around the target, so opening one photo
// from a huge tree still finds its neighbours.
//
// The target keeps its exact path string — case matters on Windows, and the
// frontend matches it against the item it already has on screen.
func SiblingsOf(target string) []string {
	dir := filepath.Dir(target)
	if dir == "" {
		return []string{target}
	}
	var all []string
	collectDir(dir, &all, 0)
	sort.Slice(all, func(i, j int) bool {
		return strings.ToLower(all[i]) < strings.ToLower(all[j])
	})

	wanted := strings.ToLower(target)
	pos := -1
	for i, p := range all {
		if strings.ToLower(p) == wanted {
			pos = i
			// Replace the lowercase path string with the real one; its
			// neighbours keep their place in the sort.
			all[i] = target
			break
		}
	}
	if pos < 0 {
		all = append(all, target)
		sort.Slice(all, func(i, j int) bool {
			return strings.ToLower(all[i]) < strings.ToLower(all[j])
		})
		for i, p := range all {
			if p == target {
				pos = i
				break
			}
		}
	}
	if pos < 0 {
		pos = 0
	}
	if len(all) > MaxFiles {
		start := min(max(pos-MaxFiles/2, 0), len(all)-MaxFiles)
		all = all[start : start+MaxFiles]
	}
	return all
}
