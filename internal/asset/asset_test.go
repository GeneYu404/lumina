package asset

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestParseRange(t *testing.T) {
	const length = 1000
	cases := []struct {
		name       string
		spec       string
		length     int64
		start, end int64
		ok         bool
	}{
		{"closed range", "bytes=100-199", length, 100, 199, true},
		{"open ended", "bytes=100-", length, 100, 999, true},
		{"suffix", "bytes=-50", length, 950, 999, true},
		{"single byte", "bytes=0-0", length, 0, 0, true},
		{"clamped past the end", "bytes=900-5000", length, 900, 999, true},
		// Only a request larger than the cap is trimmed, and only a file
		// larger than the cap can be.
		{"capped at maxRange", "bytes=0-2000000", maxRange * 3, 0, maxRange - 1, true},
		{"suffix longer than the file", "bytes=-5000", length, 0, 999, true},
		{"start past the end", "bytes=1000-", length, 0, 0, false},
		{"end before start", "bytes=500-100", length, 0, 0, false},
		{"no unit", "100-199", length, 0, 0, false},
		{"garbage", "bytes=abc-def", length, 0, 0, false},
		{"no dash", "bytes=100", length, 0, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			start, end, ok := parseRange(c.spec, c.length)
			if ok != c.ok {
				t.Fatalf("ok = %v, want %v", ok, c.ok)
			}
			if !ok {
				return
			}
			if start != c.start || end != c.end {
				t.Fatalf("got %d-%d, want %d-%d", start, end, c.start, c.end)
			}
		})
	}
}

func TestParseRangeEmptyFile(t *testing.T) {
	if _, _, ok := parseRange("bytes=0-10", 0); ok {
		t.Fatal("a zero-length file can satisfy no range")
	}
}

func TestValidTarget(t *testing.T) {
	good := []string{
		`C:\photos\a.jpg`,
		`C:/photos/a.jpg`,
		`\\server\share\a.jpg`,
	}
	for _, p := range good {
		if !validTarget(p) {
			t.Errorf("%q should be allowed", p)
		}
	}
	bad := []string{
		``,
		`photos\a.jpg`,          // relative
		`C:\photos\..\..\a.jpg`, // climbing out
		`C:\photos\..\a.jpg`,
	}
	for _, p := range bad {
		if validTarget(p) {
			t.Errorf("%q should be refused", p)
		}
	}
}

func TestMimeFor(t *testing.T) {
	cases := map[string]string{
		`C:\a.jpg`:  "image/jpeg",
		`C:\a.MKV`:  "video/x-matroska",
		`C:\a.webp`: "image/webp",
		`C:\a.tif`:  "image/tiff",
		`C:\a.avif`: "image/avif",
	}
	for path, want := range cases {
		if got := mimeFor(path, nil); got != want {
			t.Errorf("mimeFor(%q) = %q, want %q", path, got, want)
		}
	}
	// Unknown extension falls back to the magic bytes.
	if got := mimeFor(`C:\a.unknown`, []byte{0x1A, 0x45, 0xDF, 0xA3}); got != "video/x-matroska" {
		t.Errorf("EBML sniff = %q, want video/x-matroska", got)
	}
}

// newHandler returns a handler that trusts a single file, plus that file's
// path.
func newHandler(t *testing.T, name string, size int) (*Handler, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, name)
	data := make([]byte, size)
	for i := range data {
		data[i] = byte('a' + i%26)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return &Handler{Allow: func(p string) bool { return p == path }}, path
}

func get(t *testing.T, h *Handler, path, method, rangeHeader string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "http://lumina.localhost/"+path, nil)
	if rangeHeader != "" {
		r.Header.Set("Range", rangeHeader)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestServesWholeFile(t *testing.T) {
	h, path := newHandler(t, "a.jpg", 500)
	w := get(t, h, path, http.MethodGet, "")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if got := w.Body.Len(); got != 500 {
		t.Fatalf("body = %d bytes, want 500", got)
	}
	if got := w.Header().Get("Content-Length"); got != "500" {
		t.Errorf("Content-Length = %q, want 500", got)
	}
	if got := w.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Errorf("Accept-Ranges = %q, want bytes", got)
	}
}

func TestServesRanged(t *testing.T) {
	h, path := newHandler(t, "a.jpg", 500)
	w := get(t, h, path, http.MethodGet, "bytes=10-19")
	if w.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206", w.Code)
	}
	if got := w.Header().Get("Content-Range"); got != "bytes 10-19/500" {
		t.Errorf("Content-Range = %q", got)
	}
	if got := w.Body.Len(); got != 10 {
		t.Fatalf("body = %d bytes, want 10", got)
	}
}

func TestUnsatisfiableRange(t *testing.T) {
	h, path := newHandler(t, "a.jpg", 500)
	w := get(t, h, path, http.MethodGet, "bytes=900-")
	if w.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("status = %d, want 416", w.Code)
	}
	if got := w.Header().Get("Content-Range"); got != "bytes */500" {
		t.Errorf("Content-Range = %q, want bytes */500", got)
	}
}

// An unranged HEAD reports the true size. Promising the capped size instead
// would tell a 500 MB video it is only 128 MiB and break every seek.
func TestHeadReportsTrueLength(t *testing.T) {
	h, path := newHandler(t, "a.mp4", 500)
	w := get(t, h, path, http.MethodHead, "")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if got := w.Header().Get("Content-Length"); got != "500" {
		t.Fatalf("Content-Length = %q, want 500", got)
	}
}

func TestHeadMirrorsRangedGet(t *testing.T) {
	h, path := newHandler(t, "a.mp4", 500)
	w := get(t, h, path, http.MethodHead, "bytes=10-19")
	if w.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206", w.Code)
	}
	if got := w.Header().Get("Content-Range"); got != "bytes 10-19/500" {
		t.Errorf("Content-Range = %q", got)
	}
	if got := w.Header().Get("Content-Length"); got != "10" {
		t.Errorf("Content-Length = %q, want 10", got)
	}
}

// This is the "闪退" guard: an <img> that points at a big video without a
// Range header must be refused, not served.
func TestHugeUnrangedRequestIsRefused(t *testing.T) {
	h, path := newHandler(t, "big.mp4", 0)
	if err := os.Truncate(path, maxWhole+1); err != nil {
		t.Fatal(err)
	}
	w := get(t, h, path, http.MethodGet, "")
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", w.Code)
	}
	if w.Body.Len() != 0 {
		t.Fatalf("body = %d bytes, want 0", w.Body.Len())
	}
}

func TestUntrustedPathIsForbidden(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret.jpg")
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := &Handler{Allow: func(string) bool { return false }}
	w := get(t, h, path, http.MethodGet, "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

func TestPreflightNeedsNoFileAccess(t *testing.T) {
	h := &Handler{Allow: func(string) bool { return false }}
	w := get(t, h, `C:\whatever.jpg`, http.MethodOptions, "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
	if got := w.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, "GET") {
		t.Errorf("Access-Control-Allow-Methods = %q", got)
	}
}

func TestMissingFileIs404(t *testing.T) {
	h := &Handler{Allow: func(string) bool { return true }}
	w := get(t, h, filepath.Join(t.TempDir(), "nope.jpg"), http.MethodGet, "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
}

func TestDecodeSchemePathStripsLeadingSlash(t *testing.T) {
	// Go's net/url has already percent-decoded by the time we see it.
	if got := decodeSchemePath(`/C:\photos\a.jpg`); got != `C:\photos\a.jpg` {
		t.Fatalf("got %q", got)
	}
}

func TestMultiRangeFallsBackToWholeFile(t *testing.T) {
	h, path := newHandler(t, "a.jpg", 500)
	w := get(t, h, path, http.MethodGet, "bytes=0-9,20-29")
	// A comma form is not parsed; the request degrades to a full 200, which
	// RFC 7233 explicitly allows.
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

func TestContentLengthMatchesBody(t *testing.T) {
	h, path := newHandler(t, "a.jpg", 128)
	w := get(t, h, path, http.MethodGet, "")
	declared, _ := strconv.Atoi(w.Header().Get("Content-Length"))
	if declared != w.Body.Len() {
		t.Fatalf("Content-Length %d != body %d", declared, w.Body.Len())
	}
}
