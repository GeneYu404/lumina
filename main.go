// Command lumina is the Go + MyGo shell of 拾光 Lumina, a Windows 11 style
// image and video viewer.
//
// The shell is plain Go, zero cgo, and renders through the system WebView2.
// The React frontend in src/ is shared with the web build; four modules
// (desktop.ts, native.ts, utils/pcmPlayer.ts, components/Gallery.tsx) bridge
// it to this process through MyGo's typed IPC, and degrade to no-ops in a
// plain browser.
//
//	bun run dev             # mygo dev: the app with live reload
//	bun run build:portable  # the portable app in build/portable/, no installer
//	go test ./...           # the pure logic: parsing, scanning, sidecar, protocol
package main

import (
	"encoding/json/v2"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo"

	"lumina/internal/app"
	"lumina/internal/asset"
	"lumina/internal/media"
	"lumina/internal/winos"
)

const appTitle = "拾光"

func main() {
	// The registration switches run, report and exit without ever opening a
	// window. They are handled before MyGo starts, exactly like the Rust
	// shell did.
	if flag, ok := cliFlag(); ok {
		os.Exit(runCLI(flag))
	}

	mygo.App.SetName(appTitle)

	launch := launchTargets()

	if !mygo.App.RequestSingleInstanceLock() {
		return // another instance took our command line; it will open the files
	}

	service := app.New(launch)

	// The local file scheme. Registered before any window exists, and gated
	// on the same registry the IPC methods use: a file the page never
	// imported must not be readable through the URL.
	if err := mygo.Protocol.Handle("lumina", &asset.Handler{Allow: app.AllowFunc(service)}); err != nil {
		log.Fatalf("lumina: 注册 lumina:// 协议失败: %v", err)
	}
	mygo.Bind(service)

	// A second launch (double-click in Explorer while running) hands us its
	// paths; show them in the window we already have.
	mygo.App.OnSecondInstance(func(args []string, _ string) {
		paths := mediaTargets(args)
		if len(paths) == 0 {
			if w := app.MainWindow(); w != nil {
				w.Show()
				w.Focus()
			}
			return
		}
		service.OpenPaths(paths)
	})

	// A file opened with the app while it is running (Shell → Open With,
	// or the file manager handing us a document) arrives here.
	mygo.App.OnOpenFile(func(path string) {
		service.OpenPaths([]string{path})
	})

	mygo.App.WhenReady(func() { createWindow(service, launch) })

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

// createWindow builds the main window. It is created hidden so the page can
// render its first frame before anything appears: a white flash and a
// welcome screen are both worse than a short wait.
func createWindow(service *app.Lumina, launch []string) {
	// Only the launched files themselves: metadata + a header probe, a few
	// milliseconds.
	var entries []app.Entry
	for _, p := range launch {
		if e := media.Describe(p); e != nil {
			entries = append(entries, *e)
		}
	}
	boot := app.Boot{
		Entries:  entries,
		Selected: 0,
		// Exactly one image was opened: its folder loads in the background.
		Siblings: len(launch) == 1 && len(entries) > 0,
	}

	win := mygo.NewWindow(mygo.WindowOptions{
		Title:           appTitle,
		URL:             "/",
		Width:           1280,
		Height:          820,
		MinWidth:        720,
		MinHeight:       480,
		Hidden:          true,
		BackgroundColor: "light-dark(#f3f3f6, #06122e)",
		Page: mygo.PageOptions{
			// Injected before any page script runs, so an image opened from
			// Explorer is on screen with no IPC round trip in front of it.
			PreloadScript: bootScript(boot),
		},
	})
	app.SetMainWindow(win)

	// Files dragged from Explorer carry paths, which DOM drop events hide.
	win.OnFileDrop(func(e *mygo.FileDropEvent) {
		if len(e.Paths) > 0 {
			service.OpenPaths(e.Paths)
		}
	})

	// The page shows the window after its first render. Safety net: never
	// stay hidden, whatever the page does.
	go func() {
		time.Sleep(1500 * time.Millisecond)
		win.Show()
	}()
}

// bootScript renders the launch data as the preload script. A payload the
// page cannot parse becomes null, which it already handles.
func bootScript(boot app.Boot) string {
	raw, err := json.Marshal(boot)
	if err != nil {
		return "window.__LUMINA_BOOT__ = null;"
	}
	return "window.__LUMINA_BOOT__ = " + string(raw) + ";"
}

/* ----------------------------- command line ----------------------------- */

// cliFlags are the registration switches. Doubling the exe opens a window;
// these do one registry job and exit.
var cliFlags = []string{
	"--register", "--unregister", "--set-default", "--status", "--help", "-h",
}

func cliFlag() (string, bool) {
	for _, arg := range os.Args[1:] {
		for _, f := range cliFlags {
			if arg == f {
				return f, true
			}
		}
	}
	return "", false
}

// runCLI performs one registry job and reports the result — to the console
// when there is one (a terminal, or a `--status` from a script) and in a
// message box otherwise, since the release build has no console at all.
func runCLI(flag string) int {
	exe, err := os.Executable()
	if err != nil {
		winos.ReportError(appTitle, "无法定位自身路径："+err.Error())
		return 1
	}

	var (
		message string
		failure error
	)
	switch flag {
	case "--help", "-h":
		message = winos.HelpText()
	case "--register":
		message, failure = winos.Register(exe)
	case "--unregister":
		message, failure = winos.Unregister(exe)
	case "--set-default":
		message, failure = winos.SetDefault(exe)
	case "--status":
		message, failure = winos.Status(exe)
	default:
		failure = errUnknownFlag(flag)
	}

	if failure != nil {
		winos.ReportError(appTitle, failure.Error())
		return 1
	}
	winos.Report(appTitle, message)
	return 0
}

type errUnknownFlag string

func (e errUnknownFlag) Error() string { return "未知参数：" + string(e) }

/* ------------------------------- launching ------------------------------- */

// launchTargets is what Windows passed on the command line ("打开方式" or a
// double click), deduplicated and made absolute.
func launchTargets() []string { return mediaTargets(os.Args[1:]) }

func mediaTargets(args []string) []string {
	var (
		out  []string
		seen = map[string]bool{}
	)
	for _, arg := range args {
		if arg == "" || strings.HasPrefix(arg, "-") {
			continue
		}
		if !media.IsMedia(arg) {
			continue
		}
		abs, err := filepath.Abs(arg)
		if err != nil {
			continue
		}
		if seen[strings.ToLower(abs)] {
			continue
		}
		seen[strings.ToLower(abs)] = true
		out = append(out, abs)
	}
	return out
}
