param(
    [string]$OutputZip = "ui-checkpoint.zip"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$uiPath = Join-Path $repoRoot "packages\ui"
$stagingRoot = Join-Path $repoRoot ".tmp\ui-checkpoint"
$stagingUi = Join-Path $stagingRoot "ui"
$zipPath = Join-Path $repoRoot $OutputZip

if (!(Test-Path $uiPath)) {
    throw "UI folder not found: $uiPath"
}

if (Test-Path $stagingRoot) {
    Remove-Item -Recurse -Force $stagingRoot
}
New-Item -ItemType Directory -Path $stagingUi | Out-Null

robocopy $uiPath $stagingUi /E /NFL /NDL /NJH /NJS /NP /XD node_modules build dist coverage .vite | Out-Null
if ($LASTEXITCODE -ge 8) {
    throw "Failed while preparing UI staging folder (robocopy exit code: $LASTEXITCODE)."
}

if (Test-Path $zipPath) {
    Remove-Item -Force $zipPath
}

Compress-Archive -Path (Join-Path $stagingUi "*") -DestinationPath $zipPath -Force
Remove-Item -Recurse -Force $stagingRoot

Write-Host "Created $zipPath"
