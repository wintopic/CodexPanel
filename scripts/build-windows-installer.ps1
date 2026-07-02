param(
  [switch]$SkipBuild,
  [string]$AppVersion = ""
)

$ErrorActionPreference = "Stop"

$ProjectDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
Set-Location $ProjectDir

if (-not $AppVersion) {
  $AppVersion = (Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json).version
}

if (-not $SkipBuild) {
  npm run wails:build
  npm run wails:sidecar
}

$isccCandidates = @(
  "${env:LOCALAPPDATA}\Programs\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
)

$iscc = $isccCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $iscc) {
  $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($command) {
    $iscc = $command.Source
  }
}

if (-not $iscc) {
  throw "Inno Setup 6 was not found. Install it from https://jrsoftware.org/isinfo.php, then rerun this script."
}

New-Item -ItemType Directory -Force -Path "dist" | Out-Null
& $iscc "build/windows/CodexPanel.iss" "/DAppVersion=$AppVersion"
