param(
    [string]$Configuration = "Release",
    [string]$Runtime = "win-x64",
    [string]$OutputDir = "..\\artifacts\\msix",
    [string]$IdentityName = "com.aski.nativeclient",
    [string]$Publisher = "CN=ASKI Flow Dev",
    [string]$PublisherDisplayName = "ASKI Flow Dev",
    [string]$DisplayName = "ASKI Flow Native Client",
    [string]$Description = "ASKI Flow native desktop client host.",
    [string]$Version = "1.0.0.0",
    [string]$AppId = "AskiNativeClient",
    [string]$ExecutableName = "Aski.NativeClient.Host.exe",
    [string]$MinWindowsVersion = "10.0.19041.0",
    [string]$MaxWindowsVersion = "10.0.22631.0",
    [string]$CertificatePath = "",
    [string]$CertificatePassword = "",
    [switch]$SelfContained
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-DotnetPath {
    $command = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    $fallback = "C:\\Program Files\\dotnet\\dotnet.exe"
    if (Test-Path $fallback) {
        return $fallback
    }

    throw "dotnet executable not found. Ensure .NET SDK 8+ is installed."
}

function Get-WindowsSdkToolPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ToolName
    )

    $sdkBinRoot = "C:\\Program Files (x86)\\Windows Kits\\10\\bin"
    if (-not (Test-Path $sdkBinRoot)) {
        throw "Windows SDK 10 bin folder not found at: $sdkBinRoot"
    }

    $versionDirs =
        Get-ChildItem -Path $sdkBinRoot -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
        Sort-Object { [Version]$_.Name } -Descending

    foreach ($versionDir in $versionDirs) {
        $candidate = Join-Path $versionDir.FullName "x64\\$ToolName"
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    $flatCandidate = Join-Path $sdkBinRoot "x64\\$ToolName"
    if (Test-Path $flatCandidate) {
        return $flatCandidate
    }

    throw "Unable to locate $ToolName in Windows SDK bin directory."
}

function New-PlaceholderLogo {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [int]$Width,
        [Parameter(Mandatory = $true)]
        [int]$Height,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    $bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 255, 255, 255), [Math]::Max(2, [int]($Width / 40)))
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $stringFormat = New-Object System.Drawing.StringFormat
    $fontSize = [Math]::Max(8, [int](($Width + $Height) / 28))
    $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold)

    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear([System.Drawing.Color]::FromArgb(17, 89, 146))
        $graphics.DrawRectangle($pen, 1, 1, $Width - 2, $Height - 2)
        $stringFormat.Alignment = [System.Drawing.StringAlignment]::Center
        $stringFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
        $graphics.DrawString(
            $Label,
            $font,
            $brush,
            [System.Drawing.RectangleF]::new(0, 0, [float]$Width, [float]$Height),
            $stringFormat
        )
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $font.Dispose()
        $stringFormat.Dispose()
        $brush.Dispose()
        $pen.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    throw "Version must follow Appx format: major.minor.build.revision (example: 1.0.0.0)"
}

Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Join-Path $scriptDir ".."
$hostProjectPath = Join-Path $rootDir "Aski.NativeClient.Host\\Aski.NativeClient.Host.csproj"
$manifestTemplatePath = Join-Path $rootDir "packaging\\msix\\AppxManifest.template.xml"

if (-not (Test-Path $hostProjectPath)) {
    throw "Host project not found: $hostProjectPath"
}
if (-not (Test-Path $manifestTemplatePath)) {
    throw "Manifest template not found: $manifestTemplatePath"
}

$dotnetPath = Get-DotnetPath
$makeAppxPath = Get-WindowsSdkToolPath -ToolName "makeappx.exe"

$resolvedOutputDir = [System.IO.Path]::GetFullPath((Join-Path $scriptDir $OutputDir))
$publishDir = Join-Path $resolvedOutputDir "_publish"
$layoutDir = Join-Path $resolvedOutputDir "_layout"
$assetsDir = Join-Path $layoutDir "Assets"
$msixFileName = "{0}_{1}_{2}.msix" -f $IdentityName, $Version, $Runtime
$msixFileName = $msixFileName -replace '[^A-Za-z0-9._-]', '_'
$msixPath = Join-Path $resolvedOutputDir $msixFileName

if (Test-Path $publishDir) {
    Remove-Item -Path $publishDir -Recurse -Force
}
if (Test-Path $layoutDir) {
    Remove-Item -Path $layoutDir -Recurse -Force
}

New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null
New-Item -ItemType Directory -Path $publishDir -Force | Out-Null
New-Item -ItemType Directory -Path $layoutDir -Force | Out-Null
New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null

$selfContainedValue = if ($SelfContained) { "true" } else { "false" }

Write-Host "[build-msix] dotnet=$dotnetPath"
Write-Host "[build-msix] makeappx=$makeAppxPath"
Write-Host "[build-msix] configuration=$Configuration runtime=$Runtime self-contained=$selfContainedValue"
Write-Host "[build-msix] output=$resolvedOutputDir"

& $dotnetPath publish $hostProjectPath `
    -c $Configuration `
    -r $Runtime `
    --self-contained $selfContainedValue `
    -o $publishDir

if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
}

Copy-Item -Path (Join-Path $publishDir "*") -Destination $layoutDir -Recurse -Force

New-PlaceholderLogo -Path (Join-Path $assetsDir "Square44x44Logo.png") -Width 44 -Height 44 -Label "A"
New-PlaceholderLogo -Path (Join-Path $assetsDir "Square150x150Logo.png") -Width 150 -Height 150 -Label "ASKI"
New-PlaceholderLogo -Path (Join-Path $assetsDir "Wide310x150Logo.png") -Width 310 -Height 150 -Label "ASKI FLOW"
New-PlaceholderLogo -Path (Join-Path $assetsDir "LargeTile.png") -Width 310 -Height 310 -Label "ASKI"
New-PlaceholderLogo -Path (Join-Path $assetsDir "SplashScreen.png") -Width 620 -Height 300 -Label "ASKI FLOW"
New-PlaceholderLogo -Path (Join-Path $assetsDir "StoreLogo.png") -Width 50 -Height 50 -Label "A"

$manifestContent = Get-Content -Path $manifestTemplatePath -Raw
$manifestReplacements = @{
    "{{IDENTITY_NAME}}" = $IdentityName
    "{{PUBLISHER}}" = $Publisher
    "{{VERSION}}" = $Version
    "{{DISPLAY_NAME}}" = $DisplayName
    "{{PUBLISHER_DISPLAY_NAME}}" = $PublisherDisplayName
    "{{DESCRIPTION}}" = $Description
    "{{APP_ID}}" = $AppId
    "{{EXECUTABLE_NAME}}" = $ExecutableName
    "{{MIN_WINDOWS_VERSION}}" = $MinWindowsVersion
    "{{MAX_WINDOWS_VERSION}}" = $MaxWindowsVersion
}
foreach ($entry in $manifestReplacements.GetEnumerator()) {
    $manifestContent = $manifestContent.Replace($entry.Key, $entry.Value)
}

$manifestPath = Join-Path $layoutDir "AppxManifest.xml"
Set-Content -Path $manifestPath -Value $manifestContent -Encoding utf8

if (-not (Test-Path (Join-Path $layoutDir $ExecutableName))) {
    throw "Executable '$ExecutableName' not found in package layout. Verify host publish output."
}

if (Test-Path $msixPath) {
    Remove-Item -Path $msixPath -Force
}

& $makeAppxPath pack /d $layoutDir /p $msixPath /o
if ($LASTEXITCODE -ne 0) {
    throw "makeappx pack failed with exit code $LASTEXITCODE"
}

if (-not [string]::IsNullOrWhiteSpace($CertificatePath)) {
    if (-not (Test-Path $CertificatePath)) {
        throw "Certificate file not found: $CertificatePath"
    }

    $signToolPath = Get-WindowsSdkToolPath -ToolName "signtool.exe"

    $signArgs = @(
        "sign",
        "/fd", "SHA256",
        "/f", $CertificatePath
    )
    if (-not [string]::IsNullOrWhiteSpace($CertificatePassword)) {
        $signArgs += @("/p", $CertificatePassword)
    }
    $signArgs += $msixPath

    & $signToolPath @signArgs
    if ($LASTEXITCODE -ne 0) {
        throw "signtool sign failed with exit code $LASTEXITCODE"
    }

    Write-Host "[build-msix] package signed."
}
else {
    Write-Host "[build-msix] package is unsigned. Sign it before installation on standard Windows policy."
}

$hash = (Get-FileHash -Path $msixPath -Algorithm SHA256).Hash
Write-Host "[build-msix] output package: $msixPath"
Write-Host "[build-msix] sha256: $hash"
