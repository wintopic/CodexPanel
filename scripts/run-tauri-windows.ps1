param(
  [ValidateSet("build", "dev")]
  [string]$Mode = "build"
)

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $projectDir

$cargoBin = Join-Path $HOME ".cargo\bin"
if (Test-Path -LiteralPath $cargoBin) {
  $env:Path = "$cargoBin;$env:Path"
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere)) {
  throw "vswhere.exe not found. Install Visual Studio Build Tools with the C++ workload."
}

$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) {
  throw "Visual Studio Build Tools C++ workload was not found."
}

$devCmd = Join-Path $vsPath "Common7\Tools\VsDevCmd.bat"
if (-not (Test-Path -LiteralPath $devCmd)) {
  throw "VsDevCmd.bat not found: $devCmd"
}

$envLines = cmd /s /c "`"$devCmd`" -arch=x64 -host_arch=x64 >nul && set"
foreach ($line in $envLines) {
  $index = $line.IndexOf("=")
  if ($index -gt 0) {
    [Environment]::SetEnvironmentVariable($line.Substring(0, $index), $line.Substring($index + 1), "Process")
  }
}

$linkPath = (where.exe link | Select-Object -First 1)
if ($linkPath -notmatch "\\Microsoft Visual Studio\\") {
  throw "MSVC link.exe is not first on PATH. First link.exe: $linkPath"
}

Write-Host "Using MSVC linker: $linkPath"
npx tauri $Mode
