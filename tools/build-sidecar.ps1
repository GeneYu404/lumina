<#
  在 MSYS2 的 MINGW64 环境里构建最小 FFmpeg sidecar（tools/build-ffmpeg-sidecar.sh 的包装）。

  为什么必须设 MSYSTEM=MINGW64：ffmpeg 的 configure 直接拒绝 MSYS 构建环境
  （"Native MSYS builds are discouraged"），而 MINGW64 并不是另一个 bash.exe，
  只是同一个 bash 换一个环境变量。

  用法：
    bun run build:sidecar
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bash = 'D:\MSYS2\usr\bin\bash.exe'

if (-not (Test-Path $bash)) {
    throw "找不到 MSYS2 的 bash（$bash）。先装 MSYS2 并执行：pacman -S --needed mingw-w64-x86_64-gcc mingw-w64-x86_64-make mingw-w64-x86_64-pkgconf mingw-w64-x86_64-nasm"
}

# 仓库路径转成 MSYS2 能懂的 POSIX 形式： D:\Ai\lumina -> /d/Ai/lumina
$posix = ($root -replace '\\', '/')
if ($posix -match '^([A-Za-z]):/(.*)$') {
    $posix = '/' + $Matches[1].ToLower() + '/' + $Matches[2]
}

$env:MSYSTEM = 'MINGW64'
& $bash -lc "cd '$posix' && bash tools/build-ffmpeg-sidecar.sh"
if ($LASTEXITCODE -ne 0) {
    throw "sidecar 构建失败（exit $LASTEXITCODE）"
}
