<#
  下载 FFmpeg release essentials（gyan.dev 官方静态构建）到 src-tauri\bin\，
  按 Tauri externalBin 规则命名：ffmpeg-x86_64-pc-windows-msvc.exe。

  用法：
    bun run fetch:ffmpeg              # 已存在则跳过
    bun run fetch:ffmpeg -- -Force    # 重新下载
    powershell -File tools\fetch-ffmpeg.ps1 -Stage   # 构建后：把 sidecar 拷进 target\release\

  下载失败时自动回退拷贝本机 winget 安装的 ffmpeg（-NoFallback 禁止）。
  产物不入库（.gitignore 排除），仓库里只保留本脚本与许可证说明。
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$NoFallback,
    [switch]$Stage,
    [string]$Url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot          # tools\ 的上级 = 仓库根
$binDir = Join-Path $root 'src-tauri\bin'
$target = Join-Path $binDir 'ffmpeg-x86_64-pc-windows-msvc.exe'

# -Stage: 构建完成后把 sidecar 拷到便携版目录（target\release 即交付目录）。
if ($Stage) {
    if (-not (Test-Path $target)) { throw "缺少 $target，先跑 bun run fetch:ffmpeg" }
    foreach ($dest in @((Join-Path $root 'src-tauri\target\release'), (Join-Path $root 'src-tauri\target\debug'))) {
        if (Test-Path (Split-Path $dest -Parent)) {
            New-Item -ItemType Directory -Force -Path $dest | Out-Null
            Copy-Item $target $dest -Force
            Write-Host "staged -> $dest" -ForegroundColor DarkGray
        }
    }
    exit 0
}

if ((Test-Path $target) -and -not $Force) {
    Write-Host "ffmpeg sidecar 已存在，跳过下载：$target"
    & $target -version | Select-Object -First 1
    exit 0
}

New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$zip = Join-Path $env:TEMP 'ffmpeg-release-essentials.zip'
$ok = $false

try {
    Write-Host "下载 $Url …"
    & curl.exe -L --fail --retry 3 --connect-timeout 15 -o $zip $Url
    if ($LASTEXITCODE -eq 0 -and (Test-Path $zip)) { $ok = $true }
}
catch { $ok = $false }

if ($ok) {
    $tmp = Join-Path $env:TEMP ("ffmpeg-extract-" + [guid]::NewGuid().ToString('N'))
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $exe = Get-ChildItem -Path $tmp -Recurse -Filter ffmpeg.exe | Select-Object -First 1
    if (-not $exe) { throw "zip 里没有 ffmpeg.exe" }
    Copy-Item $exe.FullName $target -Force

    # 随包许可证：zip 里有 LICENSE 就直接带上，否则写一份指针说明。
    $lic = Get-ChildItem -Path $tmp -Recurse -Include LICENSE*, COPYING*, NOTICE* -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($lic) {
        Copy-Item $lic.FullName (Join-Path $binDir 'LICENSE.ffmpeg.txt') -Force
    }
    else {
        Set-Content -Path (Join-Path $binDir 'LICENSE.ffmpeg.txt') -Encoding utf8 -Value @(
            'FFmpeg — bundled ffmpeg.exe sidecar (gyan.dev release-essentials build).'
            'Unmodified separate executable; licensed under LGPL/GPL v2 or later.'
            'License:   https://ffmpeg.org/legal.html'
            'Source:    https://git.ffmpeg.org/gitweb/ffmpeg.git'
            "Build URL: $Url"
        )
    }
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Write-Host "已安装（下载的 essentials 构建）：$target" -ForegroundColor Green
}
elseif (-not $NoFallback) {
    $wingetFf = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') `
        -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like '*\bin\ffmpeg.exe' } | Select-Object -First 1
    if (-not $wingetFf) { throw "下载失败（exit $LASTEXITCODE），且本机未找到 winget 安装的 ffmpeg 可回退" }
    Copy-Item $wingetFf.FullName $target -Force
    Write-Warning "下载失败，回退使用本机构建：$($wingetFf.FullName)"
    Write-Warning "注意：full build 体积更大且含 GPL 组件；联网后重跑本脚本可换成 essentials。"
}
else {
    throw "下载失败（exit $LASTEXITCODE），且已禁用回退（-NoFallback）"
}

# 自检：版本 + eac3 解码器必须在，否则打包进去也白搭。
Write-Host "`n--- 自检 ---"
& $target -version | Select-Object -First 1
$dec = & $target -hide_banner -decoders 2>$null | Out-String
if ($dec -match '\beac3\b') {
    Write-Host "eac3 解码器：✓ 已包含" -ForegroundColor Green
}
else {
    Write-Warning "eac3 解码器未出现在 -decoders 列表！这个构建不能用，请换构建源。"
    exit 1
}