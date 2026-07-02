param(
  [string]$BaseUrl = "http://127.0.0.1:8787",
  [string]$Token = $env:MOBILE_TYPER_TOKEN,
  [switch]$AllowFailures
)

$ErrorActionPreference = "Stop"

if (-not $Token) {
  throw "Missing token. Pass -Token or set MOBILE_TYPER_TOKEN."
}

$base = $BaseUrl.TrimEnd("/")
$headers = @{ "x-codex-token" = $Token }

$checks = @(
  @{ Name = "control page"; Method = "GET"; Path = "/control.html" },
  @{ Name = "health"; Method = "GET"; Path = "/codex/health" },
  @{ Name = "config"; Method = "GET"; Path = "/codex/config" },
  @{ Name = "control status"; Method = "GET"; Path = "/codex/control-status" },
  @{ Name = "service check"; Method = "GET"; Path = "/codex/service-check" },
  @{ Name = "threads"; Method = "GET"; Path = "/codex/threads?limit=1" },
  @{ Name = "codex status"; Method = "GET"; Path = "/codex/status" },
  @{ Name = "keep awake"; Method = "GET"; Path = "/codex/keep-awake" }
)

$failed = 0
foreach ($check in $checks) {
  $join = if ($check.Path.Contains("?")) { "&" } else { "?" }
  $url = "{0}{1}{2}token={3}" -f $base, $check.Path, $join, [uri]::EscapeDataString($Token)
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method $check.Method -Uri $url -Headers $headers -TimeoutSec 20
    $ok = $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    if (-not $ok) { $failed += 1 }
    "{0,-16} {1,3} {2}" -f $check.Name, $response.StatusCode, $url
  } catch {
    $failed += 1
    "{0,-16} ERR {1}" -f $check.Name, $_.Exception.Message
  }
}

if ($failed -gt 0 -and -not $AllowFailures) {
  throw "$failed service check(s) failed."
}

if ($failed -eq 0) {
  Write-Host "All Codex service checks passed."
} else {
  Write-Host "$failed service check(s) failed."
}
