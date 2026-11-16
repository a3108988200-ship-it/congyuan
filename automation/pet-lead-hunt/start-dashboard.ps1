$ErrorActionPreference = "Stop"
$port = if ($env:PET_LEAD_HUNT_PORT) { [int]$env:PET_LEAD_HUNT_PORT } else { 4179 }
$url = "http://127.0.0.1:$port"

try {
    $health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2
    if ($health.ok) {
        Write-Host "Pet B2B Lead Hunt is already running: $url"
        exit 0
    }
} catch { }

$node = Get-Command node.exe -ErrorAction Stop
$serverPath = Join-Path $PSScriptRoot "server.mjs"
$dataPath = Join-Path $PSScriptRoot "data"
New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
$stdoutPath = Join-Path $dataPath "server.stdout.log"
$stderrPath = Join-Path $dataPath "server.stderr.log"
$process = Start-Process -FilePath $node.Source `
    -ArgumentList @($serverPath) `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
        $health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2
        if ($health.ok) {
            Set-Content -LiteralPath (Join-Path $dataPath "server.pid") -Value $process.Id -Encoding ascii
            Write-Host "Pet B2B Lead Hunt is ready: $url"
            Write-Host "Logs: $stdoutPath"
            exit 0
        }
    } catch { }
    if ($process.HasExited) { break }
}

$errorTail = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Tail 20 } else { @() }
throw "Dashboard did not start. $($errorTail -join [Environment]::NewLine)"
