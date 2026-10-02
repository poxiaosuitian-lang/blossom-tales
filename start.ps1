$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$appPort = if ($env:PORT) { [int]$env:PORT } else { 5173 }
$appUrl = "http://localhost:$appPort"
$dataPath = if ($env:DESTINY_DATA_DIR) { $env:DESTINY_DATA_DIR } else { Join-Path $appRoot 'data' }
function Test-AppReady {
    try {
        $health = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2
        return $health.service -eq 'university-system' -and $health.ready
    } catch { return $false }
}
if (Test-AppReady) {
    Start-Process $appUrl
    exit 0
}
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } elseif (Test-Path -LiteralPath 'E:\JS\node.exe') { 'E:\JS\node.exe' } else { $null }
if (-not $nodePath) { throw 'Node.js 24 or newer is required. Install Node.js, then run this launcher again.' }
& $nodePath --no-warnings -e "require('node:sqlite')"
if ($LASTEXITCODE -ne 0) { throw 'This Node.js version does not support SQLite. Please use Node.js 24 or newer.' }
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
$serverFile = Join-Path $appRoot 'server.cjs'
$appProcess = Start-Process -FilePath $nodePath -ArgumentList @('--no-warnings', ('"' + $serverFile + '"')) -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'server.log') -RedirectStandardError (Join-Path $dataPath 'server-error.log') -PassThru
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (Test-AppReady) {
        Set-Content -LiteralPath (Join-Path $dataPath 'server.pid') -Value $appProcess.Id -Encoding ascii
        Start-Process $appUrl
        exit 0
    }
    if ($appProcess.HasExited) { throw "The server could not start. Check $dataPath\server-error.log (port $appPort may be in use)." }
    Start-Sleep -Milliseconds 300
}
throw "The server did not become ready. Check $dataPath\server-error.log."
