package media

import (
	"encoding/binary"
	"errors"
	"os"
)

// EXIF Orientation values as stored in tag 0x0112.
const (
	OrientNormal     = 1
	OrientFlipH      = 2
	OrientRotate180  = 3
	OrientFlipV      = 4
	OrientTranspose  = 5
	OrientRotate90CW = 6
	OrientTransverse = 7
	OrientRotate270  = 8
)

const (
	exifTagOrientation = 0x0112
	// How far into a file the Exif block may start. Camera EXIF lives in the
	// first APP1 segment, but some encoders put padding in front; a few
	// hundred KB covers every real-world case without reading a whole file.
	exifScanLimit = 512 * 1024
)

// errNoEXIF means "this file carries no orientation tag" — the normal case,
// not a failure.
var errNoEXIF = errors.New("no exif orientation")

// ReadOrientation returns the EXIF Orientation tag of path, or
// OrientNormal when the file has no EXIF block or no such tag.
//
// This is a cheap header-only probe: it runs for every image in a folder
// during import, so it must not decode the picture.
func ReadOrientation(path string) uint16 {
	f, err := os.Open(path)
	if err != nil {
		return OrientNormal
	}
	defer f.Close()

	head := make([]byte, exifScanLimit)
	n, err := f.Read(head)
	if err != nil && n == 0 {
		return OrientNormal
	}
	head = head[:n]

	if tiff, ok := findTIFFBlock(head); ok {
		return orientationFromTIFF(tiff)
	}
	return OrientNormal
}

// findTIFFBlock locates the TIFF header inside an image container's header
// bytes: raw TIFF, or the Exif payload of a JPEG APP1 / PNG eXIf / WebP EXIF
// chunk.
func findTIFFBlock(b []byte) ([]byte, bool) {
	switch {
	case len(b) >= 8 && string(b[:4]) == "II\x2a\x00":
		return b, true // little-endian TIFF, at offset 0
	case len(b) >= 8 && string(b[:4]) == "MM\x00\x2a":
		return b, true // big-endian TIFF, at offset 0
	case len(b) >= 4 && b[0] == 0xFF && b[1] == 0xD8: // JPEG
		return findExifInJPEG(b)
	case len(b) >= 12 && string(b[:8]) == "\x89PNG\r\n\x1a\n":
		return findPNGChunk(b, "eXIf")
	case len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return findRIFFChunk(b, "EXIF")
	}
	return nil, false
}

// findExifInJPEG walks the marker segments looking for APP1 ("Exif\0\0" +
// TIFF). Marker segments are length-prefixed, so the walk is exact; a
// truncated file simply stops.
func findExifInJPEG(b []byte) ([]byte, bool) {
	i := 2 // skip SOI
	for i+4 <= len(b) {
		if b[i] != 0xFF {
			return nil, false // not a marker: malformed, stop
		}
		marker := b[i+1]
		// Standalone markers carry no length.
		if marker == 0xD8 || marker == 0xD9 || (marker >= 0xD0 && marker <= 0xD7) || marker == 0xFF {
			i += 2
			continue
		}
		if marker == 0xDA || marker == 0xD9 {
			return nil, false // start of scan / end of image: no EXIF ahead
		}
		if i+4 > len(b) {
			return nil, false
		}
		size := int(binary.BigEndian.Uint16(b[i+2 : i+4]))
		if size < 2 || i+2+size > len(b) {
			return nil, false
		}
		payload := b[i+4 : i+2+size]
		if marker == 0xE1 && len(payload) >= 6 && string(payload[:6]) == "Exif\x00\x00" {
			tiff := payload[6:]
			if len(tiff) >= 8 {
				return tiff, true
			}
		}
		i += 2 + size
	}
	return nil, false
}

// findPNGChunk returns the payload of the first PNG chunk with the given
// fourcc. Chunks are [len][type][data][crc], big-endian.
func findPNGChunk(b []byte, want string) ([]byte, bool) {
	for i := 8; i+8 <= len(b); {
		size := int(binary.BigEndian.Uint32(b[i : i+4]))
		if size < 0 || i+8+size > len(b) {
			return nil, false
		}
		if string(b[i+4:i+8]) == want {
			return b[i+8 : i+8+size], true
		}
		i += 8 + size + 4 // skip the CRC
	}
	return nil, false
}

// findRIFFChunk returns the payload of the first RIFF sub-chunk with the
// given fourcc.
func findRIFFChunk(b []byte, want string) ([]byte, bool) {
	for i := 12; i+8 <= len(b); {
		size := int(binary.LittleEndian.Uint32(b[i+4 : i+8]))
		if i+8+size > len(b) {
			return nil, false
		}
		if string(b[i:i+4]) == want {
			return b[i+8 : i+8+size], true
		}
		i += 8 + size + (size & 1) // chunks are word-aligned
	}
	return nil, false
}

// orientationFromTIFF reads tag 0x0112 out of IFD0.
func orientationFromTIFF(tiff []byte) uint16 {
	var bo binary.ByteOrder
	switch string(tiff[:4]) {
	case "II\x2a\x00":
		bo = binary.LittleEndian
	case "MM\x00\x2a":
		bo = binary.BigEndian
	default:
		return OrientNormal
	}
	if len(tiff) < 8 {
		return OrientNormal
	}
	ifd := int(bo.Uint32(tiff[4:8]))
	if ifd < 8 || ifd+2 > len(tiff) {
		return OrientNormal
	}
	count := int(bo.Uint16(tiff[ifd : ifd+2]))
	for i := 0; i < count; i++ {
		e := ifd + 2 + i*12
		if e+12 > len(tiff) {
			break
		}
		if bo.Uint16(tiff[e:e+2]) != exifTagOrientation {
			continue
		}
		// A SHORT in the first two bytes of the value slot; anything wider
		// would not be a sane orientation.
		if bo.Uint16(tiff[e+8:e+10]) < 1 || bo.Uint16(tiff[e+8:e+10]) > 8 {
			return OrientNormal
		}
		return bo.Uint16(tiff[e+8 : e+10])
	}
	return OrientNormal
}

// ApplyOrientation reports whether width and height must swap for the given
// EXIF orientation. Only the four rotations swap them; the mirror-only
// values keep the aspect ratio.
func ApplyOrientation(width, height uint32, orientation uint16) (uint32, uint32) {
	switch orientation {
	case OrientTranspose, OrientRotate90CW, OrientTransverse, OrientRotate270:
		return height, width
	default:
		return width, height
	}
}
