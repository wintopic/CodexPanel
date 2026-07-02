param(
  [int]$Port = 8787,
  [string]$RelayUrl = "https://codexpanel.pages.dev",
  [string]$DeviceId = "",
  [string]$RemoteKey = "",
  [string]$Token = "",
  [int]$RelayConcurrency = 1,
  [int]$RelayPollTimeoutMs = 45000,
  [int]$RelayRequestTimeoutMs = 75000
)

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $projectDir

$savedControlConfig = $null
$stateFile = Join-Path $HOME ".codex\state.json"
if (Test-Path -LiteralPath $stateFile) {
  try {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $savedControlConfig = $state.controlConfig
  } catch {
    $savedControlConfig = $null
  }
}

if ($savedControlConfig) {
  if (-not $PSBoundParameters.ContainsKey("Port") -and $savedControlConfig.port) {
    $Port = [int]$savedControlConfig.port
  }
  if (-not $PSBoundParameters.ContainsKey("RelayUrl") -and $savedControlConfig.relayUrl) {
    $RelayUrl = [string]$savedControlConfig.relayUrl
  }
  if (-not $PSBoundParameters.ContainsKey("DeviceId") -and $savedControlConfig.deviceId) {
    $DeviceId = [string]$savedControlConfig.deviceId
  }
  if (-not $PSBoundParameters.ContainsKey("RemoteKey") -and $savedControlConfig.remoteKey) {
    $RemoteKey = [string]$savedControlConfig.remoteKey
  }
}

if (-not $DeviceId) {
  $DeviceId = ($env:COMPUTERNAME -replace '[^a-zA-Z0-9._-]+', '-').ToLowerInvariant().Trim('-')
  if (-not $DeviceId) { $DeviceId = "windows-pc" }
}

if (-not $Token -and $env:MOBILE_TYPER_TOKEN) {
  $Token = $env:MOBILE_TYPER_TOKEN
}

if (-not $RemoteKey -and $env:CODEX_REMOTE_KEY) {
  $RemoteKey = $env:CODEX_REMOTE_KEY
}

$env:PORT = [string]$Port
$env:CODEX_RELAY_URL = $RelayUrl.TrimEnd("/")
$env:CODEX_RELAY_DEVICE_ID = $DeviceId
$env:CODEX_RELAY_CONCURRENCY = [string]$RelayConcurrency
$env:CODEX_RELAY_POLL_TIMEOUT_MS = [string]$RelayPollTimeoutMs
$env:CODEX_RELAY_REQUEST_TIMEOUT_MS = [string]$RelayRequestTimeoutMs
if ($Token) {
  $env:MOBILE_TYPER_TOKEN = $Token
}
if ($RemoteKey) {
  $env:CODEX_REMOTE_KEY = $RemoteKey
}

Write-Host "Starting CodexPanel local service..."
Write-Host "Project: $projectDir"
Write-Host "Local:   http://localhost:$Port/"
Write-Host "Control: http://localhost:$Port/control.html"
Write-Host "Remote:  $($env:CODEX_RELAY_URL)/remote/$DeviceId/"
Write-Host "Remote Control: $($env:CODEX_RELAY_URL)/remote/$DeviceId/control.html"

node server.js
