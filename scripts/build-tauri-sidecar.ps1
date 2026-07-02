param(
  [string]$Target = "x86_64-pc-windows-msvc"
)

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $projectDir

$buildDir = Join-Path $projectDir ".build\tauri-sidecar"
$payloadDir = Join-Path $buildDir "payload"
$binDir = Join-Path $projectDir "src-tauri\bin"
$sidecarBaseName = "codexpanel-node-sidecar"
$sidecarName = "$sidecarBaseName-$Target.exe"
$sidecarPath = Join-Path $binDir $sidecarName

if (Test-Path -LiteralPath $buildDir) {
  $workspace = (Resolve-Path -LiteralPath $projectDir).Path
  $resolvedBuild = (Resolve-Path -LiteralPath $buildDir).Path
  if (-not $resolvedBuild.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove outside workspace: $resolvedBuild"
  }
  Remove-Item -LiteralPath $buildDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $payloadDir, $binDir | Out-Null
if (Test-Path -LiteralPath $sidecarPath) {
  Remove-Item -LiteralPath $sidecarPath -Force
}

npm run check
node --check (Join-Path $projectDir "windows\node-sidecar.js")

Copy-Item -LiteralPath (Join-Path $projectDir "package.json") -Destination $payloadDir
Copy-Item -LiteralPath (Join-Path $projectDir "server.js") -Destination $payloadDir
Copy-Item -LiteralPath (Join-Path $projectDir "public") -Destination $payloadDir -Recurse
Copy-Item -LiteralPath (Join-Path $projectDir "bin") -Destination $payloadDir -Recurse
Copy-Item -LiteralPath (Join-Path $projectDir "windows\node-sidecar.js") -Destination $payloadDir

$forbiddenPayloadNames = @("state.json", ".env", ".env.local", ".env.production")
$forbiddenPayloadFiles = Get-ChildItem -LiteralPath $payloadDir -Recurse -Force | Where-Object {
  $forbiddenPayloadNames -contains $_.Name -or $_.FullName -match "\\.codex(\\|$)"
}
if ($forbiddenPayloadFiles) {
  $list = ($forbiddenPayloadFiles | ForEach-Object { $_.FullName }) -join [Environment]::NewLine
  throw "Refusing to bundle user secrets or local state files:$([Environment]::NewLine)$list"
}

function Get-Sha256Hex([string]$Path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace("-", "")
  } finally {
    $stream.Dispose()
    $sha.Dispose()
  }
}

$payloadFiles = Get-ChildItem -LiteralPath $payloadDir -Recurse -File | Sort-Object FullName
$payloadSignature = ($payloadFiles | ForEach-Object {
  $relative = $_.FullName.Substring($payloadDir.Length).TrimStart([char[]]@('\', '/'))
  "$relative=$(Get-Sha256Hex $_.FullName)"
}) -join "`n"
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$payloadHash = [BitConverter]::ToString($sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($payloadSignature))).Replace("-", "").Substring(0, 12).ToLowerInvariant()
$sha256.Dispose()
$sidecarIdentifier = "codexpanel-tauri-node-sidecar-$payloadHash"

npx --yes caxa `
  --input $payloadDir `
  --output $sidecarPath `
  --no-dedupe `
  --identifier $sidecarIdentifier `
  --uncompression-message "Preparing CodexPanel local service..." `
  -- "{{caxa}}/node_modules/.bin/node" "{{caxa}}/node-sidecar.js"

if (-not (Test-Path -LiteralPath $sidecarPath)) {
  throw "Sidecar build did not create expected executable: $sidecarPath"
}

$file = Get-Item -LiteralPath $sidecarPath
Write-Host "Built Tauri sidecar: $($file.FullName)"
Write-Host ("Size: {0:N1} MB" -f ($file.Length / 1MB))
