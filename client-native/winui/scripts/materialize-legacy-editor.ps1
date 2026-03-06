param(
    [string]$Commit = "78fe166^",
    [string]$SourceDir = "client-native/winui/embedded/legacy-editor-src",
    [string]$BundleDir = "client-native/winui/embedded/flow-editor",
    [switch]$BuildBundle
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
    $scriptDir = $PSScriptRoot
    return (Resolve-Path (Join-Path $scriptDir "..\\..\\..")).Path
}

function Assert-Command($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $name"
    }
}

$repoRoot = Resolve-RepoRoot
$sourceAbs = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $SourceDir))
$bundleAbs = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $BundleDir))

Assert-Command git
Assert-Command tar

$tempRoot = Join-Path $env:TEMP ("aski-legacy-ui-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null

try {
    $archivePath = Join-Path $tempRoot "legacy-ui.tar"
    Write-Host "[materialize] commit=$Commit"
    git -C $repoRoot archive --format=tar $Commit client-side/ui -o $archivePath

    tar -xf $archivePath -C $tempRoot
    $extractedUi = Join-Path $tempRoot "client-side/ui"
    if (-not (Test-Path $extractedUi)) {
        throw "Failed to extract client-side/ui from commit $Commit"
    }

    if (Test-Path $sourceAbs) {
        Remove-Item -Path $sourceAbs -Recurse -Force
    }
    New-Item -ItemType Directory -Path $sourceAbs | Out-Null
    Copy-Item -Path (Join-Path $extractedUi "*") -Destination $sourceAbs -Recurse -Force
    Write-Host "[materialize] source_ready=$sourceAbs"

    if ($BuildBundle) {
        Assert-Command npm
        Push-Location $sourceAbs
        try {
            if (Test-Path "package-lock.json") {
                npm ci
            } else {
                npm install
            }
            npm run build
        } finally {
            Pop-Location
        }

        $distPath = Join-Path $sourceAbs "dist"
        if (-not (Test-Path $distPath)) {
            $distPath = Join-Path $sourceAbs "build"
        }
        if (-not (Test-Path $distPath)) {
            throw "Build completed but no output folder found (checked: dist, build)"
        }

        if (Test-Path $bundleAbs) {
            Remove-Item -Path $bundleAbs -Recurse -Force
        }
        New-Item -ItemType Directory -Path $bundleAbs | Out-Null
        Copy-Item -Path (Join-Path $distPath "*") -Destination $bundleAbs -Recurse -Force
        Write-Host "[materialize] bundle_ready=$bundleAbs"
    } else {
        Write-Host "[materialize] bundle not built (use -BuildBundle to produce dist)"
    }

    Write-Host "[materialize] done"
} finally {
    if (Test-Path $tempRoot) {
        Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
