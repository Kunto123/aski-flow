param(
    [switch]$InstallDeps,
    [ValidateSet("Desktop", "Web")]
    [string]$Mode = "Desktop",
    [int]$Port = 5173,
    [string]$ServerHost = "127.0.0.1",
    [int]$ServerPort = 8000,
    [switch]$UseHttps
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$uiDir = Join-Path $PSScriptRoot "ui"
Set-Location $uiDir

if ($InstallDeps -or -not (Test-Path (Join-Path $uiDir "node_modules"))) {
    npm install
}

$protocolFlag = if ($UseHttps) { "true" } else { "false" }
$envLocalPath = Join-Path $uiDir ".env.local"

Write-Host "[run-client] Mode=$Mode Server=${ServerHost}:$ServerPort HTTPS=$protocolFlag"

$envContent = @(
    "VITE_APP_WS_HOST=$ServerHost"
    "VITE_APP_WS_PORT=$ServerPort"
    "VITE_APP_API_REST_PORT=$ServerPort"
    "VITE_APP_USE_HTTPS=$protocolFlag"
)

Set-Content -Path $envLocalPath -Value ($envContent -join "`n") -Encoding ascii
$env:ASKI_SERVER_HOST = $ServerHost
$env:ASKI_SERVER_PORT = "$ServerPort"
$env:ASKI_SERVER_USE_HTTPS = $protocolFlag

if ($Mode -eq "Web") {
    Write-Host "[run-client] Starting web debug client at http://127.0.0.1:$Port"
    npm run start -- --host 127.0.0.1 --port $Port
}
else {
    $buildIndex = Join-Path $uiDir "build\\index.html"
    $shouldBuild = $InstallDeps -or -not (Test-Path $buildIndex)

    if (-not $shouldBuild) {
        $buildLastWrite = (Get-Item $buildIndex).LastWriteTimeUtc
        $watchPaths = @(
            (Join-Path $uiDir "index.html"),
            (Join-Path $uiDir "vite.config.ts"),
            (Join-Path $uiDir "package.json"),
            (Join-Path $uiDir "src"),
            (Join-Path $uiDir "public")
        )

        foreach ($path in $watchPaths) {
            if (-not (Test-Path $path)) {
                continue
            }

            if ((Get-Item $path).PSIsContainer) {
                $latestSourceChange = Get-ChildItem -Path $path -Recurse -File |
                    Sort-Object LastWriteTimeUtc -Descending |
                    Select-Object -First 1

                if ($null -ne $latestSourceChange -and $latestSourceChange.LastWriteTimeUtc -gt $buildLastWrite) {
                    $shouldBuild = $true
                    break
                }
            }
            else {
                if ((Get-Item $path).LastWriteTimeUtc -gt $buildLastWrite) {
                    $shouldBuild = $true
                    break
                }
            }
        }
    }

    if ($shouldBuild) {
        Write-Host "[run-client] Building desktop UI bundle..."
        npm run build
    }

    if (Test-Path Env:ELECTRON_RUN_AS_NODE) {
        Remove-Item Env:ELECTRON_RUN_AS_NODE
    }

    Write-Host "[run-client] Launching desktop client window..."
    npm run desktop:run
}
