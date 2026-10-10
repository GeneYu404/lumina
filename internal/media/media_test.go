package media

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func tempFile(t *testing.T, name string, data []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// samplePNG is a 64x48 RGBA image: big enough that the resizer does real work.
func samplePNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 64, 48))
	for y := 0; y < 48; y++ {
		for x := 0; x < 64; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 4), G: uint8(y * 5), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func sampleJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 64, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

/* --------------------------------- exts --------------------------------- */

func TestIsMedia(t *testing.T) {
	for _, p := range []string{`C:\a.JPG`, `C:\a.mkv`, `C:\a.avif`, `C:\a.heic`, `C:\a.jxl`} {
		if !IsMedia(p) {
			t.Errorf("%q should be media", p)
		}
	}
	for _, p := range []string{`C:\a.txt`, `C:\notes`, `C:\a.exe`} {
		if IsMedia(p) {
			t.Errorf("%q should not be media", p)
		}
	}
}

func TestIsDecodable(t *testing.T) {
	for _, p := range []string{`a.jpg`, `a.PNG`, `a.ico`, `a.tif`} {
		if !IsDecodable(p) {
			t.Errorf("%q should be decodable", p)
		}
	}
	// Deliberately not decodable: no pure-Go AV1/HEIF or SVG rasteriser, and
	// the frontend falls back to the original file, exactly as the Rust shell
	// did.
	for _, p := range []string{`a.avif`, `a.heic`, `a.jxl`, `a.svg`, `a.mp4`} {
		if IsDecodable(p) {
			t.Errorf("%q should not be decodable", p)
		}
	}
}

/* --------------------------------- exif --------------------------------- */

// buildJPEGWithOrientation wraps a minimal JPEG body in an APP1 segment
// carrying the Orientation tag, which is what a phone photo looks like.
func buildJPEGWithOrientation(t *testing.T, o uint16) []byte {
	t.Helper()
	tiff := buildTIFFWithOrientation(t, o)
	exifPayload := append([]byte("Exif\x00\x00"), tiff...)
	app1 := []byte{0xFF, 0xE1}
	app1 = binary.BigEndian.AppendUint16(app1, uint16(len(exifPayload)+2))
	app1 = append(app1, exifPayload...)

	body := sampleJPEG(t, 32, 16)
	// SOI, then our APP1, then the rest of the JPEG.
	out := append([]byte{0xFF, 0xD8}, app1...)
	out = append(out, body[2:]...)
	return out
}

func buildTIFFWithOrientation(t *testing.T, o uint16) []byte {
	t.Helper()
	// little-endian TIFF: header (8) + IFD0 with one entry (2 + 12) + value.
	tiff := make([]byte, 0, 26)
	tiff = append(tiff, 'I', 'I', 0x2A, 0x00)
	tiff = binary.LittleEndian.AppendUint32(tiff, 8) // IFD0 at offset 8
	tiff = binary.LittleEndian.AppendUint16(tiff, 1) // one entry
	tiff = binary.LittleEndian.AppendUint16(tiff, 0x0112)
	tiff = binary.LittleEndian.AppendUint16(tiff, 3) // SHORT
	tiff = binary.LittleEndian.AppendUint32(tiff, 1) // count
	// The value lives in the first two bytes of the value slot.
	tiff = binary.LittleEndian.AppendUint16(tiff, o)
	tiff = binary.LittleEndian.AppendUint16(tiff, 0)
	return tiff
}

func TestReadOrientationFromJPEG(t *testing.T) {
	for _, o := range []uint16{1, 3, 6, 8} {
		path := tempFile(t, "a.jpg", buildJPEGWithOrientation(t, o))
		if got := ReadOrientation(path); got != o {
			t.Errorf("ReadOrientation = %d, want %d", got, o)
		}
	}
}

func TestReadOrientationDefaultsToNormal(t *testing.T) {
	path := tempFile(t, "plain.jpg", sampleJPEG(t, 8, 8))
	if got := ReadOrientation(path); got != OrientNormal {
		t.Errorf("no EXIF should read as normal, got %d", got)
	}
	if got := ReadOrientation(filepath.Join(t.TempDir(), "missing.jpg")); got != OrientNormal {
		t.Errorf("missing file should read as normal, got %d", got)
	}
}

// A portrait phone photo is stored landscape with Orientation=6. The viewer
// must show the *visual* size or every tile is the wrong shape.
func TestApplyOrientationSwapsDimensions(t *testing.T) {
	swapped := []uint16{OrientTranspose, OrientRotate90CW, OrientTransverse, OrientRotate270}
	for _, o := range swapped {
		w, h := ApplyOrientation(4000, 3000, o)
		if w != 3000 || h != 4000 {
			t.Errorf("orientation %d: got %dx%d, want 3000x4000", o, w, h)
		}
	}
	for _, o := range []uint16{OrientNormal, OrientFlipH, OrientRotate180, OrientFlipV} {
		w, h := ApplyOrientation(4000, 3000, o)
		if w != 4000 || h != 3000 {
			t.Errorf("orientation %d should keep the aspect ratio, got %dx%d", o, w, h)
		}
	}
}

/* ------------------------------- dimensions ------------------------------ */

func TestDimensions(t *testing.T) {
	cases := []struct {
		name string
		file string
		data []byte
		w, h uint32
	}{
		{"png", "a.png", samplePNG(t), 64, 48},
		{"jpeg", "a.jpg", sampleJPEG(t, 40, 25), 40, 25},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			path := tempFile(t, c.file, c.data)
			w, h := Dimensions(path)
			if w != c.w || h != c.h {
				t.Fatalf("got %dx%d, want %dx%d", w, h, c.w, c.h)
			}
		})
	}
}

func TestDimensionsOfUnknownFile(t *testing.T) {
	path := tempFile(t, "a.bin", []byte("not an image at all, just text"))
	if w, h := Dimensions(path); w != 0 || h != 0 {
		t.Fatalf("got %dx%d, want 0x0", w, h)
	}
}

func TestDimensionsOfMissingFile(t *testing.T) {
	if w, h := Dimensions(filepath.Join(t.TempDir(), "nope.png")); w != 0 || h != 0 {
		t.Fatalf("got %dx%d, want 0x0", w, h)
	}
}

// The Rust shell reported 0x0 here because the image crate had no AVIF
// decoder. Reading the ISOBMFF `ispe` box gives the gallery a real layout.
func TestDimensionsOfAVIF(t *testing.T) {
	// box builds one ISO base media file format box: size, type, payload.
	box := func(typ string, payload ...[]byte) []byte {
		body := []byte(typ)
		for _, p := range payload {
			body = append(body, p...)
		}
		out := binary.BigEndian.AppendUint32(nil, uint32(len(body)+4))
		return append(out, body...)
	}
	zero4 := []byte{0, 0, 0, 0} // version + flags

	ispe := box("ispe",
		zero4,
		binary.BigEndian.AppendUint32(nil, 3000),
		binary.BigEndian.AppendUint32(nil, 2300),
	)
	avif := box("ftyp", []byte("avif"), zero4, zero4)
	avif = append(avif, box("meta",
		zero4, // FullBox version/flags
		box("iprp", box("ipco", ispe)),
	)...)

	path := tempFile(t, "a.avif", avif)
	w, h := Dimensions(path)
	if w != 3000 || h != 2300 {
		t.Fatalf("AVIF dimensions = %dx%d, want 3000x2300", w, h)
	}
}

// The ICO directory is read again after the header, from the start of the
// file — this path silently returned 0x0 while the header read had left the
// handle at EOF.
func TestDimensionsOfICO(t *testing.T) {
	dir := []byte{0, 0, 1, 0, 1, 0} // reserved, type=icon, one image

	// The DIB inside an icon entry: a BITMAPINFOHEADER, then bottom-up
	// 32-bit BGRA pixels, then the 1-bit AND mask. biHeight counts image
	// plus mask, so it is twice the visible height.
	const w, h = 48, 48
	dib := make([]byte, 40)
	binary.LittleEndian.PutUint32(dib[0:4], 40)   // header size
	binary.LittleEndian.PutUint32(dib[4:8], w)    // width
	binary.LittleEndian.PutUint32(dib[8:12], h*2) // image + mask
	binary.LittleEndian.PutUint16(dib[12:14], 1)  // planes
	binary.LittleEndian.PutUint16(dib[14:16], 32) // bit count
	pixels := make([]byte, w*h*4)
	copy(pixels, []byte{0xBB, 0x00, 0x00, 0xFF}) // one BGR pixel, rest transparent
	dib = append(dib, pixels...)
	dib = append(dib, make([]byte, h*6)...) // AND mask, 4 bytes per row padded

	// Directory entry: width, height, colours, reserved, planes, bits,
	// size, offset.
	entry := make([]byte, 16)
	entry[0], entry[1] = w, h
	binary.LittleEndian.PutUint16(entry[4:6], 1)                     // planes
	binary.LittleEndian.PutUint16(entry[6:8], 32)                    // bits per pixel
	binary.LittleEndian.PutUint32(entry[8:12], uint32(len(dib)))     // size
	binary.LittleEndian.PutUint32(entry[12:16], uint32(len(dir)+16)) // offset

	ico := append(append([]byte{}, dir...), entry...)
	ico = append(ico, dib...)

	path := tempFile(t, "a.ico", ico)
	if w, h := Dimensions(path); w != 48 || h != 48 {
		t.Fatalf("ICO dimensions = %dx%d, want 48x48", w, h)
	}
	// And it decodes, since ICO is in the decodable set.
	kind, data, err := MakeThumbnail(path, 16)
	if err != nil {
		t.Fatal(err)
	}
	if kind == ThumbNone || len(data) == 0 {
		t.Fatal("ICO thumbnail is empty")
	}
}

func TestSVGDimensions(t *testing.T) {
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"></svg>`)
	path := tempFile(t, "a.svg", svg)
	if w, h := Dimensions(path); w != 640 || h != 480 {
		t.Fatalf("SVG dimensions = %dx%d, want 640x480", w, h)
	}
	viewBox := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"></svg>`)
	if w, h := Dimensions(tempFile(t, "b.svg", viewBox)); w != 100 || h != 50 {
		t.Fatalf("viewBox dimensions = %dx%d, want 100x50", w, h)
	}
}

/* ------------------------------- thumbnails ------------------------------ */

func TestMakeThumbnailRoundTrips(t *testing.T) {
	path := tempFile(t, "a.png", samplePNG(t))
	kind, data, err := MakeThumbnail(path, 32)
	if err != nil {
		t.Fatal(err)
	}
	if kind != ThumbPNG && kind != ThumbJPEG {
		t.Fatalf("unexpected kind %d", kind)
	}
	if len(data) == 0 {
		t.Fatal("empty thumbnail payload")
	}
	// A corrupt payload would render as a broken image rather than an
	// obvious error, so decode it back.
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("thumbnail must decode: %v", err)
	}
	if img.Bounds().Dx() != 32 || img.Bounds().Dy() != 24 {
		t.Fatalf("got %dx%d, want 32x24", img.Bounds().Dx(), img.Bounds().Dy())
	}
}

func TestMakeThumbnailRefusesUndecodableExtensions(t *testing.T) {
	path := tempFile(t, "a.svg", []byte("<svg/>"))
	if _, _, err := MakeThumbnail(path, 32); err == nil {
		t.Fatal("SVG has no pure-Go decoder and must be refused")
	}
}

func TestMakeThumbnailNeverUpscales(t *testing.T) {
	path := tempFile(t, "small.png", samplePNG(t)) // 64x48
	kind, data, err := MakeThumbnail(path, 512)
	if err != nil {
		t.Fatal(err)
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 64 {
		t.Fatalf("got width %d, want the original 64", img.Bounds().Dx())
	}
	_ = kind
}

// The stored pixels are landscape with Orientation=6; the thumbnail must
// come out portrait, because it is rotated before it is resized.
func TestThumbnailAppliesOrientation(t *testing.T) {
	path := tempFile(t, "phone.jpg", buildJPEGWithOrientation(t, OrientRotate90CW))
	_, data, err := MakeThumbnail(path, 32)
	if err != nil {
		t.Fatal(err)
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() >= img.Bounds().Dy() {
		t.Fatalf("got %dx%d, want portrait after orientation",
			img.Bounds().Dx(), img.Bounds().Dy())
	}
}

func TestThumbCacheRoundTrip(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	path := tempFile(t, "a.png", samplePNG(t))
	kind, first, err := MakeThumbCached(path, 1234, 5678, 32)
	if err != nil {
		t.Fatal(err)
	}
	// The second call must come out of the cache, byte for byte.
	kind2, second, err := MakeThumbCached(path, 1234, 5678, 32)
	if err != nil {
		t.Fatal(err)
	}
	if kind != kind2 || !bytes.Equal(first, second) {
		t.Fatal("cached thumbnail differs from the original")
	}
	// A different width is a different key.
	if _, _, err := MakeThumbCached(path, 1234, 5678, 64); err != nil {
		t.Fatal(err)
	}
}

func TestThumbBatchKeepsCallerIndices(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	dir := t.TempDir()
	var paths []string
	for i, name := range []string{"a.png", "b.png", "c.png"} {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, samplePNG(t), 0o644); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, p)
		_ = i
	}
	thumbs := ThumbBatch(paths, 32, nil)
	if len(thumbs) != 3 {
		t.Fatalf("got %d thumbnails, want 3", len(thumbs))
	}
	for i, th := range thumbs {
		if th.Index != i {
			t.Fatalf("thumb %d carries index %d", i, th.Index)
		}
	}
}

func TestThumbBatchHonoursTheFilter(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	path := tempFile(t, "a.png", samplePNG(t))
	thumbs := ThumbBatch([]string{path}, 32, func(string) bool { return false })
	if len(thumbs) != 0 {
		t.Fatalf("an untrusted path must produce no thumbnail, got %d", len(thumbs))
	}
}

func TestPackThumbsWireFormat(t *testing.T) {
	thumbs := []Thumb{
		{Index: 0, Kind: ThumbJPEG, Data: []byte("abc")},
		{Index: 7, Kind: ThumbPNG, Data: []byte("defg")},
	}
	buf := PackThumbs(thumbs)
	view := bytes.NewReader(buf)
	count := binary.LittleEndian.Uint32(mustRead(view, 4))
	if count != 2 {
		t.Fatalf("count = %d, want 2", count)
	}
	rec := mustRead(view, 13)
	if got := binary.LittleEndian.Uint32(rec[0:4]); got != 0 {
		t.Errorf("index = %d, want 0", got)
	}
	if rec[4] != ThumbJPEG {
		t.Errorf("kind = %d, want %d", rec[4], ThumbJPEG)
	}
	if got := binary.LittleEndian.Uint32(rec[5:9]); got != 0 {
		t.Errorf("first offset = %d, want 0", got)
	}
	if got := binary.LittleEndian.Uint32(rec[9:13]); got != 3 {
		t.Errorf("first length = %d, want 3", got)
	}
	rec2 := mustRead(view, 13)
	if got := binary.LittleEndian.Uint32(rec2[0:4]); got != 7 {
		t.Errorf("second index = %d, want 7", got)
	}
	if got := binary.LittleEndian.Uint32(rec2[5:9]); got != 3 {
		t.Errorf("second offset = %d, want 3 (after the first payload)", got)
	}
	payload := mustRead(view, 7)
	if string(payload) != "abcdefg" {
		t.Fatalf("payload = %q", payload)
	}
}

func mustRead(r *bytes.Reader, n int) []byte {
	b := make([]byte, n)
	if _, err := r.Read(b); err != nil {
		panic(err)
	}
	return b
}

/* ---------------------------------- scan --------------------------------- */

func TestExpandPathsFindsMediaAndSkipsOthers(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "2024", "06")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(p string) {
		t.Helper()
		if err := os.WriteFile(p, samplePNG(t), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(dir, "a.jpg"))
	write(filepath.Join(sub, "b.png"))
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ExpandPaths([]string{dir})
	if len(got) != 2 {
		t.Fatalf("got %d paths, want 2: %v", len(got), got)
	}
	for _, p := range got {
		if filepath.Ext(p) == ".txt" {
			t.Fatalf("non-media file leaked in: %s", p)
		}
	}
}

func TestExpandPathsDeduplicates(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.jpg")
	if err := os.WriteFile(p, samplePNG(t), 0o644); err != nil {
		t.Fatal(err)
	}
	got := ExpandPaths([]string{p, p, p})
	if len(got) != 1 {
		t.Fatalf("got %d paths, want 1", len(got))
	}
}

func TestSiblingsOfKeepsTheTargetExact(t *testing.T) {
	dir := t.TempDir()
	var paths []string
	for _, name := range []string{"a.jpg", "b.jpg", "c.jpg"} {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, samplePNG(t), 0o644); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, p)
	}
	// A differently-cased spelling must still resolve to the real path,
	// because Windows is case-insensitive but the frontend compares strings.
	typed := filepath.Join(dir, "b.jpg")
	got := SiblingsOf(typed)
	if len(got) != 3 {
		t.Fatalf("got %d siblings, want 3", len(got))
	}
	found := false
	for _, p := range got {
		if p == typed {
			found = true
		}
	}
	if !found {
		t.Fatalf("target %q not found verbatim in %v", typed, got)
	}
}

func TestDescribeAppliesOrientation(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "phone.jpg")
	if err := os.WriteFile(p, buildJPEGWithOrientation(t, OrientRotate90CW), 0o644); err != nil {
		t.Fatal(err)
	}
	e := Describe(p)
	if e == nil {
		t.Fatal("Describe returned nil for a real file")
	}
	if e.Width >= e.Height {
		t.Fatalf("stored 32x16 with Orientation=6 should report portrait, got %dx%d",
			e.Width, e.Height)
	}
	if e.Name != "phone.jpg" {
		t.Errorf("name = %q", e.Name)
	}
	if e.Size == 0 {
		t.Error("size should not be 0")
	}
}

func TestDescribeSkipsDirectoriesAndMissingFiles(t *testing.T) {
	dir := t.TempDir()
	if Describe(dir) != nil {
		t.Error("a directory is not an entry")
	}
	if Describe(filepath.Join(dir, "nope.jpg")) != nil {
		t.Error("a missing file is not an entry")
	}
}

func TestVideoEntriesHaveNoDimensions(t *testing.T) {
	path := tempFile(t, "a.mkv", []byte{0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0})
	e := Describe(path)
	if e == nil {
		t.Fatal("Describe returned nil")
	}
	// The WebView plays the video; its dimensions come from the page.
	if e.Width != 0 || e.Height != 0 {
		t.Fatalf("got %dx%d, want 0x0", e.Width, e.Height)
	}
}

func TestSortEntriesIsCaseInsensitive(t *testing.T) {
	entries := []Entry{{Name: "b.jpg"}, {Name: "A.jpg"}, {Name: "c.jpg"}}
	SortEntries(entries)
	want := []string{"A.jpg", "b.jpg", "c.jpg"}
	for i, e := range entries {
		if e.Name != want[i] {
			t.Fatalf("position %d = %q, want %q", i, e.Name, want[i])
		}
	}
}
