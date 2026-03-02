param(
    [switch]$InstallDeps
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$backendDir = Join-Path $PSScriptRoot "backend"
$didPushLocation = $false

try {
    Push-Location $backendDir
    $didPushLocation = $true

    $venvPython = Join-Path $backendDir ".venv\\Scripts\\python.exe"

    if (-not (Test-Path $venvPython)) {
        py -3.11 -m venv .venv
    }

    if ($InstallDeps) {
        & $venvPython -m pip install --upgrade pip
        & $venvPython -m pip install -r requirements.txt
    }

    & $venvPython main.py
}
finally {
    if ($didPushLocation) {
        Pop-Location
    }
}
