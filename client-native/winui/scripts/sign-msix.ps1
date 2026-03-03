param(
    [string]$MsixPath = "",
    [string]$CertificatePath = "",
    [string]$CertificatePassword = "",
    [string]$TimestampUrl = "",
    [string]$HashAlgorithm = "SHA256"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

    throw "Unable to locate $ToolName in Windows SDK bin directory."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ([string]::IsNullOrWhiteSpace($MsixPath)) {
    $defaultMsixDir = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\\artifacts\\msix"))
    $latest = Get-ChildItem -Path $defaultMsixDir -Filter "*.msix" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($null -eq $latest) {
        throw "No .msix file found in $defaultMsixDir. Pass -MsixPath explicitly."
    }
    $MsixPath = $latest.FullName
}

if ([string]::IsNullOrWhiteSpace($CertificatePath)) {
    $CertificatePath = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\\artifacts\\cert\\aski-native-dev.pfx"))
}
if ([string]::IsNullOrWhiteSpace($CertificatePassword)) {
    $CertificatePassword = "change-me-dev-password"
}

if (-not (Test-Path $MsixPath)) {
    throw "MSIX file not found: $MsixPath"
}
if (-not (Test-Path $CertificatePath)) {
    throw "Certificate file not found: $CertificatePath"
}

$signToolPath = Get-WindowsSdkToolPath -ToolName "signtool.exe"

$args = @(
    "sign",
    "/fd", $HashAlgorithm,
    "/f", $CertificatePath,
    "/p", $CertificatePassword
)

if (-not [string]::IsNullOrWhiteSpace($TimestampUrl)) {
    $args += @("/tr", $TimestampUrl, "/td", $HashAlgorithm)
}

$args += $MsixPath

Write-Host "[sign-msix] signtool=$signToolPath"
Write-Host "[sign-msix] msix=$MsixPath"
Write-Host "[sign-msix] certificate=$CertificatePath"

& $signToolPath @args
if ($LASTEXITCODE -ne 0) {
    throw "signtool sign failed with exit code $LASTEXITCODE"
}

Write-Host "[sign-msix] completed."
