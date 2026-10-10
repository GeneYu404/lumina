// Package asset serves the app's local media files to the page over a custom
// `lumina://` scheme.
//
// This is a bounded replacement for a naive file handler. A request that
// arrives **without** a Range header would otherwise read the entire file
// into one buffer. `<video>` normally asks with Range, but anything else that
// touches a video URL — a stray `<img>` preload, an OPTIONS preflight (the
// poster generator loads with crossOrigin), window.open, a CSS mask-image —
// pulls every byte of a multi-gigabyte file into the process, and Windows
// kills the app. That is the "闪退": the window simply disappears.
//
// Here every response is capped, so no single request can take the process
// down. Media keeps streaming through ordinary 206 range responses; an
// `<img>` that points at a video just fails to decode instead of taking us
// with it.
package asset

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const (
	// maxRange caps one Range response.
	maxRange = 1024 * 1024
	// maxWhole refuses (413) a request without Range past this size. Images
	// sit far below it, so a huge video can never be yanked into RAM in a
	// single piece.
	maxWhole = 128 * 1024 * 1024
	// sniffLen is how much of the file is read to guess its content type.
	sniffLen = 8192
)

// Handler serves local files. allow is the app's path registry: a file the
// page never imported must not be readable through the scheme.
type Handler struct {
	Allow func(path string) bool
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Echo the caller's origin so crossOrigin requests (video posters,
	// canvas reads) stay CORS-clean in both the dev server and the packaged
	// app.
	origin := r.Header.Get("Origin")
	if origin == "" {
		origin = "*"
	}
	hdr := w.Header()
	hdr.Set("Access-Control-Allow-Origin", origin)
	hdr.Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	hdr.Set("Access-Control-Allow-Headers", "range")
	hdr.Set("Access-Control-Expose-Headers", "content-range")
	hdr.Set("Accept-Ranges", "bytes")

	// Preflight only approves the method and headers; no file access needed.
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	path := decodeSchemePath(r.URL.Path)
	if !validTarget(path) || (h.Allow != nil && !h.Allow(path)) {
		w.WriteHeader(http.StatusForbidden)
		return
	}

	f, err := os.Open(path)
	if err != nil {
		writeOpenError(w, err)
		return
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil || fi.IsDir() {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	length := uint64(fi.Size())

	// Sniff the magic bytes for the content type, then rewind for the body.
	magic := make([]byte, min(sniffLen, int(length)))
	if _, err := io.ReadFull(f, magic); err != nil && len(magic) > 0 {
		// A short read is fine: the sniff just gets less to go on.
		_ = err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	hdr.Set("Content-Type", mimeFor(path, magic))

	// Range → at most maxRange bytes. Multi-range requests fall through to
	// the unranged path below (RFC 7233 lets a server ignore Range, and the
	// browser never sends a second form here).
	rawRange, hasRange := "", false
	if v := r.Header.Get("Range"); v != "" && !strings.Contains(v, ",") {
		rawRange, hasRange = v, true
	}
	var start, end int64
	ok := false
	if hasRange {
		start, end, ok = parseRange(rawRange, int64(length))
	}

	// A ranged HEAD mirrors the exact (clamped) window its GET would return.
	// An unranged HEAD reports the true length: clients size the resource
	// from it, and a later GET still frames itself with its own
	// Content-Length, so the honest size can never hang anyone — while
	// promising the capped size would tell a 500 MB video it is only 128 MiB
	// and break every seek.
	if r.Method == http.MethodHead {
		if hasRange && !ok {
			hdr.Set("Content-Range", fmt.Sprintf("bytes */%d", length))
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		if ok {
			hdr.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, length))
			hdr.Set("Content-Length", fmt.Sprint(end-start+1))
			w.WriteHeader(http.StatusPartialContent)
			return
		}
		hdr.Set("Content-Length", fmt.Sprint(length))
		w.WriteHeader(http.StatusOK)
		return
	}

	if hasRange {
		if !ok {
			hdr.Set("Content-Range", fmt.Sprintf("bytes */%d", length))
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		n := end - start + 1
		buf := make([]byte, 0, n)
		if _, err := f.Seek(start, io.SeekStart); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		b, err := io.ReadAll(io.LimitReader(f, n))
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		buf = b
		hdr.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, length))
		hdr.Set("Content-Length", fmt.Sprint(len(buf)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(buf)
		return
	}

	// Whole-file responses hold the body in memory, so past maxWhole we
	// refuse instead of sending a silently short 200 — the client sees the
	// real size from HEAD, learns we accept ranges, and can retry ranged
	// (which is what <video> does anyway). This is the path a stray <img>
	// or fetch takes at a video URL: 0 bytes now, rather than a 128 MiB
	// transfer that cannot decode and only burns memory.
	if uint64(length) > maxWhole {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	buf, err := io.ReadAll(io.LimitReader(f, int64(maxWhole)))
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	// Content-Length must describe *this* body (the file could shrink
	// mid-read), so a client sees a complete response, not a hang.
	hdr.Set("Content-Length", fmt.Sprint(len(buf)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf)
}

func writeOpenError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, os.ErrNotExist):
		w.WriteHeader(http.StatusNotFound)
	case errors.Is(err, os.ErrPermission):
		w.WriteHeader(http.StatusForbidden)
	default:
		w.WriteHeader(http.StatusInternalServerError)
	}
}

// decodeSchemePath turns the scheme URL path back into a filesystem path.
//
// Go's net/url has already percent-decoded r.URL.Path for us, so this only
// has to strip the leading slash and reject anything that tries to climb out
// of the root.
func decodeSchemePath(raw string) string {
	return strings.TrimPrefix(raw, "/")
}

// validTarget rejects empty paths, relative paths and any `..` component: the
// scheme hands us a raw filesystem path, not a document-relative one.
func validTarget(path string) bool {
	if path == "" || !filepath.IsAbs(path) {
		return false
	}
	// Reject `..` on both separators: a Windows path can carry either.
	for _, seg := range strings.FieldsFunc(path, func(r rune) bool { return r == '/' || r == '\\' }) {
		if seg == ".." {
			return false
		}
	}
	return true
}

// parseRange understands `bytes=100-199`, `bytes=100-` and `bytes=-50`,
// clamped to maxRange and to the real file length. ok=false means "not
// satisfiable".
func parseRange(spec string, length int64) (start, end int64, ok bool) {
	if length <= 0 {
		return 0, 0, false
	}
	spec = strings.TrimSpace(spec)
	if !strings.HasPrefix(spec, "bytes=") {
		return 0, 0, false
	}
	body := strings.TrimSpace(strings.TrimPrefix(spec, "bytes="))
	dash := strings.IndexByte(body, '-')
	if dash < 0 {
		return 0, 0, false
	}
	fromText, toText := strings.TrimSpace(body[:dash]), strings.TrimSpace(body[dash+1:])

	if fromText == "" {
		// Suffix form: the last N bytes.
		n, err := parseInt(toText)
		if err != nil || n <= 0 {
			return 0, 0, false
		}
		if n > length {
			n = length
		}
		return length - n, length - 1, true
	}

	from, err := parseInt(fromText)
	if err != nil || from < 0 || from >= length {
		return 0, 0, false
	}
	to := length - 1
	if toText != "" {
		if to, err = parseInt(toText); err != nil {
			return 0, 0, false
		}
		if to < from {
			return 0, 0, false
		}
	}
	if to >= length {
		to = length - 1
	}
	if to-from+1 > maxRange {
		to = from + maxRange - 1
	}
	return from, to, true
}

func parseInt(s string) (int64, error) {
	var n int64
	if s == "" {
		return 0, errors.New("empty")
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("not a number: %q", s)
		}
		n = n*10 + int64(c-'0')
		if n > 1<<62 {
			return 0, errors.New("overflow")
		}
	}
	return n, nil
}

// mimeFor picks the content type from the extension first and falls back to
// sniffing. Extension first: the sniffer cannot identify every container we
// play (.webm/.mkv/.mov …), and a generic fallback would report
// text/html for them.
func mimeFor(path string, magic []byte) string {
	switch strings.ToLower(strings.TrimPrefix(filepath.Ext(path), ".")) {
	case "jpg", "jpeg", "jfif", "pjpeg", "pjp":
		return "image/jpeg"
	case "png", "apng":
		return "image/png"
	case "gif":
		return "image/gif"
	case "webp":
		return "image/webp"
	case "avif":
		return "image/avif"
	case "bmp", "dib":
		return "image/bmp"
	case "ico":
		return "image/x-icon"
	case "svg":
		return "image/svg+xml"
	case "tif", "tiff":
		return "image/tiff"
	case "heic":
		return "image/heic"
	case "heif":
		return "image/heif"
	case "jxl":
		return "image/jxl"
	case "mp4", "m4v":
		return "video/mp4"
	case "mov":
		return "video/quicktime"
	case "webm":
		return "video/webm"
	case "mkv":
		return "video/x-matroska"
	case "avi":
		return "video/x-msvideo"
	case "wmv":
		return "video/x-ms-wmv"
	case "flv":
		return "video/x-flv"
	}
	if t := sniff(magic); t != "" {
		return t
	}
	return "application/octet-stream"
}

// sniff recognises the few magic numbers the extension table misses.
func sniff(b []byte) string {
	if len(b) < 4 {
		return ""
	}
	switch {
	case len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "AVI ":
		return "video/x-msvideo"
	case len(b) >= 12 && string(b[4:8]) == "ftyp":
		switch string(b[8:12]) {
		case "qt  ":
			return "video/quicktime"
		case "avif", "avis":
			return "image/avif"
		case "heic", "heix", "mif1":
			return "image/heic"
		}
		return "video/mp4"
	case b[0] == 0x1A && b[1] == 0x45 && b[2] == 0xDF && b[3] == 0xA3:
		return "video/x-matroska"
	case string(b[:3]) == "FLV":
		return "video/x-flv"
	case string(b[:2]) == "BM":
		return "image/bmp"
	case len(b) >= 8 && string(b[:4]) == "\x89PNG":
		return "image/png"
	case b[0] == 0xFF && b[1] == 0xD8:
		return "image/jpeg"
	}
	return ""
}
