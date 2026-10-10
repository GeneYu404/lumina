// Package sidecar drives the bundled FFmpeg build as a **separate process**:
// the seam for codecs the WebView cannot decode.
//
// WebView2 covers H.264/AAC/VP9/AV1 (and, depending on the machine, HEVC and
// Dolby Digital — see the capability probe in the About dialog) through Media
// Foundation. What it cannot do on *some* machines is play an E-AC-3 track.
// Instead of linking libavcodec (MSVC import-libs, unsafe FFI, ABI pain) we
// ship a small ffmpeg build and drive it as a **separate process**: licensing
// stays isolated, this package stays spawn + pipe, and the binary can be
// swapped for a different build without touching any code here.
//
// Two entry points:
//   - ProbeMedia — one-shot check, used by the info panel.
//   - Stream — decode from a timestamp and push PCM to the frontend over an IPC
//     channel, which the frontend feeds into WebAudio.
//
// Pure Go, zero cgo, standard library only.
package sidecar

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
)

// Bundler externalBin naming: `<name>-<target-triple><ext>`. The bundler copies
// the sidecar next to the executable under its plain name (`ffmpeg.exe`), while
// a manually staged build keeps the triple-qualified one — accept both. The
// `sidecar-` spelling is also accepted because that is how some staging
// scripts name the triple-qualified binary.
var sidecarNames = []string{
	"ffmpeg-x86_64-pc-windows-msvc.exe",
	"sidecar-x86_64-pc-windows-msvc.exe",
	"ffmpeg.exe",
}

// Probe ceiling: 4 MB of s16le stereo @48 kHz is ~11 s of audio — plenty to
// prove the decoder works, small enough that a long file cannot turn the
// check into a full decode.
const probePCMCap = 4 * 1024 * 1024

// PCM forwarded per channel message: 64 KB = 16 K stereo frames ≈ 0.17 s at
// 48 kHz. Big enough to keep the message rate sane, small enough that a seek
// does not leave a long tail of stale audio in the ring buffer.
const streamChunk = 64 * 1024

// Probe reports what a one-shot decode of the first audio stream produced.
type Probe struct {
	// Available: sidecar present and able to decode this file.
	Available bool `json:"available"`
	// HasEAC3: this build ships the native E-AC-3 decoder — the reason we ship one.
	HasEAC3 bool `json:"hasEac3"`
	// SampleRate / Channels: decoded PCM layout, read from the WAV header
	// ffmpeg wrote on stdout.
	SampleRate uint32 `json:"sampleRate"`
	Channels   uint16 `json:"channels"`
	// PCMBytes: bytes of raw s16le PCM (WAV header stripped).
	PCMBytes int `json:"pcmBytes"`
	// Detail: ffmpeg's own diagnostics (empty on success, error text on failure).
	Detail string `json:"detail"`
}

// StreamInfo is what the frontend needs to build an `AudioContext` and size its
// ring buffer.
type StreamInfo struct {
	ID         uint32 `json:"id"`
	SampleRate uint32 `json:"sampleRate"`
	Channels   uint16 `json:"channels"`
	// Start: offset in the media this stream starts at, seconds.
	Start float64 `json:"start"`
}

// SidecarPath locates the bundled binary, in order:
//  1. $LUMINA_FFMPEG — explicit override (tests, unusual layouts),
//  2. next to the running exe (installed layout; several accepted names),
//  3. the parent of that directory,
//  4. `resources/` relative to the package root — where `mygo build` bundles
//     it, and where `bun run fetch:ffmpeg` puts it,
//  5. `bin/` for older checkouts.
//
// When nothing matches it returns the primary name as a bare relative path,
// so callers can report a meaningful "missing" message.
func SidecarPath() string {
	if p, ok := os.LookupEnv("LUMINA_FFMPEG"); ok && p != "" {
		return p
	}
	bases := []string{}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		bases = append(bases, dir, filepath.Dir(dir))
	}
	bases = append(bases, "resources", "bin")
	for _, base := range bases {
		for _, name := range sidecarNames {
			candidate := filepath.Join(base, name)
			if st, err := os.Stat(candidate); err == nil && !st.IsDir() {
				return candidate
			}
		}
	}
	return sidecarNames[0]
}

var (
	eac3Once    sync.Once
	eac3Decoder bool
)

// HasEAC3Decoder reports whether this ffmpeg build ships the native E-AC-3
// decoder — the whole reason the sidecar exists. Cached: the build cannot
// change while we run.
func HasEAC3Decoder() bool {
	eac3Once.Do(func() {
		ff := SidecarPath()
		if _, err := os.Stat(ff); err != nil {
			return
		}
		out, err := exec.Command(ff, "-hide_banner", "-decoders").Output()
		if err != nil {
			return
		}
		// `... eac3  E-AC-3 (Enhanced AC-3)`: field 0 is the flag column.
		for _, line := range strings.Split(string(out), "\n") {
			if fields := strings.Fields(line); len(fields) > 1 && fields[1] == "eac3" {
				eac3Decoder = true
				return
			}
		}
	})
	return eac3Decoder
}

// ProbeMedia decodes the first audio stream of mediaPath to s16le PCM on
// stdout and reports what came back. Reads at most probePCMCap, then stops the
// child — a probe must not turn into a full-file decode.
//
// The command deliberately uses the `pcm_s16le` **encoder** rather than
// `-f s16le -ac .. -ar ..`: the encoder converts fltp → s16 inside libavcodec
// via libswresample, so the minimal build needs neither libavfilter nor the
// auto-inserted `aresample`. A WAV header rides along, which is how the caller
// learns the real rate/layout instead of forcing one.
func ProbeMedia(mediaPath string) (Probe, error) {
	ff := SidecarPath()
	if _, err := os.Stat(ff); err != nil {
		return Probe{Detail: fmt.Sprintf("sidecar missing: %s", ff)}, nil
	}
	hasEAC3 := HasEAC3Decoder()
	cmd := exec.Command(ff,
		"-v", "error", "-nostdin", "-i", mediaPath,
		"-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "wav", "-")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return Probe{}, fmt.Errorf("no stdout pipe")
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return Probe{}, fmt.Errorf("no stderr pipe")
	}
	if err := cmd.Start(); err != nil {
		return Probe{}, fmt.Errorf("spawn ffmpeg: %w", err)
	}

	var raw []byte
	readErr := readCapped(stdout, probePCMCap, &raw)
	// Either the cap or EOF stopped the read; either way the child is done
	// with us. Kill() on an already-exited process is a harmless error.
	// Order matters: Wait closes the pipes, so stderr must be drained first.
	if cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	var diagnostics []byte
	if stderr != nil {
		_ = readCapped(stderr, 8192, &diagnostics)
	}
	_ = cmd.Wait()

	detail := strings.TrimSpace(string(diagnostics))
	if readErr != nil {
		return Probe{}, fmt.Errorf("read pcm: %w", readErr)
	}
	if wav := parseWAV(raw); wav != nil && wav.pcmBytes > 0 {
		return Probe{
			Available:  true,
			HasEAC3:    hasEAC3,
			SampleRate: wav.sampleRate,
			Channels:   wav.channels,
			PCMBytes:   wav.pcmBytes,
			Detail:     detail,
		}, nil
	}
	if detail == "" {
		detail = "no audio stream"
	}
	return Probe{Available: false, HasEAC3: hasEAC3, Detail: detail}, nil
}

// readCapped reads at most limit bytes into dst. A short read means EOF, which
// is not an error here — callers stop for their own reasons.
func readCapped(r io.Reader, limit int, dst *[]byte) error {
	buf := make([]byte, 32*1024)
	for len(*dst) < limit {
		n, err := r.Read(buf)
		if n > 0 {
			room := limit - len(*dst)
			if n > room {
				n = room
			}
			*dst = append(*dst, buf[:n]...)
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
	}
	return nil
}

// killAndWait kills the child and reaps it. Go has no implicit reap: without
// the explicit Wait the ffmpeg process lingers as a zombie. Only ever call
// this from the goroutine that owns the child's pipes, once its reads are done.
func killAndWait(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	_ = cmd.Wait()
}

type wavInfo struct {
	sampleRate uint32
	channels   uint16
	pcmBytes   int
	// dataAt is the offset of the first PCM byte — the header is stripped
	// before the samples reach WebAudio.
	dataAt int
}

// parseWAV walks RIFF chunks instead of assuming a 44-byte header: ffmpeg may
// prepend a LIST/INFO chunk, and when writing to a pipe the `data` size is
// left as 0xFFFFFFFF — neither matters as long as `fmt ` then `data` are found.
//
// A nil result means "not a complete header yet": that covers both garbage and
// a chunk header the pipe cut in half, and the caller must keep reading —
// claiming success on a half-read `data` size would make the player eat PCM as
// header.
func parseWAV(buf []byte) *wavInfo {
	if len(buf) < 12 || string(buf[0:4]) != "RIFF" || string(buf[8:12]) != "WAVE" {
		return nil
	}
	var rate uint32
	var channels uint16
	pos := 12
	for pos+8 <= len(buf) {
		id := string(buf[pos : pos+4])
		size := int(binary.LittleEndian.Uint32(buf[pos+4 : pos+8]))
		body := pos + 8
		switch {
		case id == "fmt " && body+16 <= len(buf):
			channels = binary.LittleEndian.Uint16(buf[body+2 : body+4])
			rate = binary.LittleEndian.Uint32(buf[body+4 : body+8])
		case id == "data":
			if rate == 0 || channels == 0 {
				return nil
			}
			return &wavInfo{
				sampleRate: rate,
				channels:   channels,
				pcmBytes:   len(buf) - body,
				dataAt:     body,
			}
		}
		// A pipe may cut a chunk in half; wait for the rest before skipping.
		if body+size > len(buf) {
			return nil
		}
		pos = body + size + (size & 1) // chunks are word-aligned
	}
	return nil
}

/* ------------------------------------------------------------------ */
/* Streaming playback                                                  */
/* ------------------------------------------------------------------ */

// session is a running ffmpeg decode, killable from the UI (seek, stop, next
// image). Reaping (cmd.Wait) stays with the goroutine that drains stdout, so
// this type only ever kills.
type session struct {
	id  uint32
	mu  sync.Mutex
	cmd *exec.Cmd
}

// kill terminates the child without reaping it; the reader goroutine owns Wait.
func (s *session) kill() {
	s.mu.Lock()
	cmd := s.cmd
	s.cmd = nil
	s.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

var (
	sessions sync.Map // uint32 -> *session
	nextID   atomic.Uint32
)

// Stop kills a stream and forgets it. Safe to call with a stale id.
func Stop(id uint32) {
	if v, ok := sessions.LoadAndDelete(id); ok {
		v.(*session).kill()
	}
}

func forgetSession(s *session) {
	sessions.CompareAndDelete(s.id, s)
}

// Stream decodes the first audio stream from start seconds and pushes
// interleaved s16le PCM to onPCM until the media ends, onPCM returns false, or
// Stop is called with the returned id.
//
// onPCM returning false means "the frontend is done" (seek, next image); the
// child is then killed quietly and the stream ends. Each callback gets its own
// buffer, so it is safe to retain asynchronously. An empty slice is the
// end-of-stream marker.
//
// Blocking only until the WAV header has arrived (so the caller learns
// rate/layout) or the pipe died: the PCM pumping continues in the background.
// Meant to be called from a worker goroutine.
func Stream(mediaPath string, start float64, onPCM func([]byte) bool) (StreamInfo, error) {
	if onPCM == nil {
		return StreamInfo{}, errors.New("no pcm callback")
	}
	ff := SidecarPath()
	if _, err := os.Stat(ff); err != nil {
		return StreamInfo{}, fmt.Errorf("sidecar missing: %s", ff)
	}
	if !(start > 0) || math.IsInf(start, 0) || math.IsNaN(start) {
		start = 0
	}
	// `-ss` before `-i` seeks by demuxing, which is what audio wants: fast and
	// sample-accurate enough that a scrub does not visibly jump.
	args := []string{"-v", "error", "-nostdin"}
	if start > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.3f", start))
	}
	args = append(args, "-i", mediaPath, "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "wav", "-")

	cmd := exec.Command(ff, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return StreamInfo{}, errors.New("no stdout pipe")
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return StreamInfo{}, errors.New("no stderr pipe")
	}
	if err := cmd.Start(); err != nil {
		return StreamInfo{}, fmt.Errorf("spawn ffmpeg: %w", err)
	}

	// Read until the header is complete so the caller can size its buffers.
	head := make([]byte, 0, streamChunk)
	probe := make([]byte, 8*1024)
	var info *wavInfo
	for {
		n, err := stdout.Read(probe)
		if err != nil && !errors.Is(err, io.EOF) {
			killAndWait(cmd)
			return StreamInfo{}, fmt.Errorf("read header: %w", err)
		}
		if n == 0 {
			var e []byte
			if stderr != nil {
				e, _ = io.ReadAll(stderr)
			}
			killAndWait(cmd)
			if msg := strings.TrimSpace(string(e)); msg != "" {
				return StreamInfo{}, errors.New(msg)
			}
			return StreamInfo{}, errors.New("没有可解码的音轨")
		}
		head = append(head, probe[:n]...)
		if w := parseWAV(head); w != nil {
			info = w
			break
		}
		if len(head) > 1024*1024 {
			killAndWait(cmd)
			return StreamInfo{}, errors.New("WAV 头过大，ffmpeg 输出异常")
		}
	}

	// Everything up to `dataAt` is header; the rest is PCM.
	leftover := append([]byte(nil), head[info.dataAt:]...)
	info.pcmBytes = len(leftover)

	id := nextID.Add(1)
	sess := &session{id: id, cmd: cmd}
	sessions.Store(id, sess)

	go func() {
		// Reap the child no matter how this goroutine ends — Go does not do it
		// for us, and a killed ffmpeg that nobody waited on becomes a zombie.
		defer func() {
			_ = cmd.Wait()
			forgetSession(sess)
		}()
		if len(leftover) > 0 && !onPCM(leftover) {
			return
		}
		buf := make([]byte, streamChunk)
		for {
			n, err := stdout.Read(buf)
			if err != nil || n == 0 {
				break
			}
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			if !onPCM(chunk) {
				break // frontend went away (seek / next image)
			}
		}
		// An empty message is the end-of-stream marker.
		onPCM(nil)
	}()

	return StreamInfo{ID: id, SampleRate: info.sampleRate, Channels: info.channels, Start: start}, nil
}
