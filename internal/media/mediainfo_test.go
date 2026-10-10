package media

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeTemp drops data into a temp file and returns its path.
func writeTemp(t *testing.T, data []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "sample.bin")
	if err := os.WriteFile(p, data, 0o600); err != nil {
		t.Fatalf("write temp file: %v", err)
	}
	return p
}

/* ------------------------------- MP4 builders ------------------------------ */

func be32(v uint32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, v)
	return b
}

func be16(v uint16) []byte {
	b := make([]byte, 2)
	binary.BigEndian.PutUint16(b, v)
	return b
}

func le32(v uint32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, v)
	return b
}

func le16(v uint16) []byte {
	b := make([]byte, 2)
	binary.LittleEndian.PutUint16(b, v)
	return b
}

// leI32v writes a signed little-endian value (the production helper of the
// same purpose is leI32(b, at)).
func leI32v(v int32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, uint32(v))
	return b
}

func le64(v uint64) []byte {
	b := make([]byte, 8)
	binary.LittleEndian.PutUint64(b, v)
	return b
}

// box wraps body in [size][type] + payload.
func box(typ string, body ...[]byte) []byte {
	n := 8
	for _, p := range body {
		n += len(p)
	}
	out := append(be32(uint32(n)), []byte(typ)...)
	for _, p := range body {
		out = append(out, p...)
	}
	return out
}

// mvhdV0 / mdhdV0 are version-0 movie and media headers.
func mvhdV0(timescale, duration uint32) []byte {
	body := make([]byte, 0, 20)
	body = append(body, 0, 0, 0, 0) // version + flags
	body = append(body, be32(0)...) // creation time
	body = append(body, be32(0)...) // modification time
	body = append(body, be32(timescale)...)
	body = append(body, be32(duration)...)
	return box("mvhd", body)
}

func mdhdV0(timescale, duration uint32) []byte {
	body := make([]byte, 0, 20)
	body = append(body, 0, 0, 0, 0)
	body = append(body, be32(0)...)
	body = append(body, be32(0)...)
	body = append(body, be32(timescale)...)
	body = append(body, be32(duration)...)
	return box("mdhd", body)
}

func hdlr(handler string) []byte {
	body := make([]byte, 0, 24)
	body = append(body, 0, 0, 0, 0) // version + flags
	body = append(body, be32(0)...) // pre_defined
	body = append(body, []byte(handler)...)
	body = append(body, make([]byte, 12)...) // reserved[3]
	return box("hdlr", body)
}

// visualSampleEntry builds a 40-byte VisualSampleEntry: 8 header, 24 bytes of
// reserved/dataref/predefined, then width u16 @32 and height u16 @34.
func visualSampleEntry(fourcc string, width, height uint16) []byte {
	e := make([]byte, 4)               // size, patched below
	e = append(e, []byte(fourcc)...)   // format fourcc IS the codec tag @4
	e = append(e, make([]byte, 24)...) // reserved[6] dataref[2] predefined[16]
	e = append(e, be16(width)...)      // @32
	e = append(e, be16(height)...)     // @34
	e = append(e, be16(0x0040)...)     // depth-ish filler
	e = append(e, be16(0xFFFF)...)     // pre-defined; the entry is 40 bytes
	binary.BigEndian.PutUint32(e[0:4], uint32(len(e)))
	return e
}

// audioSampleEntry builds a 40-byte AudioSampleEntry: channels u16 @24 and the
// 16.16 fixed-point sample rate u32 @32.
func audioSampleEntry(fourcc string, channels uint16, sampleRate uint32) []byte {
	e := make([]byte, 4)
	e = append(e, []byte(fourcc)...)       // format fourcc @4
	e = append(e, make([]byte, 8)...)      // reserved[6] + dataref[2]
	e = append(e, be16(0)...)              // version
	e = append(e, be16(0)...)              // revision
	e = append(e, be32(0)...)              // vendor
	e = append(e, be16(channels)...)       // channelcount @24
	e = append(e, be16(16)...)             // samplesize @26
	e = append(e, be16(0)...)              // compression id @28
	e = append(e, be16(0)...)              // packet size @30
	e = append(e, be32(sampleRate<<16)...) // samplerate @32
	e = append(e, be32(0)...)              // filler; the entry is 40 bytes
	binary.BigEndian.PutUint32(e[0:4], uint32(len(e)))
	return e
}

func stsd(entry []byte) []byte {
	body := []byte{0, 0, 0, 0} // version + flags
	body = append(body, be32(1)...)
	body = append(body, entry...)
	return box("stsd", body)
}

func stts(runs ...[2]uint32) []byte {
	body := []byte{0, 0, 0, 0}
	body = append(body, be32(uint32(len(runs)))...)
	for _, r := range runs {
		body = append(body, be32(r[0])...)
		body = append(body, be32(r[1])...)
	}
	return box("stts", body)
}

func stbl(parts ...[]byte) []byte { return box("stbl", parts...) }

func trakVideo(mediaTimescale, mediaDuration uint32, entry []byte, sttsBox []byte) []byte {
	return box("trak",
		box("mdia",
			mdhdV0(mediaTimescale, mediaDuration),
			hdlr("vide"),
			box("minf", stbl(stsd(entry), sttsBox)),
		),
	)
}

func trakAudio(mediaTimescale, mediaDuration uint32, entry []byte) []byte {
	return box("trak",
		box("mdia",
			mdhdV0(mediaTimescale, mediaDuration),
			hdlr("soun"),
			box("minf", stbl(stsd(entry))),
		),
	)
}

func ftyp(brand string) []byte {
	b := append(be32(20), []byte("ftyp")...) // size + type
	b = append(b, []byte(brand)...)
	b = append(b, be32(0)...) // minor version
	b = append(b, []byte(brand)...)
	return b
}

func TestReadMP4(t *testing.T) {
	// mvhd: 12000 ticks @ 600 → 20000 ms.
	moov := box("moov",
		mvhdV0(600, 12000),
		trakVideo(30000, 600000, visualSampleEntry("avc1", 1920, 1080), stts([2]uint32{30, 1001})),
		trakAudio(48000, 960000, audioSampleEntry("mp4a", 2, 48000)),
	)
	data := append(ftyp("isom"), moov...)

	info, err := Read(writeTemp(t, data))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.Container != "MP4" {
		t.Errorf("container = %q, want %q", info.Container, "MP4")
	}
	if info.DurationMS == nil || *info.DurationMS != 20000 {
		t.Fatalf("durationMs = %v, want 20000", derefU64(info.DurationMS))
	}
	if info.Video == nil {
		t.Fatal("video stream missing")
	}
	if info.Video.Codec != "H.264 / AVC" {
		t.Errorf("video codec = %q, want H.264 / AVC", info.Video.Codec)
	}
	if info.Video.Width == nil || *info.Video.Width != 1920 {
		t.Errorf("width = %v, want 1920", derefU32(info.Video.Width))
	}
	if info.Video.Height == nil || *info.Video.Height != 1080 {
		t.Errorf("height = %v, want 1080", derefU32(info.Video.Height))
	}
	// 30 samples × 30000 / (30 × 1001) ≈ 29.97
	if info.Video.FPS == nil || math.Abs(*info.Video.FPS-29.97002997002997) > 1e-9 {
		t.Errorf("fps = %v, want ≈29.97", derefF64(info.Video.FPS))
	}
	if info.Audio == nil {
		t.Fatal("audio stream missing")
	}
	if info.Audio.Codec != "AAC" {
		t.Errorf("audio codec = %q, want AAC", info.Audio.Codec)
	}
	if info.Audio.SampleRate == nil || *info.Audio.SampleRate != 48000 {
		t.Errorf("sampleRate = %v, want 48000", derefU32(info.Audio.SampleRate))
	}
	if info.Audio.Channels == nil || *info.Audio.Channels != 2 {
		t.Errorf("channels = %v, want 2", derefU8(info.Audio.Channels))
	}
}

// A video-only file still fills durationMs from its mdhd when mvhd is missing.
func TestReadMP4DurationFallsBackToMdhd(t *testing.T) {
	moov := box("moov", trakVideo(1000, 7000, visualSampleEntry("av01", 640, 480), stts([2]uint32{60, 20})))
	data := append(ftyp("isom"), moov...)

	info, err := Read(writeTemp(t, data))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.DurationMS == nil || *info.DurationMS != 7000 {
		t.Fatalf("durationMs = %v, want 7000", derefU64(info.DurationMS))
	}
	if info.Video.FPS == nil || math.Abs(*info.Video.FPS-50) > 1e-9 {
		t.Errorf("fps = %v, want 50", derefF64(info.Video.FPS))
	}
	if info.Audio != nil {
		t.Errorf("audio = %+v, want nil", info.Audio)
	}
}

// QuickTime branding is reported separately from MP4.
func TestReadMP4ContainerBrands(t *testing.T) {
	cases := map[string]string{
		"qt  ": "QuickTime (MOV)",
		"M4V ": "M4V",
		"3gp5": "3GP",
		"isom": "MP4",
	}
	for brand, want := range cases {
		data := append(ftyp(brand), box("moov", mvhdV0(1000, 1000))...)
		info, err := Read(writeTemp(t, data))
		if err != nil {
			t.Fatalf("%q: Read: %v", brand, err)
		}
		if info.Container != want {
			t.Errorf("brand %q → container %q, want %q", brand, info.Container, want)
		}
	}
}

// A 64-bit extended box size: the size field is 1 and the real size follows
// as a u64, making the box header 16 bytes instead of 8.
func TestReadMP4ExtendedBoxSize(t *testing.T) {
	moov := box("moov", mvhdV0(1000, 5000))
	size := make([]byte, 8)
	// The 8-byte size counts the whole box, i.e. the normal length plus the
	// extra size field itself.
	binary.BigEndian.PutUint64(size, uint64(len(moov))+8)
	big := append([]byte{0, 0, 0, 1}, []byte("moov")...) // size field = 1
	big = append(big, size...)                           // … the real u64 size
	big = append(big, moov[8:]...)                       // … then the body
	data := append(ftyp("isom"), big...)

	info, err := Read(writeTemp(t, data))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.DurationMS == nil || *info.DurationMS != 5000 {
		t.Fatalf("durationMs = %v, want 5000", derefU64(info.DurationMS))
	}
}

/* ------------------------------- EBML builders ----------------------------- */

// ebmlVInt encodes v as an EBML data-size VINT (length marker included).
func ebmlVInt(v uint64) []byte {
	for n := 1; n <= 8; n++ {
		if v < uint64(1)<<(7*n)-1 {
			out := make([]byte, n)
			marked := v | uint64(1)<<(7*n)
			for i := n - 1; i >= 0; i-- {
				out[i] = byte(marked)
				marked >>= 8
			}
			return out
		}
	}
	return []byte{0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF} // unknown size
}

// ebmlElem encodes id (marker bits included) + size + payload.
func ebmlElem(id uint32, payload []byte) []byte {
	var idb []byte
	switch {
	case id <= 0xFF:
		idb = []byte{byte(id)}
	case id <= 0xFFFF:
		idb = []byte{byte(id >> 8), byte(id)}
	case id <= 0xFFFFFF:
		idb = []byte{byte(id >> 16), byte(id >> 8), byte(id)}
	default:
		idb = []byte{byte(id >> 24), byte(id >> 16), byte(id >> 8), byte(id)}
	}
	return append(append(idb, ebmlVInt(uint64(len(payload)))...), payload...)
}

func ebmlUint(v uint64) []byte { return be32(uint32(v)) }

func ebmlFloat(v float64) []byte {
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, math.Float64bits(v))
	return b
}

// mkvInfo is the Segment > Info element with a scale and a duration in ticks.
func mkvInfo(scaleNS uint32, durationTicks float64) []byte {
	return ebmlElem(0x1549A966,
		append(ebmlElem(0x2AD7B1, ebmlUint(uint64(scaleNS))),
			ebmlElem(0x4489, ebmlFloat(durationTicks))...),
	)
}

func mkvVideoTrack() []byte {
	video := append(ebmlElem(0xB0, ebmlUint(1920)), ebmlElem(0xBA, ebmlUint(1080))...)
	return ebmlElem(0xAE, append(append(append(
		ebmlElem(0x83, ebmlUint(1)),
		ebmlElem(0x86, []byte("V_MPEG4/ISO/AVC"))...),
		ebmlElem(0x23E383, ebmlUint(33366667))...), // ns per frame → ≈29.97 fps
		ebmlElem(0xE0, video)...))
}

func mkvAudioTrack() []byte {
	audio := append(ebmlElem(0xB5, ebmlFloat(48000)), ebmlElem(0x9F, ebmlUint(2))...)
	return ebmlElem(0xAE, append(append(
		ebmlElem(0x83, ebmlUint(2)),
		ebmlElem(0x86, []byte("A_AAC"))...),
		ebmlElem(0xE1, audio)...))
}

func mkvFile(docType string, segmentPayload []byte) []byte {
	hdr := ebmlElem(0x1A45DFA3, ebmlElem(0x4282, []byte(docType)))
	return append(hdr, ebmlElem(0x18538067, segmentPayload)...)
}

func mkvSegmentPayload() []byte {
	tracks := append(mkvVideoTrack(), mkvAudioTrack()...)
	return append(mkvInfo(1000000, 20000), ebmlElem(0x1654AE6B, tracks)...)
}

func TestReadMKV(t *testing.T) {
	data := mkvFile("matroska", mkvSegmentPayload())
	info, err := Read(writeTemp(t, data))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.Container != "Matroska (MKV)" {
		t.Errorf("container = %q, want Matroska (MKV)", info.Container)
	}
	if info.DurationMS == nil || *info.DurationMS != 20000 {
		t.Fatalf("durationMs = %v, want 20000", derefU64(info.DurationMS))
	}
	if info.Video == nil || info.Video.Codec != "H.264 / AVC" {
		t.Fatalf("video = %+v, want H.264 / AVC", info.Video)
	}
	if info.Video.Width == nil || *info.Video.Width != 1920 || info.Video.Height == nil || *info.Video.Height != 1080 {
		t.Errorf("dimensions = %vx%v, want 1920x1080", derefU32(info.Video.Width), derefU32(info.Video.Height))
	}
	// DefaultDuration 33366667 ns per frame → 1e9 / ns
	if info.Video.FPS == nil || math.Abs(*info.Video.FPS-1e9/33366667.0) > 1e-9 {
		t.Errorf("fps = %v, want ≈29.97", derefF64(info.Video.FPS))
	}
	if info.Audio == nil || info.Audio.Codec != "AAC" {
		t.Fatalf("audio = %+v, want AAC", info.Audio)
	}
	if info.Audio.SampleRate == nil || *info.Audio.SampleRate != 48000 {
		t.Errorf("sampleRate = %v, want 48000", derefU32(info.Audio.SampleRate))
	}
	if info.Audio.Channels == nil || *info.Audio.Channels != 2 {
		t.Errorf("channels = %v, want 2", derefU8(info.Audio.Channels))
	}
}

func TestReadWebM(t *testing.T) {
	info, err := Read(writeTemp(t, mkvFile("webm", mkvSegmentPayload())))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.Container != "WebM" {
		t.Errorf("container = %q, want WebM", info.Container)
	}
}

// A Cluster before the Tracks must stop the scan, and an "unknown" Segment
// size (all ones) must clamp to the end of the file instead of failing.
func TestReadMKVUnknownSizeStopsAtCluster(t *testing.T) {
	cluster := ebmlElem(0x1F43B675, []byte{0xFF, 0xFF, 0xFF})
	segment := append(cluster, mkvSegmentPayload()...)

	var b []byte
	b = append(b, ebmlElem(0x1A45DFA3, ebmlElem(0x4282, []byte("matroska")))...)
	b = append(b, []byte{0x18, 0x53, 0x80, 0x67}...) // Segment id
	b = append(b, ebmlVInt(1<<56-1)...)              // 8-byte all-ones = unknown
	b = append(b, segment...)

	info, err := Read(writeTemp(t, b))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.Video != nil || info.Audio != nil {
		t.Errorf("streams after a Cluster should be ignored, got %+v / %+v", info.Video, info.Audio)
	}
}

/* --------------------------------- AVI ------------------------------------ */

func riffChunk(typ string, body []byte) []byte {
	out := append([]byte(typ), le32(uint32(len(body)))...)
	return append(out, body...)
}

func riffList(typ string, body []byte) []byte {
	inner := append([]byte(typ), body...)
	return riffChunk("LIST", inner)
}

func TestReadAVI(t *testing.T) {
	avih := make([]byte, 56)
	copy(avih[0:4], le32(40000))  // usec per frame → 25 fps
	copy(avih[16:20], le32(500))  // total frames → 20000 ms
	copy(avih[32:36], le32(1920)) // canvas width
	copy(avih[36:40], le32(1080)) // canvas height

	strh := make([]byte, 56)
	copy(strh[0:4], "vids")
	copy(strh[4:8], "H264")
	copy(strh[20:24], le32(1))  // scale
	copy(strh[24:28], le32(25)) // rate
	copy(strh[32:36], le32(500))

	strf := make([]byte, 40)
	copy(strf[0:4], le32(40))      // biSize
	copy(strf[4:8], le32(1280))    // biWidth
	copy(strf[8:12], leI32v(-720)) // top-down bitmap
	copy(strf[16:20], "H264")      // biCompression

	vstrl := riffList("strl", append(riffChunk("strh", strh), riffChunk("strf", strf)...))

	astr := make([]byte, 56)
	copy(astr[0:4], "auds")
	awav := make([]byte, 18)
	copy(awav[0:2], le16(0x0055)) // WAVE_FORMAT_MPEGLAYER3
	copy(awav[2:4], le16(2))      // channels
	copy(awav[4:8], le32(48000))  // sample rate
	astrl := riffList("strl", append(riffChunk("strh", astr), riffChunk("strf", awav)...))

	body := append([]byte("AVI "), append(riffList("hdrl", append(riffChunk("avih", avih), vstrl...)), astrl...)...)
	data := append(append([]byte("RIFF"), le32(uint32(len(body)))...), body...)

	info, err := Read(writeTemp(t, data))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.Container != "AVI" {
		t.Errorf("container = %q, want AVI", info.Container)
	}
	if info.DurationMS == nil || *info.DurationMS != 20000 {
		t.Errorf("durationMs = %v, want 20000", derefU64(info.DurationMS))
	}
	if info.Video == nil {
		t.Fatal("video stream missing")
	}
	if info.Video.Codec != "H.264 / AVC" {
		t.Errorf("codec = %q, want H.264 / AVC", info.Video.Codec)
	}
	// avih supplies the canvas, strh the frame rate.
	if info.Video.Width == nil || *info.Video.Width != 1920 {
		t.Errorf("width = %v, want 1920 (from avih)", derefU32(info.Video.Width))
	}
	if info.Video.Height == nil || *info.Video.Height != 1080 {
		t.Errorf("height = %v, want 1080 (from avih)", derefU32(info.Video.Height))
	}
	if info.Video.FPS == nil || math.Abs(*info.Video.FPS-25) > 1e-9 {
		t.Errorf("fps = %v, want 25 (from strh)", derefF64(info.Video.FPS))
	}
	if info.Audio == nil || info.Audio.Codec != "MP3" {
		t.Fatalf("audio = %+v, want MP3", info.Audio)
	}
	if info.Audio.SampleRate == nil || *info.Audio.SampleRate != 48000 {
		t.Errorf("sampleRate = %v, want 48000", derefU32(info.Audio.SampleRate))
	}
	if info.Audio.Channels == nil || *info.Audio.Channels != 2 {
		t.Errorf("channels = %v, want 2", derefU8(info.Audio.Channels))
	}
}

/* --------------------------------- FLV ------------------------------------ */

func flvTag(tag byte, payload []byte) []byte {
	size := []byte{byte(len(payload) >> 16), byte(len(payload) >> 8), byte(len(payload))}
	out := append([]byte{tag}, size...)
	out = append(out, make([]byte, 7)...) // timestamp[3] + extended[1] + stream id[3]
	out = append(out, payload...)
	return append(out, le32(uint32(len(payload)+11))...)
}

func TestReadFLV(t *testing.T) {
	// "FLV" + version + flags + a 4-byte header size, then PreviousTagSize0.
	head := append([]byte("FLV"), 0x01, 0x00)
	head = append(head, be32(9)...)
	data := append(head, le32(0)...)                // PreviousTagSize0
	data = append(data, flvTag(9, []byte{0x17})...) // video, codec 7 = AVC
	data = append(data, flvTag(8, []byte{0xAF})...) // audio, format 10 = AAC

	info, err := Read(writeTemp(t, data))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.Container != "Flash Video (FLV)" {
		t.Errorf("container = %q, want Flash Video (FLV)", info.Container)
	}
	if info.Video == nil || info.Video.Codec != "H.264 / AVC" {
		t.Errorf("video = %+v, want H.264 / AVC", info.Video)
	}
	if info.Audio == nil || info.Audio.Codec != "AAC" {
		t.Errorf("audio = %+v, want AAC", info.Audio)
	}
	if info.Video != nil && (info.Video.Width != nil || info.Video.Height != nil || info.Video.FPS != nil) {
		t.Errorf("FLV carries no dimensions/fps in the header, got %+v", info.Video)
	}
}

/* --------------------------------- ASF ------------------------------------ */

func TestReadASF(t *testing.T) {
	b := make([]byte, 200)
	for i := range b {
		b[i] = 0xCC // filler that can never match the GUID
	}
	copy(b[0:4], "\x30\x26\xb2\x75") // ASF/WMV file magic, what Read sniffs on
	off := 40
	copy(b[off:off+16], asfFileProps)
	// PlayDuration lives 64 bytes past the start of the GUID, in 100-ns ticks.
	copy(b[off+64:off+72], le64(20_000*10_000))

	info, err := Read(writeTemp(t, b))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.Container != "Windows Media Video (ASF)" {
		t.Errorf("container = %q, want Windows Media Video (ASF)", info.Container)
	}
	if info.DurationMS == nil || *info.DurationMS != 20000 {
		t.Errorf("durationMs = %v, want 20000", derefU64(info.DurationMS))
	}
}

/* --------------------- unrecognised / truncated / errors ------------------ */

func TestReadUnknownContainer(t *testing.T) {
	data := append([]byte("NOTACONTAINERATALL....."), make([]byte, 200)...)
	info, err := Read(writeTemp(t, data))
	if err != nil {
		t.Fatalf("Read on an unknown container should not error, got %v", err)
	}
	if info != (MediaInfo{}) {
		t.Errorf("info = %+v, want the zero value", info)
	}
}

func TestReadTruncatedFiles(t *testing.T) {
	cases := map[string][]byte{
		"three bytes":      {0x00, 0x01, 0x02},
		"exactly 16 bytes": []byte("RIFFxxxxAVI WEBPM"),
		"ftyp without moov": func() []byte {
			b := append([]byte{}, ftyp("isom")...)
			return append(b, box("free", make([]byte, 8))...)
		}(),
		"moov cut in half": func() []byte {
			full := append(ftyp("isom"), box("moov", mvhdV0(1000, 9000))...)
			return full[:len(full)-6]
		}(),
		"ebml header only": ebmlElem(0x1A45DFA3, ebmlElem(0x4282, []byte("matroska"))),
		"riff without hdrl": append(append([]byte("RIFF"), le32(64)...),
			append([]byte("AVI "), riffChunk("JUNK", make([]byte, 16))...)...),
	}
	for name, data := range cases {
		info, err := Read(writeTemp(t, data))
		if err != nil {
			t.Errorf("%s: unexpected error %v", name, err)
		}
		if info.DurationMS != nil || info.Video != nil {
			t.Errorf("%s: expected no streams, got %+v", name, info)
		}
	}
}

// An stsd box that stops right after entry_count must not panic.
func TestReadMP4EmptySampleTable(t *testing.T) {
	stbl := box("stbl", box("stsd", []byte{0, 0, 0, 0, 0, 0, 0, 0}))
	moov := box("moov", box("trak", box("mdia", mdhdV0(1000, 1000), hdlr("vide"), box("minf", stbl))))
	data := append(ftyp("isom"), moov...)

	info, err := Read(writeTemp(t, data))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.Video == nil {
		t.Fatal("a vide track with an empty stsd should still produce a video entry")
	}
	if info.Video.Codec != "" || info.Video.Width != nil || info.Video.Height != nil {
		t.Errorf("video = %+v, want all fields empty", info.Video)
	}
}

func TestReadMissingFile(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope.mp4")
	info, err := Read(missing)
	if err == nil {
		t.Fatal("Read on a missing path must return an error")
	}
	if info != (MediaInfo{}) {
		t.Errorf("info = %+v, want the zero value alongside the error", info)
	}
	if !strings.Contains(err.Error(), "nope.mp4") {
		t.Errorf("error %q should mention the path", err)
	}
}

/* ---------------------------------- JSON ---------------------------------- */

// The frontend TS types are `container?: string | null`, so an absent field
// must serialize as an explicit null rather than being omitted.
func TestMediaInfoJSONKeepsNulls(t *testing.T) {
	b, err := json.Marshal(MediaInfo{})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	want := `{"container":"","durationMs":null,"video":null,"audio":null}`
	if string(b) != want {
		t.Errorf("JSON = %s, want %s", b, want)
	}

	b, err = json.Marshal(&VideoStream{})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if want := `{"codec":"","width":null,"height":null,"fps":null}`; string(b) != want {
		t.Errorf("video JSON = %s, want %s", b, want)
	}

	b, err = json.Marshal(&AudioStream{})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if want := `{"codec":"","sampleRate":null,"channels":null}`; string(b) != want {
		t.Errorf("audio JSON = %s, want %s", b, want)
	}
}

/* ------------------------------- unit probes ------------------------------ */

// A truncated stts (entry count larger than the data present) stops at the
// first missing pair instead of reading past the buffer.
func TestSttsFPSStopsAtTruncation(t *testing.T) {
	body := []byte{0, 0, 0, 0} // version + flags
	body = append(body, be32(500)...)
	body = append(body, be32(30)...) // one complete run …
	body = append(body, be32(1001)...)
	// … then nothing: the loop must break out.
	fps, ok := sttsFPS(body, 30000)
	if !ok {
		t.Fatal("expected an fps from the single complete run")
	}
	if math.Abs(fps-29.97002997002997) > 1e-9 {
		t.Errorf("fps = %v, want ≈29.97", fps)
	}
}

// An absurd count × delta sum keeps the Rust u128 precision: 4096 runs of
// (2^32-1)² would overflow a uint64 accumulator.
func TestSttsFPSKeepsU128Precision(t *testing.T) {
	body := []byte{0, 0, 0, 0}
	body = append(body, be32(2)...)
	body = append(body, be32(math.MaxUint32)...)
	body = append(body, be32(math.MaxUint32)...)
	body = append(body, be32(math.MaxUint32)...)
	body = append(body, be32(math.MaxUint32)...)

	// sum = 2 × (2^32-1)² ≈ 3.69e19, which does not fit in uint64.
	fps, ok := sttsFPS(body, 1000)
	if !ok {
		t.Fatal("expected an fps")
	}
	if fps > 1.0 || fps < 0.0 {
		t.Errorf("fps = %v, want a tiny positive number (u64 wraparound would spike)", fps)
	}
}

// A frame rate outside (0, 1000) is dropped, not reported.
func TestSttsFPSRejectsAbsurdRates(t *testing.T) {
	body := []byte{0, 0, 0, 0}
	body = append(body, be32(1)...)
	body = append(body, be32(1)...) // 1 sample, 1 tick → timescale fps
	if _, ok := sttsFPS(body, 5000); ok {
		t.Error("fps of 5000 should be rejected by the < 1000 bound")
	}
	if _, ok := sttsFPS(nil, 1000); ok {
		t.Error("an empty stts should yield no fps")
	}
}

func TestMsFromOverflow(t *testing.T) {
	if _, ok := msFrom(0, 1000); ok {
		t.Error("a zero duration must be rejected")
	}
	if _, ok := msFrom(1000, 0); ok {
		t.Error("a zero timescale must be rejected")
	}
	// (2^64-1) × 1000 / 1e6 — needs the u128 intermediate; a uint64 multiply
	// would wrap and produce a wildly different number.
	ms, ok := msFrom(math.MaxUint64, 1_000_000)
	if !ok {
		t.Fatal("expected a duration")
	}
	if want := uint64(18446744073709551); ms != want {
		t.Errorf("ms = %d, want %d (a wrapped 64-bit multiply would differ)", ms, want)
	}
}

/* --------------------------------- helpers -------------------------------- */

func derefU64(p *uint64) any {
	if p == nil {
		return nil
	}
	return *p
}

func derefU32(p *uint32) any {
	if p == nil {
		return nil
	}
	return *p
}

func derefU8(p *uint8) any {
	if p == nil {
		return nil
	}
	return *p
}

func derefF64(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}
