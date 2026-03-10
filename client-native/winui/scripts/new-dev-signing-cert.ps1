param(
    [string]$Subject = "CN=ASKI Flow Dev",
    [string]$FriendlyName = "ASKI Flow Native Client Dev Signing",
    [int]$ValidYears = 2,
    [string]$OutputDir = "..\\artifacts\\cert",
    [string]$CerFileName = "aski-native-dev.cer",
    [string]$PfxFileName = "aski-native-dev.pfx",
    [string]$PfxPassword = "",
    [switch]$AllowWeakPassword,
    [switch]$IncludePasswordInReadme
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

if ([string]::IsNullOrWhiteSpace($PfxPassword)) {
    $PfxPassword = ("" + [Environment]::GetEnvironmentVariable("ASKI_MSIX_CERT_PASSWORD")).Trim()
}

if ([string]::IsNullOrWhiteSpace($PfxPassword)) {
    throw "PFX password is required. Pass -PfxPassword or set ASKI_MSIX_CERT_PASSWORD."
}

if (-not $AllowWeakPassword) {
    if ($PfxPassword -eq "change-me-dev-password") {
        throw "Insecure default password is blocked. Use a strong password."
    }

    if (-not (Test-StrongPassword -Value $PfxPassword)) {
        throw "Weak PFX password. Use at least 12 chars with mixed upper/lower/digit/symbol (or pass -AllowWeakPassword)."
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$resolvedOutputDir = [System.IO.Path]::GetFullPath((Join-Path $scriptDir $OutputDir))
New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null

$cerPath = Join-Path $resolvedOutputDir $CerFileName
$pfxPath = Join-Path $resolvedOutputDir $PfxFileName

if (Test-Path $cerPath) {
    Remove-Item -Path $cerPath -Force
}
if (Test-Path $pfxPath) {
    Remove-Item -Path $pfxPath -Force
}

$notAfter = (Get-Date).AddYears($ValidYears)
$ekuCodeSigning = "2.5.29.37={text}1.3.6.1.5.5.7.3.3"

$cert = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $Subject `
    -FriendlyName $FriendlyName `
    -CertStoreLocation "Cert:\\CurrentUser\\My" `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -NotAfter $notAfter `
    -TextExtension $ekuCodeSigning

if ($null -eq $cert) {
    throw "Failed to create self-signed certificate."
}

Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null

$securePassword = ConvertTo-SecureString -String $PfxPassword -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword | Out-Null

$passwordNotePath = Join-Path $resolvedOutputDir "README.txt"
if ($IncludePasswordInReadme) {
    Set-Content -Path $passwordNotePath -Encoding utf8 -Value @(
        "Development signing certificate generated for ASKI native pilot.",
        "Subject: $Subject",
        "Thumbprint: $($cert.Thumbprint)",
        "ValidUntil: $($cert.NotAfter.ToString('O'))",
        "PFX: $pfxPath",
        "CER: $cerPath",
        "",
        "PFX password used:",
        $PfxPassword,
        "",
        "Rotate this password before non-dev distribution."
    )
}
else {
    Set-Content -Path $passwordNotePath -Encoding utf8 -Value @(
    "Development signing certificate generated for ASKI native pilot.",
    "Subject: $Subject",
    "Thumbprint: $($cert.Thumbprint)",
    "ValidUntil: $($cert.NotAfter.ToString('O'))",
    "PFX: $pfxPath",
    "CER: $cerPath",
    "",
        "PFX password is not written to disk by default.",
        "Provide -IncludePasswordInReadme only for temporary local workflows."
    )
}

Write-Host "[new-dev-signing-cert] subject=$Subject"
Write-Host "[new-dev-signing-cert] thumbprint=$($cert.Thumbprint)"
Write-Host "[new-dev-signing-cert] cer=$cerPath"
Write-Host "[new-dev-signing-cert] pfx=$pfxPath"
Write-Host "[new-dev-signing-cert] password-note=$passwordNotePath"
