// Container header parsing for the video info panel: duration, codec, frame
// rate, audio layout. Hand-rolled on purpose — the fields we show are a
// handful of header numbers, and pulling in a demuxer library for that would
// dwarf the whole app. Only headers are read: a 500 GB file costs the same few
// seeks as a 5 MB one, and malformed files must degrade to "no info" instead
// of taking the process down.
//
// Ported from the original Tauri + Rust shell, function by function; the
// comments explaining *why* each parser is shaped the way it is were kept on
// purpose. The original lives in git history:
// `git log --diff-filter=D -- src-tauri/src/media_info.rs`.
package media

import (
	"fmt"
	"io"
	"math"
	"math/bits"
	"os"
	"strings"
)

// MediaInfo mirrors the Rust struct of the same name. Field tags follow
// serde's rename_all = "camelCase"; the Rust side has no
// skip_serializing_if, so Option<T> fields serialize as explicit null — the
// pointer fields below therefore must NOT grow omitempty (the frontend TS
// types are `container?: string | null`, and omitting a key is not the same
// as sending null).
type MediaInfo struct {
	Container  string       `json:"container"`
	DurationMS *uint64      `json:"durationMs"`
	Video      *VideoStream `json:"video"`
	Audio      *AudioStream `json:"audio"`
}

// VideoStream describes the first video track found.
type VideoStream struct {
	Codec  string   `json:"codec"`
	Width  *uint32  `json:"width"`
	Height *uint32  `json:"height"`
	FPS    *float64 `json:"fps"`
}

// AudioStream describes the first audio track found.
type AudioStream struct {
	Codec      string  `json:"codec"`
	SampleRate *uint32 `json:"sampleRate"`
	Channels   *uint8  `json:"channels"`
}

// Read sniffs the container from the first bytes, then runs its parser. Every
// parse is best-effort: unsupported formats and truncated files simply return
// whatever was found (possibly nothing), and only an unopenable path errors.
func Read(path string) (MediaInfo, error) {
	f, err := os.Open(path)
	if err != nil {
		return MediaInfo{}, err
	}
	defer f.Close()

	var head [16]byte
	if readUpTo(f, 0, head[:]) < len(head) {
		return MediaInfo{}, nil
	}
	var info MediaInfo
	switch {
	case string(head[4:8]) == "ftyp":
		info.Container = mp4ContainerName(head[8:12])
		parseMP4(f, &info)
	case string(head[:4]) == "\x1aE\xdf\xa3":
		parseEBML(f, &info)
	case string(head[0:4]) == "RIFF" && string(head[8:12]) == "AVI ":
		info.Container = "AVI"
		parseAVI(f, &info)
	case string(head[0:3]) == "FLV":
		info.Container = "Flash Video (FLV)"
		parseFLV(f, &info)
	case string(head[0:4]) == "\x30\x26\xb2\x75":
		info.Container = "Windows Media Video (ASF)"
		parseASF(f, &info)
	}
	return info, nil
}

/* ------------------------------- primitives ------------------------------ */

// readUpTo reads up to len(buf) bytes starting at `at`. Short reads are fine
// here: every caller treats missing bytes as "stop parsing", not as an error.
func readUpTo(f *os.File, at uint64, buf []byte) int {
	if _, err := f.Seek(int64(at), io.SeekStart); err != nil {
		return 0
	}
	got := 0
	for got < len(buf) {
		n, _ := f.Read(buf[got:])
		if n <= 0 {
			break // EOF or error: callers treat missing bytes as "stop"
		}
		got += n
	}
	return got
}

// fileLen is `f.metadata().map(|m| m.len()).unwrap_or(0)`.
func fileLen(f *os.File) uint64 {
	st, err := f.Stat()
	if err != nil {
		return 0
	}
	return uint64(st.Size())
}

func beU16(b []byte, at int) (uint16, bool) {
	if at < 0 || at+2 > len(b) {
		return 0, false
	}
	return uint16(b[at])<<8 | uint16(b[at+1]), true
}

func beU32(b []byte, at int) (uint32, bool) {
	if at < 0 || at+4 > len(b) {
		return 0, false
	}
	return uint32(b[at])<<24 | uint32(b[at+1])<<16 | uint32(b[at+2])<<8 | uint32(b[at+3]), true
}

func beU64(b []byte, at int) (uint64, bool) {
	if at < 0 || at+8 > len(b) {
		return 0, false
	}
	var v uint64
	for i := 0; i < 8; i++ {
		v = v<<8 | uint64(b[at+i])
	}
	return v, true
}

func leU16(b []byte, at int) (uint16, bool) {
	if at < 0 || at+2 > len(b) {
		return 0, false
	}
	return uint16(b[at]) | uint16(b[at+1])<<8, true
}

func leU32(b []byte, at int) (uint32, bool) {
	if at < 0 || at+4 > len(b) {
		return 0, false
	}
	return uint32(b[at]) | uint32(b[at+1])<<8 | uint32(b[at+2])<<16 | uint32(b[at+3])<<24, true
}

func leI32(b []byte, at int) (int32, bool) {
	v, ok := leU32(b, at)
	return int32(v), ok
}

func leU64(b []byte, at int) (uint64, bool) {
	if at < 0 || at+8 > len(b) {
		return 0, false
	}
	var v uint64
	for i := 7; i >= 0; i-- {
		v = v<<8 | uint64(b[at+i])
	}
	return v, true
}

// sliceAt is Rust's `b.get(from..to)`.
func sliceAt(b []byte, from, to int) ([]byte, bool) {
	if from < 0 || to < from || to > len(b) {
		return nil, false
	}
	return b[from:to], true
}

// lossy is String::from_utf8_lossy.
func lossy(b []byte) string { return strings.ToValidUTF8(string(b), "�") }

// Pointer helpers — Rust's Option<T> fields become *T.

func u64p(v uint64) *uint64   { return &v }
func u32p(v uint32) *uint32   { return &v }
func u8p(v uint8) *uint8      { return &v }
func f64p(v float64) *float64 { return &v }

// keepU32 is `.map(|v| v).filter(|&v| v > 0)`.
func keepU32(v uint32, ok bool) *uint32 {
	if !ok || v == 0 {
		return nil
	}
	return u32p(v)
}

// keepU16AsU32 is `.filter(|&v| v > 0).map(|v| v as u32)`.
func keepU16AsU32(v uint16, ok bool) *uint32 {
	if !ok || v == 0 {
		return nil
	}
	return u32p(uint32(v))
}

// keepU8FromU16 is `.and_then(|v| u8::try_from(v).ok())` after a > 0 filter.
func keepU8FromU16(v uint16, ok bool) *uint8 {
	if !ok || v == 0 {
		return nil
	}
	return u8p(uint8(v))
}

// validFPS is Rust's `f.is_finite() && f > 0.0 && f < 1000.0`.
func validFPS(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0) && f > 0.0 && f < 1000.0
}

// narrowU32 is Rust's integer `as u32` (modulo 2^32, not saturating).
func narrowU32(v uint64) uint32 { return uint32(v) }

// castFloatU32 is Rust's saturating `f64 as u32`; Go's conversion is
// implementation-defined outside the target range.
func castFloatU32(f float64) uint32 {
	if math.IsNaN(f) || f <= 0 {
		return 0
	}
	if f >= math.MaxUint32 {
		return math.MaxUint32
	}
	return uint32(f)
}

// castFloatU64 is Rust's saturating `f64 as u64`.
func castFloatU64(f float64) uint64 {
	if math.IsNaN(f) || f <= 0 {
		return 0
	}
	if f >= math.MaxUint64 {
		return math.MaxUint64
	}
	return uint64(f)
}

// msFrom is (dur as u128 * 1000) / timescale as u128. The Rust code uses a u128
// intermediate because a long duration at a high timescale overflows u64; here
// the same precision comes from bits.Mul64.
func msFrom(dur, timescale uint64) (uint64, bool) {
	if timescale == 0 || dur == 0 {
		return 0, false
	}
	hi, lo := bits.Mul64(dur, 1000)
	if hi >= timescale {
		// The quotient needs more than 64 bits (Rust truncates it with `as
		// u64`; bits.Div64 would panic). Saturate — this needs a duration of
		// hundreds of millions of years to reach.
		return math.MaxUint64, true
	}
	q, _ := bits.Div64(hi, lo, timescale)
	return q, true
}

/* -------------------------------- ISO BMFF -------------------------------- */

// moov may sit at either end of the file (faststart puts it first, camera
// files last). Real moov boxes are KBs, occasionally a few MB — past this we
// assume a corrupt size field rather than allocating for it.
const maxMoov = 64 * 1024 * 1024

func mp4ContainerName(brand []byte) string {
	switch {
	case string(brand) == "qt  ":
		return "QuickTime (MOV)"
	case string(brand) == "M4V ":
		return "M4V"
	case strings.HasPrefix(string(brand), "3g"):
		return "3GP"
	default:
		return "MP4"
	}
}

func parseMP4(f *os.File, info *MediaInfo) {
	length := fileLen(f)
	var pos uint64
	// Top-level boxes are a handful at most; the cap breaks malformed files
	// whose size fields would otherwise walk in circles.
	for i := 0; i < 64; i++ {
		if pos+8 > length {
			return
		}
		var hdr [8]byte
		if readUpTo(f, pos, hdr[:]) < 8 {
			return
		}
		size := uint64(beU32Or0(hdr[0:4]))
		headerLen := uint64(8)
		if size == 1 {
			var ext [8]byte
			if readUpTo(f, pos+8, ext[:]) < 8 {
				return
			}
			size, _ = beU64(ext[:], 0)
			headerLen = 16
		} else if size == 0 {
			size = length - pos // "extends to EOF"
		}
		// `size > length-pos` is the overflow-free form of Rust's
		// pos.checked_add(size).map_or(true, |end| end > len).
		if size < headerLen || size > length-pos {
			return
		}
		if string(hdr[4:8]) == "moov" {
			payload := size - headerLen
			if payload > maxMoov {
				return
			}
			buf := make([]byte, int(payload))
			if readUpTo(f, pos+headerLen, buf) == len(buf) {
				parseMoov(buf, info)
			}
			return
		}
		pos += size
	}
}

func beU32Or0(b []byte) uint32 { v, _ := beU32(b, 0); return v }

// boxPair is one (type, payload) pair of an ISO BMFF box list.
type boxPair struct {
	typ  string
	body []byte
}

// boxes lists the boxes inside a buffer. A size below 8 or past the buffer
// ends the list — truncated files should stop, not loop.
func boxes(b []byte) []boxPair {
	var out []boxPair
	for i := 0; i+8 <= len(b); {
		size := int(beU32Or0(b[i : i+4]))
		if size < 8 || i+size > len(b) {
			break
		}
		out = append(out, boxPair{string(b[i+4 : i+8]), b[i+8 : i+size]})
		i += size
	}
	return out
}

// trackTime reads an mvhd or mdhd body: the two share a layout (v0 packs
// 32-bit times, v1 64-bit ones). Sentinel durations (all bits set) mean
// "unknown" and come back as a nil duration.
func trackTime(b []byte) (timescale uint64, dur *uint64, ok bool) {
	if len(b) == 0 {
		return 0, nil, false
	}
	if b[0] == 1 {
		ts, ok1 := beU32(b, 20)
		d, ok2 := beU64(b, 24)
		if !ok1 || !ok2 {
			return 0, nil, false
		}
		if d == math.MaxUint64 {
			return uint64(ts), nil, true
		}
		return uint64(ts), u64p(d), true
	}
	ts, ok1 := beU32(b, 12)
	d, ok2 := beU32(b, 16)
	if !ok1 || !ok2 {
		return 0, nil, false
	}
	if uint64(d) == math.MaxUint32 {
		return uint64(ts), nil, true
	}
	return uint64(ts), u64p(uint64(d)), true
}

func parseMoov(b []byte, info *MediaInfo) {
	for _, bx := range boxes(b) {
		switch bx.typ {
		case "mvhd":
			if info.DurationMS == nil {
				ts, d, ok := trackTime(bx.body)
				if ok && d != nil {
					if ms, ok2 := msFrom(*d, ts); ok2 {
						info.DurationMS = u64p(ms)
					}
				}
			}
		case "trak":
			parseTrak(bx.body, info)
		}
	}
}

func parseTrak(body []byte, info *MediaInfo) {
	for _, bx := range boxes(body) {
		if bx.typ == "mdia" {
			parseMdia(bx.body, info)
		}
	}
}

func parseMdia(body []byte, info *MediaInfo) {
	handler := ""
	var timescale uint64
	var duration *uint64
	var stsd, stts []byte
	for _, bx := range boxes(body) {
		switch bx.typ {
		case "mdhd":
			if ts, d, ok := trackTime(bx.body); ok {
				timescale, duration = ts, d
			}
		case "hdlr":
			if s, ok := sliceAt(bx.body, 8, 12); ok {
				handler = string(s)
			}
		case "minf":
			for _, b2 := range boxes(bx.body) {
				if b2.typ != "stbl" {
					continue
				}
				for _, b3 := range boxes(b2.body) {
					switch b3.typ {
					case "stsd":
						stsd = b3.body
					case "stts":
						stts = b3.body
					}
				}
			}
		}
	}
	switch handler {
	case "vide":
		// First video track only — secondary tracks (previews, cover art)
		// would overwrite the info the user actually cares about.
		if info.Video == nil {
			codec, width, height := stsdVideo(stsd)
			var fps *float64
			if timescale > 0 {
				if f, ok := sttsFPS(stts, timescale); ok {
					fps = f64p(f)
				}
			}
			info.Video = &VideoStream{Codec: codec, Width: width, Height: height, FPS: fps}
		}
		if info.DurationMS == nil && duration != nil {
			if ms, ok := msFrom(*duration, timescale); ok {
				info.DurationMS = u64p(ms)
			}
		}
	case "soun":
		if info.Audio == nil {
			codec, sampleRate, channels := stsdAudio(stsd)
			info.Audio = &AudioStream{Codec: codec, SampleRate: sampleRate, Channels: channels}
		}
	}
}

// stsdEntry returns the first sample entry of an stsd body: [size][format]
// [body…]. The format fourcc IS the codec tag.
func stsdEntry(stsd []byte) ([]byte, bool) {
	entries, ok := sliceAt(stsd, 8, len(stsd)) // version/flags + entry_count
	if !ok {
		return nil, false
	}
	// Rust indexes entries[0..4] directly, which panics on an stsd whose body
	// is exactly 8 bytes long; the bounds check keeps that a clean None.
	if len(entries) < 4 {
		return nil, false
	}
	size := int(beU32Or0(entries[0:4]))
	if size < 8 || size > len(entries) {
		return nil, false
	}
	return entries[:size], true
}

func stsdVideo(stsd []byte) (string, *uint32, *uint32) {
	entry, ok := stsdEntry(stsd)
	if !ok {
		return "", nil, nil
	}
	codec := ""
	if four, ok := sliceAt(entry, 4, 8); ok {
		codec = videoCodecName(four)
	}
	// VisualSampleEntry: 8 box header + 8 reserved/dataref + 16 predefined
	// → width/height u16 at 32/34.
	w, okw := beU16(entry, 32)
	h, okh := beU16(entry, 34)
	return codec, keepU16AsU32(w, okw), keepU16AsU32(h, okh)
}

func stsdAudio(stsd []byte) (string, *uint32, *uint8) {
	entry, ok := stsdEntry(stsd)
	if !ok {
		return "", nil, nil
	}
	codec := ""
	if four, ok := sliceAt(entry, 4, 8); ok {
		codec = audioCodecName(four)
	}
	// AudioSampleEntry: channelcount u16 @24, samplerate as 16.16 fixed @32.
	ch, okch := beU16(entry, 24)
	raw, okrate := beU32(entry, 32)
	rate := uint32(0)
	if okrate {
		rate = raw >> 16
	}
	return codec, keepU32(rate, okrate), keepU8FromU16(ch, okch)
}

// sttsFPS derives the average frame rate from the time-to-sample table:
// fps = samples × timescale / Σ(count × delta). The entry count is capped —
// a corrupt table can claim billions of runs.
func sttsFPS(stts []byte, timescale uint64) (float64, bool) {
	countU32, ok := beU32(stts, 4)
	if !ok {
		return 0, false
	}
	var samples uint64
	// Rust accumulates Σ(count × delta) in a u128; 4096 capped entries of
	// (2^32-1)² each would overflow u64, so the high word is kept explicitly
	// and the sum stays a true 128-bit value.
	var spanLo, spanHi uint64
	at := 8
	for n, limit := 0, min(int(countU32), 4096); n < limit; n++ {
		c, ok1 := beU32(stts, at)
		d, ok2 := beU32(stts, at+4)
		if !ok1 || !ok2 {
			break
		}
		samples += uint64(c)
		hi, lo := bits.Mul64(uint64(c), uint64(d))
		var carry uint64
		spanLo, carry = bits.Add64(spanLo, lo, 0)
		spanHi, _ = bits.Add64(spanHi, hi, carry)
		at += 8
	}
	if samples == 0 || (spanLo == 0 && spanHi == 0) || timescale == 0 {
		return 0, false
	}
	span := float64(spanLo)
	if spanHi != 0 {
		span = math.Ldexp(float64(spanHi), 64) + span
	}
	fps := float64(samples) * float64(timescale) / span
	if validFPS(fps) {
		return fps, true
	}
	return 0, false
}

func videoCodecName(four []byte) string {
	switch strings.TrimSpace(lossy(four)) {
	case "avc1", "avc2", "avc3":
		return "H.264 / AVC"
	case "hev1", "hvc1":
		return "H.265 / HEVC"
	case "vp09":
		return "VP9"
	case "vp08":
		return "VP8"
	case "av01":
		return "AV1"
	case "mp4v":
		return "MPEG-4 Part 2"
	case "mjpg", "jpeg":
		return "MJPEG"
	case "theo":
		return "Theora"
	default:
		return strings.TrimSpace(lossy(four))
	}
}

func audioCodecName(four []byte) string {
	switch strings.TrimSpace(lossy(four)) {
	case "mp4a":
		return "AAC"
	case ".mp3", "mp3 ":
		return "MP3"
	case "ac-3":
		return "AC-3"
	case "ec-3":
		return "E-AC-3"
	case "Opus", "opus":
		return "Opus"
	case "fLaC":
		return "FLAC"
	case "alac":
		return "ALAC"
	case "sowt", "twos", "in24", "in32":
		return "PCM"
	default:
		return strings.TrimSpace(lossy(four))
	}
}

/* ------------------------------ EBML (MKV/WebM) -------------------------- */

// Info + Tracks sit at the head of the Segment (before any Cluster), so a
// few MB covers virtually every file without reading the media data.
const ebmlCap = 8 * 1024 * 1024

// vintLen is the byte length of a VINT from its leading marker bit.
func vintLen(first byte) (int, bool) {
	if first == 0 {
		return 0, false // VINTs always contain a marker bit
	}
	for k := 0; k < 8; k++ {
		if first&(0x80>>k) != 0 {
			return k + 1, true
		}
	}
	return 8, true
}

// readID reads an element ID: length marker kept — EBML IDs are matched with
// it, so the returned value is the raw 4-byte-ish ID.
func readID(b []byte, i *int) (uint32, bool) {
	first, ok := sliceAt(b, *i, *i+1)
	if !ok {
		return 0, false
	}
	n, ok := vintLen(first[0])
	if !ok {
		return 0, false
	}
	s, ok := sliceAt(b, *i, *i+n)
	if !ok {
		return 0, false
	}
	var v uint32
	for _, byte := range s {
		v = v<<8 | uint32(byte)
	}
	*i += n
	return v, true
}

// readSize reads an element data size: marker stripped, so a 1-byte size
// carries 7 value bits. An all-ones encoding means "unknown" (the size runs
// to the parent's end) and is reported through the second result.
func readSize(b []byte, i *int) (int, bool, bool) {
	first, ok := sliceAt(b, *i, *i+1)
	if !ok {
		return 0, false, false
	}
	n, ok := vintLen(first[0])
	if !ok {
		return 0, false, false
	}
	s, ok := sliceAt(b, *i, *i+n)
	if !ok {
		return 0, false, false
	}
	mask := byte(0xFF >> n) // value bits inside the first byte
	v := uint64(first[0] & mask)
	unknown := first[0]&mask == mask
	for _, byte := range s[1:] {
		v = v<<8 | uint64(byte)
		if byte != 0xFF {
			unknown = false
		}
	}
	*i += n
	if v > uint64(math.MaxInt) {
		v = uint64(math.MaxInt)
	}
	return int(v), unknown, true
}

// nextElement reads one element as (id, payload). Oversized fields clamp to
// the parent's end instead of failing — a partial payload still carries the
// numbers we want.
func nextElement(b []byte, i *int) (uint32, []byte, bool) {
	id, ok := readID(b, i)
	if !ok {
		return 0, nil, false
	}
	size, unknown, ok := readSize(b, i)
	if !ok {
		return 0, nil, false
	}
	start := *i
	avail := len(b) - start
	if avail < 0 {
		avail = 0
	}
	take := avail
	if !unknown && size < avail {
		take = size
	}
	payload, ok := sliceAt(b, start, start+take)
	if !ok {
		return 0, nil, false
	}
	*i = start + take
	return id, payload, true
}

// fnum reads an EBML float: 4- or 8-byte big-endian IEEE value.
func fnum(v []byte) (float64, bool) {
	switch len(v) {
	case 4:
		return float64(math.Float32frombits(beU32Or0(v))), true
	case 8:
		return math.Float64frombits(beU64Or0(v)), true
	default:
		return 0, false
	}
}

func beU64Or0(b []byte) uint64 { v, _ := beU64(b, 0); return v }

// ebu64 reads an EBML unsigned int: 1..8 bytes, big-endian, zero-padded.
func ebu64(v []byte) (uint64, bool) {
	switch len(v) {
	case 0:
		return 0, false
	case 4:
		return uint64(beU32Or0(v)), true
	case 8:
		return beU64Or0(v), true
	default:
		// 1..3 bytes, and anything longer: fold big-endian (the high bits
		// shift out, exactly like Rust's `acc << 8`).
		acc := uint64(0)
		for _, x := range v {
			acc = acc<<8 | uint64(x)
		}
		return acc, true
	}
}

func parseEBML(f *os.File, info *MediaInfo) {
	length := fileLen(f)
	n := min(length, ebmlCap)
	buf := make([]byte, int(n))
	got := readUpTo(f, 0, buf)
	parseEBMLBuf(buf[:got], info)
}

func parseEBMLBuf(b []byte, info *MediaInfo) {
	i := 0
	for {
		id, payload, ok := nextElement(b, &i)
		if !ok {
			return
		}
		switch id {
		case 0x1A45DFA3:
			// EBML header: DocType tells MKV from WebM.
			j := 0
			for {
				cid, p, ok2 := nextElement(payload, &j)
				if !ok2 {
					break
				}
				if cid == 0x4282 {
					switch strings.TrimSpace(lossy(p)) {
					case "webm":
						info.Container = "WebM"
					case "matroska":
						info.Container = "Matroska (MKV)"
					default:
						info.Container = strings.TrimSpace(lossy(p))
					}
					break
				}
			}
		case 0x18538067:
			parseSegment(payload, info)
			return // Segment holds everything else
		}
	}
}

func parseSegment(b []byte, info *MediaInfo) {
	i := 0
	for {
		id, payload, ok := nextElement(b, &i)
		if !ok {
			return
		}
		switch id {
		case 0x1549A966:
			parseInfo(payload, info)
		case 0x1654AE6B:
			parseTracks(payload, info)
		case 0x1F43B675:
			return // Cluster: raw media from here, stop reading
		}
	}
}

func parseInfo(b []byte, info *MediaInfo) {
	i := 0
	var scale uint64
	haveScale := false
	var durTicks *float64
	for {
		id, p, ok := nextElement(b, &i)
		if !ok {
			break
		}
		switch id {
		case 0x2AD7B1: // TimecodeScale, ns per tick
			if v, ok2 := ebu64(p); ok2 {
				scale, haveScale = v, true
			}
		case 0x4489: // Duration, in ticks
			if v, ok2 := fnum(p); ok2 {
				durTicks = f64p(v)
			}
		}
	}
	// Default per spec: one tick == one millisecond.
	if !haveScale {
		scale = 1_000_000
	}
	if durTicks != nil {
		ms := *durTicks * float64(scale) / 1_000_000.0
		if !math.IsNaN(ms) && !math.IsInf(ms, 0) && ms > 0.0 {
			info.DurationMS = u64p(castFloatU64(ms))
		}
	}
}

func parseTracks(b []byte, info *MediaInfo) {
	i := 0
	for {
		id, p, ok := nextElement(b, &i)
		if !ok {
			return
		}
		// TrackEntry (0xAE): first video and first audio win.
		if id == 0xAE && (info.Video == nil || info.Audio == nil) {
			parseTrackEntry(p, info)
		}
	}
}

func parseTrackEntry(b []byte, info *MediaInfo) {
	i := 0
	var trackType uint64
	codec := ""
	var fps *float64
	var width, height *uint32
	var rate *uint32
	var channels *uint8
	for {
		id, p, ok := nextElement(b, &i)
		if !ok {
			break
		}
		switch id {
		case 0x83: // TrackType: 1 video, 2 audio
			if v, ok2 := ebu64(p); ok2 {
				trackType = v
			}
		case 0x86:
			codec = matroskaCodecName(lossy(p))
		case 0x23E383:
			// DefaultDuration is nanoseconds per frame → fps.
			if ns, ok2 := ebu64(p); ok2 && ns > 0 {
				fps = f64p(1e9 / float64(ns))
			}
		case 0xE0: // Video element
			j := 0
			for {
				vid, vp, ok2 := nextElement(p, &j)
				if !ok2 {
					break
				}
				switch vid {
				case 0xB0:
					if v, ok3 := ebu64(vp); ok3 {
						width = keepU32(narrowU32(v), true)
					}
				case 0xBA:
					if v, ok3 := ebu64(vp); ok3 {
						height = keepU32(narrowU32(v), true)
					}
				}
			}
		case 0xE1: // Audio element
			j := 0
			for {
				aid, ap, ok2 := nextElement(p, &j)
				if !ok2 {
					break
				}
				switch aid {
				case 0xB5:
					if v, ok3 := fnum(ap); ok3 {
						rate = keepU32(castFloatU32(v), true)
					}
				case 0x9F:
					if v, ok3 := ebu64(ap); ok3 {
						channels = narrowU8(v)
					}
				}
			}
		}
	}
	if fps != nil && !validFPS(*fps) {
		fps = nil
	}
	switch trackType {
	case 1:
		if info.Video == nil {
			info.Video = &VideoStream{Codec: codec, Width: width, Height: height, FPS: fps}
		}
	case 2:
		if info.Audio == nil {
			info.Audio = &AudioStream{Codec: codec, SampleRate: rate, Channels: channels}
		}
	}
}

// narrowU8 is Rust's `v as u8` (truncating) followed by a `> 0` filter: EBML
// Channels that wraps to zero are dropped rather than reported.
func narrowU8(v uint64) *uint8 {
	u := uint8(v)
	if u == 0 {
		return nil
	}
	return u8p(u)
}

func matroskaCodecName(id string) string {
	switch id {
	case "V_MPEG4/ISO/AVC":
		return "H.264 / AVC"
	case "V_MPEGH/ISO/HEVC":
		return "H.265 / HEVC"
	case "V_VP9":
		return "VP9"
	case "V_VP8":
		return "VP8"
	case "V_AV1":
		return "AV1"
	case "V_MPEG4/ISO/SP", "V_MPEG4/ISO/ASP", "V_MPEG4/ISO/AP":
		return "MPEG-4 Part 2"
	case "V_THEORA":
		return "Theora"
	case "V_MPEG2", "V_MPEG1":
		return "MPEG"
	}
	switch {
	case strings.HasPrefix(id, "A_AAC"):
		return "AAC"
	case id == "A_OPUS":
		return "Opus"
	case id == "A_VORBIS":
		return "Vorbis"
	case id == "A_AC3":
		return "AC-3"
	case id == "A_EAC3":
		return "E-AC-3"
	case id == "A_MPEG/L3":
		return "MP3"
	case id == "A_MPEG/L2":
		return "MPEG Audio Layer 2"
	case id == "A_FLAC":
		return "FLAC"
	case id == "A_PCM/INT/LIT", id == "A_PCM/INT/BIG", id == "A_PCM/FLOAT/IEEE":
		return "PCM"
	case id == "A_TRUEHD":
		return "TrueHD"
	default:
		return id
	}
}

/* ---------------------------------- AVI ----------------------------------- */

// aviCtx is the state handed down the hdrl → strl recursion: strh (stream
// header) always precedes strf (stream format) inside one strl, so strf can
// rely on it. Empty fccType/handler mean "not set".
type aviCtx struct {
	fccType string // "vids" / "auds"
	handler string // codec hint from the stream header
	scale   uint32
	rate    uint32
	length  uint32
}

func parseAVI(f *os.File, info *MediaInfo) {
	// hdrl sits right after the RIFF header; 256 KB covers it many times over.
	const aviCap = 256 * 1024
	buf := make([]byte, aviCap)
	got := readUpTo(f, 0, buf)
	var ctx aviCtx
	// Offset 12 skips the "RIFF" size "AVI " prologue.
	scanRIFF(buf[:got], 12, got, info, &ctx)
}

func scanRIFF(b []byte, i, end int, info *MediaInfo, ctx *aviCtx) {
	for i+8 <= end {
		typ := string(b[i : i+4])
		size, _ := leU32(b, i+4)
		body := i + 8
		if body > end {
			break
		}
		stop := min(body+int(size), end)
		switch typ {
		case "LIST":
			if size >= 4 && stop >= body+4 {
				switch string(b[body : body+4]) {
				case "hdrl":
					scanRIFF(b, body+4, stop, info, ctx)
				case "strl":
					// A fresh stream — a strf must not inherit the previous
					// stream's type, so reset before descending.
					*ctx = aviCtx{}
					scanRIFF(b, body+4, stop, info, ctx)
				}
			}
		case "avih":
			parseAvih(b[body:stop], info)
		case "strh":
			parseStrh(b[body:stop], info, ctx)
		case "strf":
			parseStrf(b[body:stop], info, ctx)
		}
		i = body + int(size) + int(size&1) // chunks are word aligned
	}
}

// parseAvih reads the AVIMAINHEADER: microseconds per frame, total frames,
// usually the canvas size.
func parseAvih(b []byte, info *MediaInfo) {
	usec, _ := leU32(b, 0)
	frames, _ := leU32(b, 16)
	if usec > 0 && frames > 0 {
		info.DurationMS = u64p(uint64(frames) * uint64(usec) / 1000)
	}
	if info.Video == nil {
		width, okw := leU32(b, 32)
		height, okh := leU32(b, 36)
		var fps *float64
		if usec > 0 {
			fps = f64p(1_000_000.0 / float64(usec))
		}
		info.Video = &VideoStream{Width: keepU32(width, okw), Height: keepU32(height, okh), FPS: fps}
	}
}

// parseStrh reads the AVISTREAMHEADER: rate/scale gives fps and duration for
// video streams.
func parseStrh(b []byte, info *MediaInfo, ctx *aviCtx) {
	if s, ok := sliceAt(b, 0, 4); ok {
		ctx.fccType = string(s)
	}
	if s, ok := sliceAt(b, 4, 8); ok {
		ctx.handler = string(s)
	}
	ctx.scale, _ = leU32(b, 20)
	ctx.rate, _ = leU32(b, 24)
	ctx.length, _ = leU32(b, 32)

	if ctx.fccType == "vids" {
		if ctx.scale > 0 && ctx.rate > 0 {
			if info.Video == nil {
				info.Video = &VideoStream{}
			}
			info.Video.FPS = f64p(float64(ctx.rate) / float64(ctx.scale))
		}
		if info.DurationMS == nil && ctx.scale > 0 && ctx.rate > 0 && ctx.length > 0 {
			info.DurationMS = u64p(uint64(ctx.length) * uint64(ctx.scale) * 1000 / uint64(ctx.rate))
		}
	}
}

// parseStrf reads a stream format: video strf is a BITMAPINFOHEADER
// (biCompression = codec fourcc), audio strf a WAVEFORMATEX (tag, channels,
// sample rate).
func parseStrf(b []byte, info *MediaInfo, ctx *aviCtx) {
	switch ctx.fccType {
	case "vids":
		if len(b) < 20 {
			return
		}
		comp := b[16:20]
		name, haveName := "", false
		if comp[0] == 0 && comp[1] == 0 && comp[2] == 0 && comp[3] == 0 {
			// An empty compression field means the hint in strh is all we have.
			if ctx.handler != "" {
				name, haveName = aviVideoCodec([]byte(ctx.handler)), true
			}
		} else {
			name, haveName = aviVideoCodec(comp), true
		}
		if v := info.Video; v != nil {
			if haveName && v.Codec == "" {
				v.Codec = name
			}
			if v.Width == nil {
				// Negative height marks a top-down bitmap — magnitude is the size.
				if x, ok := leI32(b, 4); ok {
					if u := absU32(x); u > 0 {
						v.Width = u32p(u)
					}
				}
			}
			if v.Height == nil {
				if x, ok := leI32(b, 8); ok {
					if u := absU32(x); u > 0 {
						v.Height = u32p(u)
					}
				}
			}
		}
	case "auds":
		tag, _ := leU16(b, 0)
		channels, _ := leU16(b, 2)
		rate, _ := leU32(b, 4)
		if info.Audio == nil && (tag > 0 || channels > 0) {
			var sampleRate *uint32
			if rate > 0 {
				sampleRate = u32p(rate)
			}
			info.Audio = &AudioStream{
				Codec:      waveCodec(tag),
				SampleRate: sampleRate,
				Channels:   keepU8FromU16(channels, true),
			}
		}
	}
}

// absU32 is i32::unsigned_abs (including for MinInt32).
func absU32(x int32) uint32 {
	if x < 0 {
		return uint32(-int64(x))
	}
	return uint32(x)
}

func aviVideoCodec(four []byte) string {
	switch strings.TrimSpace(lossy(four)) {
	case "H264", "h264", "x264", "avc1":
		return "H.264 / AVC"
	case "H265", "h265", "x265", "HEVC":
		return "H.265 / HEVC"
	case "MPG2", "mpg2", "mpeg":
		return "MPEG-2"
	case "MPG1", "mpg1":
		return "MPEG-1"
	case "WMV1":
		return "Windows Media Video 7"
	case "WMV2":
		return "Windows Media Video 8"
	case "WMV3":
		return "Windows Media Video 9"
	case "WVC1":
		return "VC-1"
	case "MJPG", "mjpg", "DJPG":
		return "MJPEG"
	case "XVID", "DIVX", "DX50", "FMP4", "mp4v", "MP4V":
		return "MPEG-4 Part 2 (DivX/Xvid)"
	case "VP70", "VP71":
		return "On2 VP7"
	case "VP80":
		return "VP8"
	case "cvid":
		return "Cinepak"
	case "raw ", "RGB ", "DIB ":
		return "未压缩"
	default:
		return strings.TrimSpace(lossy(four))
	}
}

func waveCodec(tag uint16) string {
	switch tag {
	case 0x0001:
		return "PCM"
	case 0x0003:
		return "PCM (float)"
	case 0x0055:
		return "MP3"
	case 0x00FF:
		return "AAC"
	case 0x0110:
		return "ADPCM"
	case 0x0161:
		return "WMA"
	case 0x0162:
		return "WMA Pro"
	case 0x0163:
		return "WMA Lossless"
	case 0x2000:
		return "AC-3"
	case 0xF1AC:
		return "FLAC"
	default:
		return fmt.Sprintf("格式 0x%04X", tag)
	}
}

/* ---------------------------------- FLV ----------------------------------- */

func parseFLV(f *os.File, info *MediaInfo) {
	buf := make([]byte, 64*1024) // audio+video tags announce early
	got := readUpTo(f, 0, buf)
	parseFLVBuf(buf[:got], info)
}

func parseFLVBuf(b []byte, info *MediaInfo) {
	if len(b) < 13 {
		return
	}
	i := 13 // 9-byte header + first PreviousTagSize
	// Tags until both codecs are known — a bound against pathological files.
	for n := 0; n < 128; n++ {
		if i+11 > len(b) {
			break
		}
		tag := b[i]
		size := int(b[i+1])<<16 | int(b[i+2])<<8 | int(b[i+3])
		start := i + 11
		end := start + size
		if end > len(b) {
			break
		}
		payload := b[start:end]
		if tag == 9 && info.Video == nil {
			// Low nibble of the first byte is the codec id (7 = AVC/H.264).
			if len(payload) > 0 {
				info.Video = &VideoStream{Codec: flvVideoCodec(payload[0] & 0x0F)}
			}
		} else if tag == 8 && info.Audio == nil {
			// High nibble of the first byte is the audio format (10 = AAC).
			if len(payload) > 0 {
				info.Audio = &AudioStream{Codec: flvAudioCodec(payload[0] >> 4)}
			}
		}
		if info.Video != nil && info.Audio != nil {
			break
		}
		i = end + 4 // skip PreviousTagSize
	}
}

func flvVideoCodec(code byte) string {
	switch code {
	case 2:
		return "Sorenson H.263"
	case 4, 5:
		return "On2 VP6"
	case 6:
		return "Screen video"
	case 7:
		return "H.264 / AVC"
	case 12:
		return "H.265 / HEVC"
	default:
		return fmt.Sprintf("FLV 编码 id %d", code)
	}
}

// flvAudioCodec maps the FLV SoundFormat nibble (the Rust parameter is `fmt`,
// renamed so the fmt package stays reachable).
func flvAudioCodec(soundFmt byte) string {
	switch soundFmt {
	case 0, 5:
		return "PCM"
	case 1:
		return "ADPCM"
	case 2, 14:
		return "MP3"
	case 6:
		return "Nellymoser"
	case 10:
		return "AAC"
	case 11:
		return "Speex"
	default:
		return fmt.Sprintf("FLV 音频格式 %d", soundFmt)
	}
}

/* --------------------------------- ASF/WMV -------------------------------- */

// ASF header objects all start with a 16-byte GUID, stored little-endian in
// the first three fields: {75B22635-668E-11CF-A6D9-00AA0062CE6C} is the File
// Properties object.
const asfFileProps = "\x35\x26\xb2\x75\x8e\x66\xcf\x11\xa6\xd9\x00\xaa\x00\x62\xce\x6c"

func parseASF(f *os.File, info *MediaInfo) {
	// Header objects cluster at the head of the file.
	buf := make([]byte, 64*1024)
	got := readUpTo(f, 0, buf)
	b := buf[:got]
	// GUID(16) + ObjectSize(8) + FileID(16) + FileSize(8) + CreationDate(8)
	// + DataPackets(8) → PlayDuration, counted in 100-ns ticks.
	for off := 0; off+16+64+8 < len(b); off++ {
		if string(b[off:off+16]) == asfFileProps {
			if ticks, ok := leU64(b, off+64); ok {
				if ms := ticks / 10_000; ms > 0 {
					info.DurationMS = u64p(ms)
				}
			}
			break // codec streams are deliberately not parsed — see package docs
		}
	}
}
