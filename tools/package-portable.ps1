<#
  组装便携版：
    1. npx tauri build          —— 产物在 src-tauri/target/release/lumina.exe
    2. 把 exe 拷到 out\         —— out\ 是输出目录（整体 gitignore）
    3. 拷 portable\ 下的文档与脚本 —— portable\ 是入库的源头

  用法：
    npm run package:portable                          # 构建 + 组装
    powershell -File tools\package-portable.ps1 -NoBuild   # 跳过构建，只重新组装
#>
[CmdletBinding()]
param(
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot   # tools\ 的上级目录
$exeSrc = Join-Path $root 'src-tauri\target\release\lumina.exe'
$portableSrc = Join-Path $root 'portable'
$outDir = Join-Path $root 'out'

if (-not $NoBuild) {
    Push-Location $root
    try {
        & npx tauri build
        if ($LASTEXITCODE -ne 0) { throw "npx tauri build 失败（退出码 $LASTEXITCODE）" }
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path $exeSrc)) { throw "找不到 $exeSrc，请先运行构建。" }
if (-not (Test-Path $portableSrc)) { throw "找不到便携版源头目录 $portableSrc。" }

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# 清掉上次组装的残留，避免改名/删除后的旧文件混进 out\
Remove-Item (Join-Path $outDir '*') -Recurse -Force -ErrorAction SilentlyContinue

Copy-Item $exeSrc (Join-Path $outDir 'lumina.exe') -Force
Copy-Item (Join-Path $portableSrc '*') $outDir -Force -Recurse

# 组装结果自检：exe + 文档 + 4 个脚本缺一不可
$required = @(
    'lumina.exe',
    'PORTABLE.md',
    '1-register.ps1',
    '2-set-default.ps1',
    '3-status.ps1',
    '4-unregister.ps1'
)
$missing = $required | Where-Object { -not (Test-Path (Join-Path $outDir $_)) }
if ($missing) { throw "组装不完整，缺少：$($missing -join '、')" }

Write-Host ""
Write-Host "便携版已组装到 $outDir" -ForegroundColor Green
Get-ChildItem $outDir | Format-Table Name, @{n = 'Size(KB)'; e = { [math]::Round($_.Length / 1KB, 1) } }, LastWriteTime -AutoSize
