package media

import (
	"encoding/binary"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
)

// thumbCacheVersion keys the cache. Thumbnails produced by an older rule
// (e.g. before the EXIF rotation was baked in) must never be served again.
const thumbCacheVersion uint32 = 2

// thumbCacheDir is where rendered thumbnails live, so a second launch does
// not decode a thousand photos again.
func thumbCacheDir() string {
	if dir := os.Getenv("LOCALAPPDATA"); dir != "" {
		return filepath.Join(dir, "Lumina", "thumbs")
	}
	if dir, err := os.UserCacheDir(); err == nil {
		return filepath.Join(dir, "lumina", "thumbs")
	}
	return filepath.Join(os.TempDir(), "lumina", "thumbs")
}

// thumbCacheFile derives the cache file for one (path, size, mtime, width).
// The inputs are the file's identity: editing or replacing the source
// changes one of them and misses the cache automatically.
func thumbCacheFile(path string, size uint64, modified float64, width uint32) string {
	h := fnv.New64a()
	var buf [8]byte
	put := func(v uint64) {
		binary.LittleEndian.PutUint64(buf[:], v)
		_, _ = h.Write(buf[:])
	}
	put(uint64(thumbCacheVersion))
	put(hashString(path))
	put(size)
	put(mathFloat64bits(modified))
	put(uint64(width))
	return filepath.Join(thumbCacheDir(), fmt.Sprintf("%016x.bin", h.Sum64()))
}

func hashString(s string) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(s))
	return h.Sum64()
}

func mathFloat64bits(f float64) uint64 {
	return uint64(int64(f * 1000)) // milliseconds; stable and integral
}

// Thumb is one rendered thumbnail.
type Thumb struct {
	// Index is the caller's position in the requested batch.
	Index int
	// Kind is ThumbJPEG, ThumbPNG or ThumbNone.
	Kind uint8
	Data []byte
}

// MakeThumbCached is MakeThumbnail with an on-disk cache in front of it.
func MakeThumbCached(path string, size uint64, modified float64, target uint32) (uint8, []byte, error) {
	cache := thumbCacheFile(path, size, modified, target)
	if raw, err := os.ReadFile(cache); err == nil {
		if kind := raw[0]; kind != ThumbNone {
			return kind, raw[1:], nil
		}
	}

	kind, payload, err := MakeThumbnail(path, target)
	if err != nil {
		return ThumbNone, nil, err
	}
	writeThumbCache(cache, kind, payload)
	return kind, payload, nil
}

// writeThumbCache stores kind+payload, via a temp file so a concurrent reader
// never sees a half-written thumbnail.
func writeThumbCache(path string, kind uint8, payload []byte) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append([]byte{kind}, payload...), 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, path)
}

// ThumbBatch renders a bounded batch in parallel and returns the results in
// the caller's index order. Paths the filter rejects are skipped without
// costing a decode.
//
// The pool is bounded on purpose: the frontend sends batches of up to a
// thousand paths and an unbounded fan-out on a 16-core machine starves the
// event loop for no real gain — decode is already mostly I/O and the WebView
// needs those cores to paint.
func ThumbBatch(paths []string, width uint32, keep func(path string) bool) []Thumb {
	if width < 64 {
		width = 64
	}
	if width > 1024 {
		width = 1024
	}

	type job struct {
		idx  int
		path string
	}
	var jobs []job
	for i, p := range paths {
		if keep != nil && !keep(p) {
			continue
		}
		jobs = append(jobs, job{idx: i, path: p})
	}
	if len(jobs) == 0 {
		return nil
	}

	workers := min(4, max(1, runtime.NumCPU()/2))
	out := make([]Thumb, len(jobs))
	var wg sync.WaitGroup
	var next atomic.Int64
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		go func() {
			defer wg.Done()
			for {
				i := int(next.Add(1)) - 1
				if i >= len(jobs) {
					return
				}
				j := jobs[i]
				fi, err := os.Stat(j.path)
				if err != nil {
					continue
				}
				kind, data, err := MakeThumbCached(j.path, uint64(fi.Size()), modTimeMS(fi.ModTime()), width)
				if err != nil || kind == ThumbNone {
					continue
				}
				out[i] = Thumb{Index: j.idx, Kind: kind, Data: data}
			}
		}()
	}
	wg.Wait()

	thumbs := out[:0]
	for _, t := range out {
		if t.Kind != ThumbNone {
			thumbs = append(thumbs, t)
		}
	}
	return thumbs
}

// PackThumbs encodes a batch into the wire format the frontend decodes: a
// little-endian u32 count, then one 13-byte record per thumbnail
// (u32 index, u8 kind, u32 offset, u32 length), then the payloads.
func PackThumbs(thumbs []Thumb) []byte {
	out := make([]byte, 4, 4+len(thumbs)*13)
	binary.LittleEndian.PutUint32(out, uint32(len(thumbs)))
	var payload []byte
	for _, t := range thumbs {
		var rec [13]byte
		binary.LittleEndian.PutUint32(rec[0:4], uint32(t.Index))
		rec[4] = t.Kind
		binary.LittleEndian.PutUint32(rec[5:9], uint32(len(payload)))
		binary.LittleEndian.PutUint32(rec[9:13], uint32(len(t.Data)))
		out = append(out, rec[:]...)
		payload = append(payload, t.Data...)
	}
	return append(out, payload...)
}
