<#
  只出「免安装便携版」：跑完 mygo build 后，把安装包去掉，
  并把可分发的文件汇总到 build\portable\。

  为什么还要跑一遍 mygo build：Windows 任务的图标、DPI 感知清单、版本信息
  都是 MyGo 在编译期生成 .syso 链接进 exe 的（见 mygo 的 winres.go）。
  改用裸 `go build` 的话 exe 会退回 Go 的默认图标 —— 任务栏、资源管理器、
  Alt+Tab 全都变丑，不值得。

  MyGo 0.3.7 在 Windows 上没有跳过安装包的开关（nsisCompiler 无条件下载并
  调用 makensis），所以只能事后剔除。

  用法
    bun run build:portable
    powershell -File tools\build-portable.ps1 -KeepInstaller   # 顺便保留安装包
#>
[CmdletBinding()]
param(
    [switch]$KeepInstaller
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot          # tools\ 的上级 = 仓库根
Set-Location $root

$env:GOPROXY = if ($env:GOPROXY) { $env:GOPROXY } else { 'https://goproxy.cn,direct' }

Write-Host "`n--- mygo build ---" -ForegroundColor Cyan
& mygo build
if ($LASTEXITCODE -ne 0) { throw "mygo build 失败（exit $LASTEXITCODE）" }

$platform = 'windows-amd64'
$src = Join-Path $root "build\$platform"
if (-not (Test-Path $src)) { throw "找不到构建产物 $src" }

# 安装包：默认剔除
$setups = Get-ChildItem $src -Filter '*Setup*.exe' -File -ErrorAction SilentlyContinue
foreach ($setup in $setups) {
    if ($KeepInstaller) {
        Write-Host "保留安装包：$($setup.Name)" -ForegroundColor DarkGray
    }
    else {
        Remove-Item -LiteralPath $setup.FullName -Force
        Write-Host "已剔除安装包：$($setup.Name)" -ForegroundColor DarkGray
    }
}

# 汇总便携目录
$portable = Join-Path $root 'build\portable'
if (Test-Path $portable) {
    Remove-Item -LiteralPath $portable -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $portable | Out-Null

Get-ChildItem $src -File | ForEach-Object {
    Copy-Item $_.FullName $portable -Force
}

# FFmpeg sidecar 存在才带上；不存在时兜底解码会优雅降级
$ffmpeg = Get-ChildItem (Join-Path $root 'resources') -Filter 'ffmpeg*.exe' -File -ErrorAction SilentlyContinue
if ($ffmpeg) {
    $ffmpeg | ForEach-Object {
        Copy-Item $_.FullName $portable -Force
        Write-Host "带上 sidecar：$($_.Name)" -ForegroundColor DarkGray
    }
}
else {
    Write-Warning 'resources\ 下没有 ffmpeg*.exe —— 兜底解码不可用。'
    Write-Warning '先跑 bun run fetch:ffmpeg 下载 sidecar。'
}

Write-Host "`n--- 便携版 ---" -ForegroundColor Green
Get-ChildItem $portable -File | ForEach-Object {
    Write-Host ("  {0,-32} {1,8} MB" -f $_.Name, [math]::Round($_.Length / 1MB, 2))
}
Write-Host "`n目录：$portable" -ForegroundColor Green
