package sidecar

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// synthWAV builds a WAV in memory. Generating the fixture ourselves keeps the
// sidecar build free of lavfi + the sine filter — one less reason for it to
// grow — and keeps these tests independent of any ffmpeg binary.
func synthWAV(rate uint32, channels uint16, frames int) []byte {
	const bits = 16
	block := int(channels) * bits / 8
	dataLen := frames * block
	w := make([]byte, 0, 44+dataLen)
	put32 := func(v uint32) { w = append(w, byte(v), byte(v>>8), byte(v>>16), byte(v>>24)) }
	put16 := func(v uint16) { w = append(w, byte(v), byte(v>>8)) }
	w = append(w, "RIFF"...)
	put32(uint32(36 + dataLen))
	w = append(w, "WAVEfmt "...)
	put32(16) // fmt chunk size
	put16(1)  // PCM
	put16(channels)
	put32(rate)
	put32(rate * uint32(block)) // byte rate
	put16(uint16(block))        // block align
	put16(bits)
	w = append(w, "data"...)
	put32(uint32(dataLen))
	for i := 0; i < frames; i++ {
		t := float64(i) / float64(rate)
		sample := int16(math.Sin(t*440.0*2.0*math.Pi) * 20_000.0)
		for c := uint16(0); c < channels; c++ {
			put16(uint16(sample))
		}
	}
	return w
}

// writeTestWAV is the file-backed twin of synthWAV, matching the fixture the
// original implementation generated on disk.
func writeTestWAV(t *testing.T, path string) []byte {
	t.Helper()
	buf := synthWAV(48_000, 2, 48_000) // 1 s stereo
	if err := os.WriteFile(path, buf, 0o644); err != nil {
		t.Fatalf("write test wav: %v", err)
	}
	return buf
}

func TestParseWAVPlainHeader(t *testing.T) {
	dir := t.TempDir()
	wav := filepath.Join(dir, "sine.wav")
	buf := writeTestWAV(t, wav)

	onDisk, err := os.ReadFile(wav)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}

	w := parseWAV(buf)
	if w == nil {
		t.Fatal("44-byte header must parse")
	}
	if w.sampleRate != 48_000 {
		t.Errorf("采样率应原样透传: got %d", w.sampleRate)
	}
	if w.channels != 2 {
		t.Errorf("声道数应原样透传: got %d", w.channels)
	}
	if w.dataAt != 44 {
		t.Errorf("PCM 偏移应为 44: got %d", w.dataAt)
	}
	// 1 s @ 48 kHz stereo s16 = 192 000 bytes.
	if w.pcmBytes != 192_000 {
		t.Errorf("PCM 字节数不对: got %d, want 192000", w.pcmBytes)
	}
	if got := parseWAV(onDisk); got == nil || got.dataAt != 44 {
		t.Errorf("落盘后的文件也应解析出 dataAt=44: %+v", got)
	}
}

func TestParseWAVSurvivesExtraChunks(t *testing.T) {
	// ffmpeg may emit LIST/INFO before `data`, and on a pipe the data size
	// is 0xFFFFFFFF. The player must still find `fmt ` and `data`.
	buf := []byte{}
	buf = append(buf, "RIFF"...)
	buf = binary.LittleEndian.AppendUint32(buf, 0xFFFF_FFFF)
	buf = append(buf, "WAVE"...)
	buf = append(buf, "LIST"...)
	buf = binary.LittleEndian.AppendUint32(buf, 12) // INFO + ISFT + 4-byte value
	buf = append(buf, "INFOISFT\x00\x00\x00\x00"...)
	buf = append(buf, "fmt "...)
	buf = binary.LittleEndian.AppendUint32(buf, 16)
	buf = binary.LittleEndian.AppendUint16(buf, 1)
	buf = binary.LittleEndian.AppendUint16(buf, 6) // 5.1
	buf = binary.LittleEndian.AppendUint32(buf, 48_000)
	buf = binary.LittleEndian.AppendUint32(buf, 0)
	buf = binary.LittleEndian.AppendUint16(buf, 6*2)
	buf = binary.LittleEndian.AppendUint16(buf, 16)
	buf = append(buf, "data"...)
	buf = binary.LittleEndian.AppendUint32(buf, 0xFFFF_FFFF)
	pcmAt := len(buf)
	buf = append(buf, make([]byte, 64)...)

	w := parseWAV(buf)
	if w == nil {
		t.Fatal("header with a LIST chunk must parse")
	}
	if w.sampleRate != 48_000 {
		t.Errorf("采样率: got %d", w.sampleRate)
	}
	if w.channels != 6 {
		t.Errorf("声道数: got %d", w.channels)
	}
	if w.dataAt != pcmAt {
		t.Errorf("dataAt 应指向真正的 PCM 起点: got %d, want %d", w.dataAt, pcmAt)
	}
	if w.pcmBytes != 64 {
		t.Errorf("pcmBytes: got %d, want 64", w.pcmBytes)
	}
}

func TestParseWAVWaitsForTruncatedChunk(t *testing.T) {
	// A pipe can split a chunk header; parsing must not claim success on a
	// half-read `data` size, or the player would eat PCM as header.
	buf := []byte{}
	buf = append(buf, "RIFF"...)
	buf = binary.LittleEndian.AppendUint32(buf, 100)
	buf = append(buf, "WAVEfmt "...)
	buf = binary.LittleEndian.AppendUint32(buf, 16)
	buf = binary.LittleEndian.AppendUint16(buf, 1)
	buf = binary.LittleEndian.AppendUint16(buf, 2)
	buf = binary.LittleEndian.AppendUint32(buf, 44_100)
	buf = binary.LittleEndian.AppendUint32(buf, 0)
	buf = binary.LittleEndian.AppendUint16(buf, 4)
	buf = binary.LittleEndian.AppendUint16(buf, 16)
	buf = append(buf, "data"...)
	buf = append(buf, 0xFF, 0xFF, 0xFF) // size not fully read yet

	if w := parseWAV(buf); w != nil {
		t.Fatalf("半截 data 头不应被当成完整头: %+v", w)
	}
}

func TestParseWAVRejectsGarbage(t *testing.T) {
	for name, buf := range map[string][]byte{
		"empty":     {},
		"short":     []byte("RIFF"),
		"not riff":  []byte("XXXX0123WAVEfmt "),
		"not wave":  []byte("RIFF\x00\x00\x00\x00WAVX"),
		"truncated": synthWAV(48_000, 2, 4)[:30],
	} {
		if w := parseWAV(buf); w != nil {
			t.Errorf("%s: 不该解析成功: %+v", name, w)
		}
	}
}

func TestSidecarPathPrefersEnvOverride(t *testing.T) {
	dir := t.TempDir()
	explicit := filepath.Join(dir, "my-ffmpeg.exe")
	if err := os.WriteFile(explicit, []byte("MZ"), 0o755); err != nil {
		t.Fatal(err)
	}
	// Even a directory named like the sidecar must lose to the override.
	if err := os.WriteFile(filepath.Join(dir, sidecarNames[0]), []byte("MZ"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LUMINA_FFMPEG", explicit)
	if got := SidecarPath(); got != explicit {
		t.Errorf("$LUMINA_FFMPEG 应最高优先: got %q, want %q", got, explicit)
	}

	// Without the override the sidecar name next to the exe wins, and the
	// bare name is only the "missing" fallback.
	t.Setenv("LUMINA_FFMPEG", "")
	_ = os.Unsetenv("LUMINA_FFMPEG")
	got := SidecarPath()
	if !filepath.IsAbs(got) && got != sidecarNames[0] {
		t.Errorf("未找到时应回落到主名: got %q", got)
	}
}

func TestSidecarPathPrefersTripleQualifiedName(t *testing.T) {
	// Every directory is probed triple-qualified first, plain name second.
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, sidecarNames[len(sidecarNames)-1]), []byte("MZ"), 0o755); err != nil {
		t.Fatal(err)
	}
	qualified := filepath.Join(dir, sidecarNames[0])
	if err := os.WriteFile(qualified, []byte("MZ"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LUMINA_FFMPEG", qualified)
	if got := SidecarPath(); got != qualified {
		t.Errorf("三段式名称应先于 ffmpeg.exe: got %q, want %q", got, qualified)
	}
}

func TestProbeMediaMissingSidecar(t *testing.T) {
	t.Setenv("LUMINA_FFMPEG", filepath.Join(t.TempDir(), "nope", "ffmpeg.exe"))
	p, err := ProbeMedia("whatever.mkv")
	if err != nil {
		t.Fatalf("缺 sidecar 时不应报错: %v", err)
	}
	if p.Available || p.PCMBytes != 0 || p.HasEAC3 {
		t.Errorf("缺 sidecar 时应报告不可用: %+v", p)
	}
	if !strings.HasPrefix(p.Detail, "sidecar missing: ") {
		t.Errorf("detail 文案不对: %q", p.Detail)
	}
	// Serialised shape must stay camelCase with every field present.
	if p.SampleRate != 0 || p.Channels != 0 {
		t.Errorf("未解码时不应有采样率/声道: %+v", p)
	}
}

func TestStreamMissingSidecar(t *testing.T) {
	t.Setenv("LUMINA_FFMPEG", filepath.Join(t.TempDir(), "nope", "ffmpeg.exe"))
	if _, err := Stream("whatever.mkv", 0, func([]byte) bool { return true }); err == nil {
		t.Fatal("缺 sidecar 时 Stream 应报错")
	} else if !strings.HasPrefix(err.Error(), "sidecar missing: ") {
		t.Errorf("err 文案不对: %v", err)
	}
}

func TestStopUnknownStreamIsHarmless(t *testing.T) {
	Stop(math.MaxUint32)
	Stop(0)
}
