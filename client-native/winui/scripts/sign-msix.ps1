param(
    [string]$MsixPath = "",
    [string]$CertificatePath = "",
    [string]$CertificatePassword = "",
    [string]$TimestampUrl = "",
    [string]$HashAlgorithm = "SHA256",
    [switch]$AllowInsecureDevPassword,
    [switch]$AllowWeakPassword
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-StrongPassword {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    if ($Value.Length -lt 12) {
        return $false
    }

    $classes = 0
    if ($Value -cmatch '[A-Z]') { $classes++ }
    if ($Value -cmatch '[a-z]') { $classes++ }
    if ($Value -match '[0-9]') { $classes++ }
    if ($Value -match '[^A-Za-z0-9]') { $classes++ }

    return $classes -ge 3
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
    $CertificatePassword = ("" + [Environment]::GetEnvironmentVariable("ASKI_MSIX_CERT_PASSWORD")).Trim()
}

if (-not (Test-Path $MsixPath)) {
    throw "MSIX file not found: $MsixPath"
}
if (-not (Test-Path $CertificatePath)) {
    throw "Certificate file not found: $CertificatePath"
}

if ([string]::IsNullOrWhiteSpace($CertificatePassword)) {
    throw "Certificate password is required. Pass -CertificatePassword or set ASKI_MSIX_CERT_PASSWORD."
}

if (-not $AllowInsecureDevPassword -and $CertificatePassword -eq "change-me-dev-password") {
    throw "Insecure default certificate password is blocked. Use a strong password or pass -AllowInsecureDevPassword."
}

if (-not $AllowWeakPassword -and -not (Test-StrongPassword -Value $CertificatePassword)) {
    throw "Weak certificate password. Use at least 12 chars with mixed upper/lower/digit/symbol (or pass -AllowWeakPassword)."
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

$signature = Get-AuthenticodeSignature -FilePath $MsixPath
if ($signature.Status -eq "NotSigned") {
    throw "MSIX is still unsigned after sign step."
}

Write-Host "[sign-msix] signature-status=$($signature.Status)"
Write-Host "[sign-msix] completed."
