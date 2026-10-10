//go:build windows

package winos

import (
	"strings"
	"testing"
)

// 注意：这些测试**绝不写注册表**（会污染用户机器），只覆盖纯函数部分
// 外加一个只读的 Status 冒烟测试。

func TestProgIDFor(t *testing.T) {
	video := []string{"mp4", "m4v", "mov", "webm", "mkv"}
	for _, ext := range video {
		for _, form := range []string{ext, "." + ext, strings.ToUpper(ext), "." + strings.ToUpper(ext)} {
			if got := ProgIDFor(form); got != VideoProgID {
				t.Errorf("ProgIDFor(%q) = %q，期望 %q", form, got, VideoProgID)
			}
		}
	}

	image := []string{"jpg", "jpeg", "jfif", "png", "gif", "webp", "avif", "bmp", "ico", "svg", "tif", "tiff"}
	for _, ext := range image {
		if got := ProgIDFor(ext); got != ProgID {
			t.Errorf("ProgIDFor(%q) = %q，期望 %q", ext, got, ProgID)
		}
	}

	// 未知扩展名一律落到图片 ProgID，不返回空串。
	if got := ProgIDFor("txt"); got != ProgID {
		t.Errorf("ProgIDFor(\"txt\") = %q，期望 %q", got, ProgID)
	}
}

func TestOpenCommand(t *testing.T) {
	cases := map[string]string{
		`C:\Tool\lumina.exe`:     `"C:\Tool\lumina.exe" "%1"`,
		`D:\工具\拾光\lumina.exe`:    `"D:\工具\拾光\lumina.exe" "%1"`,
		`C:\Program Files\l.exe`: `"C:\Program Files\l.exe" "%1"`,
	}
	for exe, want := range cases {
		if got := openCommand(exe); got != want {
			t.Errorf("openCommand(%q) = %q，期望 %q", exe, got, want)
		}
	}
}

func TestIconValue(t *testing.T) {
	if got, want := iconValue(`C:\Tool\lumina.exe`), `"C:\Tool\lumina.exe",0`; got != want {
		t.Errorf("iconValue = %q，期望 %q", got, want)
	}
}

func TestExeName(t *testing.T) {
	if got, err := exeName(`D:\Tool\lumina.exe`); err != nil || got != "lumina.exe" {
		t.Errorf("exeName = (%q, %v)，期望 lumina.exe", got, err)
	}
	if _, err := exeName(""); err == nil {
		t.Error("exeName(\"\") 应当报错（无法确定可执行文件名）")
	}
}

func TestCommandValueIsReadable(t *testing.T) {
	// CommandValue 只读注册表；未注册时返回空串，已注册时必须是 "<exe>" "%1" 格式。
	got := CommandValue()
	if got == "" {
		t.Skip("本机未注册拾光，跳过格式校验")
	}
	if !strings.HasSuffix(got, ` "%1"`) || !strings.HasPrefix(got, `"`) {
		t.Errorf("CommandValue 格式不对：%q", got)
	}
}

func TestHelpText(t *testing.T) {
	help := HelpText()
	if strings.TrimSpace(help) == "" {
		t.Fatal("HelpText 不应为空")
	}
	for _, want := range []string{
		"--register", "--set-default", "--status", "--unregister", "--help",
		ProgID, VideoProgID,
	} {
		if !strings.Contains(help, want) {
			t.Errorf("HelpText 缺少 %q", want)
		}
	}
}

func TestStatusSmoke(t *testing.T) {
	// 只读查询：在干净环境（从未注册过）下也不应 panic 或报错。
	out, err := Status(`C:\Tool\lumina.exe`)
	if err != nil {
		t.Fatalf("Status 返回错误：%v", err)
	}
	for _, want := range []string{"程序路径：", "右键菜单：", "各扩展名的默认打开方式：", ".jpg", ".mp4"} {
		if !strings.Contains(out, want) {
			t.Errorf("Status 输出缺少 %q\n---\n%s", want, out)
		}
	}
}

func TestAssocSetRejectsUnknownExt(t *testing.T) {
	// 只验证参数校验：未知扩展名必须在写注册表之前就被拒绝。
	if err := AssocSet("", true); err == nil {
		t.Error("AssocSet(\"\") 应当报错")
	}
	if err := AssocSet(".exe", true); err == nil {
		t.Error("AssocSet(\".exe\") 应当报错（不在支持列表）")
	}
}
