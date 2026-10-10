package media

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/gif" // registers the GIF decoder for image.Decode
	"image/jpeg"
	"image/png"
	"io"
	"os"

	"golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	"golang.org/x/image/tiff"
	"golang.org/x/image/webp"
)

// Thumbnail encodings, matching the packed record the frontend expects.
const (
	// ThumbNone means no thumbnail was produced.
	ThumbNone uint8 = 0
	// ThumbJPEG is a JPEG payload.
	ThumbJPEG uint8 = 1
	// ThumbPNG is a PNG payload.
	ThumbPNG uint8 = 2
)

const thumbJPEGQuality = 82

// Dimensions reads the pixel size straight from a file's header — no decode.
// It is cheap enough to run in parallel across a whole folder during import.
//
// It understands more containers than the decoder: AVIF/HEIF get their size
// from the ISOBMFF `ispe` box and SVG from its width/height/viewBox, so the
// gallery can lay them out even though it cannot decode them.
func Dimensions(path string) (uint32, uint32) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0
	}
	defer f.Close()

	head := make([]byte, 64*1024)
	n, _ := io.ReadFull(f, head)
	head = head[:n]

	switch {
	case len(head) >= 4 && head[0] == 0xFF && head[1] == 0xD8:
		return jpegDimensions(head)
	case len(head) >= 24 && string(head[:8]) == "\x89PNG\r\n\x1a\n":
		return binary.BigEndian.Uint32(head[16:20]), binary.BigEndian.Uint32(head[20:24])
	case len(head) >= 10 && string(head[:6]) == "GIF87a" || string(head[:6]) == "GIF89a":
		return uint32(binary.LittleEndian.Uint16(head[6:8])), uint32(binary.LittleEndian.Uint16(head[8:10]))
	case len(head) >= 26 && string(head[:2]) == "BM":
		return binary.LittleEndian.Uint32(head[18:22]), binary.LittleEndian.Uint32(head[22:26])
	case len(head) >= 30 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WEBP":
		return webpDimensions(head)
	case len(head) >= 8 && (string(head[:4]) == "II\x2a\x00" || string(head[:4]) == "MM\x00\x2a"):
		return tiffDimensions(head)
	case len(head) >= 6 && head[0] == 0 && head[1] == 0 && head[2] == 1 && head[3] == 0:
		return icoDimensions(f)
	case len(head) >= 12 && string(head[4:8]) == "ftyp":
		return isobmffDimensions(f)
	}
	return svgDimensions(head)
}

// jpegDimensions scans the SOFn markers, which carry the frame size.
func jpegDimensions(b []byte) (uint32, uint32) {
	i := 2
	for i+9 < len(b) {
		if b[i] != 0xFF {
			return 0, 0
		}
		marker := b[i+1]
		switch {
		case marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7):
			i += 2
			continue
		case marker == 0xD9 || marker == 0xDA:
			return 0, 0 // end of image / start of scan
		}
		if i+4 > len(b) {
			return 0, 0
		}
		size := int(binary.BigEndian.Uint16(b[i+2 : i+4]))
		// SOF0..SOF15 carry the size, except the four markers in that
		// range that do not (DHT/JPG/DAC).
		if marker >= 0xC0 && marker <= 0xCF &&
			marker != 0xC4 && marker != 0xC8 && marker != 0xCC {
			if i+9 > len(b) {
				return 0, 0
			}
			// SOF layout: marker, length, precision, height, width.
			return uint32(binary.BigEndian.Uint16(b[i+7 : i+9])),
				uint32(binary.BigEndian.Uint16(b[i+5 : i+7]))
		}
		if size < 2 || i+2+size > len(b) {
			return 0, 0
		}
		i += 2 + size
	}
	return 0, 0
}

// webpDimensions reads the three WebP chunk layouts: lossy VP8, lossless
// VP8L, and the extended VP8X that only stores a canvas delta.
func webpDimensions(b []byte) (uint32, uint32) {
	switch string(b[12:16]) {
	case "VP8 ":
		// Keyframe header: 3-byte tag, 3-byte start code, then 14 bits of
		// width and height.
		if len(b) < 30 {
			return 0, 0
		}
		w := binary.LittleEndian.Uint16(b[26:28]) & 0x3FFF
		h := binary.LittleEndian.Uint16(b[28:30]) & 0x3FFF
		return uint32(w), uint32(h)
	case "VP8L":
		if len(b) < 25 {
			return 0, 0
		}
		bits := binary.LittleEndian.Uint32(b[21:25])
		return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
	case "VP8X":
		if len(b) < 30 {
			return 0, 0
		}
		w := uint32(b[24]) | uint32(b[25])<<8 | uint32(b[26])<<16
		h := uint32(b[27]) | uint32(b[28])<<8 | uint32(b[29])<<16
		return w + 1, h + 1
	}
	return 0, 0
}

// tiffDimensions reads the ImageWidth/ImageLength tags out of IFD0.
func tiffDimensions(b []byte) (uint32, uint32) {
	var bo binary.ByteOrder
	switch string(b[:4]) {
	case "II\x2a\x00":
		bo = binary.LittleEndian
	case "MM\x00\x2a":
		bo = binary.BigEndian
	default:
		return 0, 0
	}
	if len(b) < 8 {
		return 0, 0
	}
	ifd := int(bo.Uint32(b[4:8]))
	if ifd < 8 || ifd+2 > len(b) {
		return 0, 0
	}
	count := int(bo.Uint16(b[ifd : ifd+2]))
	var w, h uint32
	for i := 0; i < count; i++ {
		e := ifd + 2 + i*12
		if e+12 > len(b) {
			break
		}
		tag := bo.Uint16(b[e : e+2])
		if tag != 0x0100 && tag != 0x0101 {
			continue
		}
		v := bo.Uint32(b[e+8 : e+12])
		if tag == 0x0100 {
			w = v
		} else {
			h = v
		}
	}
	return w, h
}

// icoDimensions reports the largest icon in the file, which is the one a
// viewer should show.
//
// It re-reads from the start of the file: the caller has already consumed the
// header, and `Dimensions` hands out one open file.
func icoDimensions(f *os.File) (uint32, uint32) {
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return 0, 0
	}
	head := make([]byte, 6)
	if _, err := io.ReadFull(f, head); err != nil || binary.LittleEndian.Uint16(head[:2]) != 0 {
		return 0, 0
	}
	n := int(binary.LittleEndian.Uint16(head[4:6]))
	if n <= 0 {
		return 0, 0
	}
	dir := make([]byte, n*16)
	if _, err := io.ReadFull(f, dir); err != nil {
		return 0, 0
	}
	var bestW, bestH uint32
	for i := 0; i < n; i++ {
		e := dir[i*16:]
		w, h := uint32(e[0]), uint32(e[1])
		if w == 0 {
			w = 256 // 0 means 256 in the ICO directory
		}
		if h == 0 {
			h = 256
		}
		if w*h > bestW*bestH {
			bestW, bestH = w, h
		}
	}
	return bestW, bestH
}

// isobmffDimensions walks the ISO base media file format boxes for the `ispe`
// item-spatial-extents property, which AVIF/HEIC carry for every image item.
// It is a handful of seeks, no decoding.
func isobmffDimensions(f *os.File) (uint32, uint32) {
	const cap = 8 * 1024 * 1024
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return 0, 0
	}
	fi, err := f.Stat()
	if err != nil {
		return 0, 0
	}
	n := fi.Size()
	if n > cap {
		n = cap
	}
	buf := make([]byte, n)
	got, _ := io.ReadFull(f, buf)
	return ispeIn(buf[:got])
}

// ispeIn scans a buffer for the `ispe` box anywhere inside the box tree.
func ispeIn(buf []byte) (uint32, uint32) {
	// Walk top-level boxes; `meta` and `moov` hold a nested FullBox payload
	// of more boxes, so recurse into them.
	var walk func(b []byte, depth int) (uint32, uint32)
	walk = func(b []byte, depth int) (uint32, uint32) {
		if depth > 4 {
			return 0, 0
		}
		for i := 0; i+8 <= len(b); {
			size := int(binary.BigEndian.Uint32(b[i : i+4]))
			typ := string(b[i+4 : i+8])
			body := i + 8
			switch {
			case size == 1:
				if i+16 > len(b) {
					return 0, 0
				}
				size = int(binary.BigEndian.Uint64(b[i+8 : i+16]))
				body = i + 16
			case size == 0:
				size = len(b) - i // runs to the end of the buffer
			}
			if size < 8 || i+size > len(b) {
				return 0, 0
			}
			switch typ {
			case "ispe":
				p := b[body:]
				if len(p) >= 12 {
					// version/flags (4) then width and height.
					return binary.BigEndian.Uint32(p[4:8]), binary.BigEndian.Uint32(p[8:12])
				}
			case "meta":
				// `meta` is a FullBox: its children start after the
				// version/flags word. The plain containers below do not
				// have one, and skipping four bytes there would walk past
				// the box we are looking for.
				if off := body + 4; off <= i+size {
					if w, h := walk(b[off:i+size], depth+1); w != 0 && h != 0 {
						return w, h
					}
				}
			case "moov", "trak", "mdia", "minf", "stbl", "iprp", "ipco":
				if body <= i+size {
					if w, h := walk(b[body:i+size], depth+1); w != 0 && h != 0 {
						return w, h
					}
				}
			}
			i += size
		}
		return 0, 0
	}
	return walk(buf, 0)
}

// svgDimensions reads an SVG's intrinsic size, falling back to viewBox. SVG
// is not decodable, so this is the only size signal the gallery gets.
func svgDimensions(b []byte) (uint32, uint32) {
	if len(b) < 5 || !bytes.Contains(b[:min(len(b), 1024)], []byte("<svg")) {
		return 0, 0
	}
	head := b[:min(len(b), 4096)]
	attr := func(name string) float64 {
		i := bytes.Index(head, []byte(name+"="))
		if i < 0 {
			return 0
		}
		rest := head[i+len(name)+1:]
		if len(rest) == 0 {
			return 0
		}
		quote := rest[0]
		if quote != '"' && quote != '\'' {
			return 0
		}
		end := bytes.IndexByte(rest[1:], quote)
		if end < 0 {
			return 0
		}
		var v float64
		_, err := fmt.Sscanf(string(rest[1:1+end]), "%g", &v)
		if err != nil || v <= 0 {
			return 0
		}
		return v
	}
	if w, h := attr("width"), attr("height"); w > 0 && h > 0 {
		return uint32(w), uint32(h)
	}
	// viewBox="minx miny w h"
	i := bytes.Index(head, []byte("viewBox="))
	if i >= 0 {
		rest := head[i+len("viewBox="):]
		if len(rest) > 1 {
			quote := rest[0]
			end := bytes.IndexByte(rest[1:], quote)
			if end > 0 {
				var _, _, w, h float64
				if _, err := fmt.Sscanf(string(rest[1:1+end]), "%g %g %g %g", new(float64), new(float64), &w, &h); err == nil && w > 0 && h > 0 {
					return uint32(w), uint32(h)
				}
			}
		}
	}
	return 0, 0
}

// Decode reads and decodes an image. It supports the formats in
// DecodableExts and nothing else — callers must check IsDecodable first.
func Decode(path string) (image.Image, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	switch Ext(path) {
	case "ico", "cur":
		return decodeICO(data)
	case "bmp", "dib":
		return bmp.Decode(bytes.NewReader(data))
	case "tif", "tiff":
		return tiff.Decode(bytes.NewReader(data))
	case "webp":
		return webp.Decode(bytes.NewReader(data))
	default:
		img, _, err := image.Decode(bytes.NewReader(data))
		return img, err
	}
}

// decodeICO reads a .ico/.cur container. Each entry is either a whole PNG
// file or a headerless DIB whose height field covers both the XOR and AND
// masks, hence the doubling.
func decodeICO(data []byte) (image.Image, error) {
	if len(data) < 6 || binary.LittleEndian.Uint16(data[:2]) != 0 {
		return nil, errors.New("not an ico file")
	}
	n := int(binary.LittleEndian.Uint16(data[4:6]))
	if n <= 0 || 6+n*16 > len(data) {
		return nil, errors.New("ico directory out of range")
	}
	type candidate struct {
		w, h int
		off  int
		size int
	}
	best := candidate{}
	for i := 0; i < n; i++ {
		e := data[6+i*16:]
		w, h := int(e[0]), int(e[1])
		if w == 0 {
			w = 256
		}
		if h == 0 {
			h = 256
		}
		size := int(binary.LittleEndian.Uint32(e[8:12]))
		off := int(binary.LittleEndian.Uint32(e[12:16]))
		if size <= 0 || off+size > len(data) {
			continue
		}
		if w*h > best.w*best.h {
			best = candidate{w, h, off, size}
		}
	}
	if best.w == 0 {
		return nil, errors.New("ico has no usable entry")
	}
	payload := data[best.off : best.off+best.size]
	// PNG-compressed entry: the payload is a complete PNG file.
	if len(payload) >= 8 && string(payload[:8]) == "\x89PNG\r\n\x1a\n" {
		img, _, err := image.Decode(bytes.NewReader(payload))
		return img, err
	}
	return decodeICOBitmap(payload, best.w, best.h)
}

// decodeICOBitmap reads the DIB inside an icon entry: BITMAPINFOHEADER,
// palette, 32-bit bottom-up BGRA pixels, then the 1-bit AND mask.
func decodeICOBitmap(payload []byte, w, h int) (image.Image, error) {
	if len(payload) < 40 {
		return nil, errors.New("dib header too short")
	}
	headerSize := int(binary.LittleEndian.Uint32(payload[0:4]))
	bitCount := int(binary.LittleEndian.Uint16(payload[14:16]))
	colorsUsed := int(binary.LittleEndian.Uint32(payload[32:36]))

	if headerSize != 40 || bitCount != 32 {
		return nil, fmt.Errorf("unsupported dib: header=%d bits=%d", headerSize, bitCount)
	}
	palette := colorsUsed
	if palette == 0 {
		palette = 256
	}
	off := headerSize + palette*4
	if off > len(payload) {
		return nil, errors.New("dib palette out of range")
	}
	// The stored height covers image + mask; we only want the image.
	imgH := h
	pix := payload[off:]
	out := image.NewNRGBA(image.Rect(0, 0, w, imgH))
	for y := 0; y < imgH; y++ {
		row := (imgH - 1 - y) * w * 4 // bottom-up
		for x := 0; x < w; x++ {
			p := row + x*4
			if p+4 > len(pix) {
				break
			}
			out.SetNRGBA(x, y, color.NRGBA{R: pix[p+2], G: pix[p+1], B: pix[p], A: pix[p+3]})
		}
	}
	return out, nil
}

// MakeThumbnail decodes path, applies its EXIF orientation, resizes to fit
// target×target and re-encodes: PNG when the image has an alpha channel,
// JPEG otherwise.
//
// The returned kind is ThumbPNG, ThumbJPEG or ThumbNone.
func MakeThumbnail(path string, target uint32) (uint8, []byte, error) {
	if !IsDecodable(path) {
		return ThumbNone, nil, fmt.Errorf("undecodable extension %q", Ext(path))
	}
	img, err := Decode(path)
	if err != nil {
		return ThumbNone, nil, err
	}
	b := img.Bounds()
	if uint64(b.Dx())*uint64(b.Dy()) > MaxPixels {
		return ThumbNone, nil, errors.New("image exceeds pixel budget")
	}

	// The decoder hands back physical pixels, while phone photos keep their
	// rotation in the EXIF Orientation tag — a vertical shot decodes
	// sideways. Rotate before resizing, otherwise every portrait thumbnail
	// lies. (The full-size view is fine: WebView2 applies Orientation on its
	// own.)
	if o := ReadOrientation(path); o != OrientNormal {
		img = reorient(img, o)
	}

	resized := resizeFit(img, target)
	var buf bytes.Buffer
	if hasAlpha(img) {
		if err := encodePNG(&buf, resized); err != nil {
			return ThumbNone, nil, err
		}
		return ThumbPNG, buf.Bytes(), nil
	}
	if err := encodeJPEG(&buf, resized, thumbJPEGQuality); err != nil {
		return ThumbNone, nil, err
	}
	return ThumbJPEG, buf.Bytes(), nil
}

// resizeFit scales img to fit inside a target×target box, preserving the
// aspect ratio. Never upscales: a small icon stays small.
func resizeFit(img image.Image, target uint32) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 || target == 0 {
		return img
	}
	if int64(w) <= int64(target) && int64(h) <= int64(target) {
		return img
	}
	scale := float64(target) / float64(max64(int64(w), int64(h)))
	dw := max(1, int(float64(w)*scale))
	dh := max(1, int(float64(h)*scale))
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	// BiLinear matches the Rust shell's Triangle filter.
	draw.BiLinear.Scale(dst, dst.Bounds(), img, b, draw.Src, nil)
	return dst
}

// reorient applies an EXIF orientation to the pixels.
func reorient(img image.Image, o uint16) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 || o == OrientNormal {
		return img
	}
	swapped := o == OrientTranspose || o == OrientRotate90CW ||
		o == OrientTransverse || o == OrientRotate270
	ow, oh := w, h
	if swapped {
		ow, oh = h, w
	}
	out := image.NewRGBA(image.Rect(0, 0, ow, oh))
	at := func(x, y int) color.Color { return img.At(b.Min.X+x, b.Min.Y+y) }
	for y := 0; y < oh; y++ {
		for x := 0; x < ow; x++ {
			var sx, sy int
			switch o {
			case OrientFlipH:
				sx, sy = w-1-x, y
			case OrientRotate180:
				sx, sy = w-1-x, h-1-y
			case OrientFlipV:
				sx, sy = x, h-1-y
			case OrientTranspose:
				sx, sy = y, x
			case OrientRotate90CW:
				sx, sy = y, h-1-x
			case OrientTransverse:
				sx, sy = w-1-y, h-1-x
			case OrientRotate270:
				sx, sy = w-1-y, x
			default:
				sx, sy = x, y
			}
			out.Set(x, y, at(sx, sy))
		}
	}
	return out
}

// hasAlpha reports whether img carries an alpha channel — the same question
// the Rust shell's DynamicImage::has_alpha asked, so PNG vs JPEG thumbnails
// stay identical.
func hasAlpha(img image.Image) bool {
	switch img.ColorModel() {
	case color.GrayModel, color.Gray16Model, color.RGBAModel,
		color.NRGBAModel, color.AlphaModel, color.Alpha16Model:
		return false
	}
	// A concrete type check catches the common decoders' palettes and
	// greyscales without paying for a full pixel scan.
	switch img.(type) {
	case *image.Gray, *image.Gray16, *image.YCbCr, *image.NYCbCrA:
		return false
	}
	return true
}

func encodePNG(w io.Writer, img image.Image) error {
	return png.Encode(w, img)
}

func encodeJPEG(w io.Writer, img image.Image, quality int) error {
	return jpeg.Encode(w, img, &jpeg.Options{Quality: quality})
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
