package app

import (
	"context"

	"github.com/egoist/mygo"

	"lumina/internal/sidecar"
	"lumina/internal/winos"
)

/* ------------------------- Windows shell integration ------------------------ */

// ShellMenu enables or disables the “用拾光打开” entry in the Explorer
// context menu. Everything lives under HKEY_CURRENT_USER, so no admin rights
// are needed and no reboot is required.
func (l *Lumina) ShellMenu(enabled bool) (bool, error) {
	if err := winos.ShellMenu(enabled); err != nil {
		return !enabled, nil // degrade quietly, like the web build
	}
	return enabled, nil
}

// ShellMenuState reports whether the context-menu entry is currently present.
func (l *Lumina) ShellMenuState() bool {
	return winos.ShellMenuState()
}

// AssocState returns the extensions currently registered to Lumina — the
// ones whose ProgID is one we own.
func (l *Lumina) AssocState() []string {
	return winos.AssocState()
}

// AssocSet turns one extension's file association on or off.
func (l *Lumina) AssocSet(ext string, enabled bool) error {
	return winos.AssocSet(ext, enabled)
}

// OpenDefaultApps hands the user the real page. Windows 11 protects the
// default-app choice, so there is nothing to set from here.
func (l *Lumina) OpenDefaultApps() error {
	return winos.OpenDefaultApps()
}

// RevealInFolder shows a file in Explorer with its name selected.
func (l *Lumina) RevealInFolder(path string) {
	mygo.Shell.ShowItemInFolder(path)
}

// OpenWithDefault hands a file to the system's registered player — the escape
// hatch for codecs WebView2 cannot decode (AC-3/DTS audio in MKV, and
// friends).
func (l *Lumina) OpenWithDefault(path string) error {
	return mygo.Shell.OpenPath(path)
}

/* ------------------------------ FFmpeg sidecar ----------------------------- */

// FfmpegProbe is a seam check for the bundled FFmpeg sidecar: decode the
// first audio stream of an allowed file to s16le PCM and report how many
// bytes came out. It proves the whole locate → spawn → decode path works on
// the user's machine.
func (l *Lumina) FfmpegProbe(path string) (sidecar.Probe, error) {
	if !l.allowedOne(path) {
		return sidecar.Probe{}, errPathNotAllowed
	}
	return sidecar.ProbeMedia(path)
}

// FfmpegStream starts streaming a file's first audio track as s16le PCM from
// `start` seconds. Used when WebView2 cannot decode the track itself; the
// frontend feeds the PCM into WebAudio and mutes the <video> element.
//
// It returns as soon as the WAV header has arrived — that is when the caller
// learns the rate and layout it needs to size its ring buffer — and the PCM
// keeps arriving on pcm until the media ends, the page closes the channel, or
// FfmpegStop is called with the returned id.
func (l *Lumina) FfmpegStream(ctx context.Context, path string, start float64, pcm *mygo.Channel[[]byte]) (sidecar.StreamInfo, error) {
	if !l.allowedOne(path) {
		return sidecar.StreamInfo{}, errPathNotAllowed
	}
	return sidecar.Stream(path, start, func(chunk []byte) bool {
		return pcm.Send(chunk) == nil
	})
}

// FfmpegStop ends a running FfmpegStream — a seek, a pause swap, or moving
// on to another image. A stale id is harmless.
func (l *Lumina) FfmpegStop(id uint32) {
	sidecar.Stop(id)
}
