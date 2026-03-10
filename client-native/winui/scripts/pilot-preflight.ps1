param(
    [string]$ServerHost = "127.0.0.1",
    [int]$ServerPort = 8000,
    [switch]$UseHttps,
    [string]$MsixPath = "",
    [string]$PackageIdentityName = "com.aski.nativeclient",
    [switch]$SkipNetworkCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-WebView2RuntimeInfo {
    $result = [ordered]@{
        Installed = $false
        Version   = ""
        Source    = ""
    }

    $roots = @()
    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        $roots += (Join-Path ${env:ProgramFiles(x86)} "Microsoft\\EdgeWebView\\Application")
    }
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $roots += (Join-Path $env:ProgramFiles "Microsoft\\EdgeWebView\\Application")
    }

    foreach ($root in $roots) {
        if (-not (Test-Path $root)) {
            continue
        }

        $versionDirs = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending
        foreach ($dir in $versionDirs) {
            $exePath = Join-Path $dir.FullName "msedgewebview2.exe"
            if (Test-Path $exePath) {
                $result.Installed = $true
                $result.Version = $dir.Name
                $result.Source = $exePath
                return $result
            }
        }
    }

    $runtimeGuid = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    $registryCandidates = @(
        "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\$runtimeGuid",
        "HKLM:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\$runtimeGuid",
        "HKCU:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\$runtimeGuid"
    )

    foreach ($regPath in $registryCandidates) {
        if (-not (Test-Path $regPath)) {
            continue
        }

        try {
            $item = Get-ItemProperty -Path $regPath -ErrorAction Stop
            $version = ("" + $item.pv).Trim()
            if ([string]::IsNullOrWhiteSpace($version)) {
                $version = ("" + $item.PV).Trim()
            }
            if ([string]::IsNullOrWhiteSpace($version)) {
                $version = "unknown"
            }

            $result.Installed = $true
            $result.Version = $version
            $result.Source = $regPath
            return $result
        }
        catch {
            continue
        }
    }

    return $result
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($MsixPath)) {
    $defaultMsixDir = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\\artifacts\\msix"))
    $latest = Get-ChildItem -Path $defaultMsixDir -Filter "*.msix" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($null -ne $latest) {
        $MsixPath = $latest.FullName
    }
}

$scheme = if ($UseHttps) { "https" } else { "http" }
$baseUrl = "{0}://{1}:{2}" -f $scheme, $ServerHost, $ServerPort
$webView2 = Get-WebView2RuntimeInfo

$summary = [ordered]@{
    TimestampUtc          = (Get-Date).ToUniversalTime().ToString("O")
    BaseUrl               = $baseUrl
    WebView2RuntimeInstalled = [bool]$webView2.Installed
    WebView2RuntimeVersion   = $webView2.Version
    WebView2RuntimeSource    = $webView2.Source
    DnsResolved           = $false
    TcpReachable          = $false
    MsixPath              = $MsixPath
    MsixExists            = $false
    MsixSignatureStatus   = "NotChecked"
    InstalledPackageFound = $false
    InstalledPackage      = ""
}

if (-not $SkipNetworkCheck) {
    try {
        [System.Net.Dns]::GetHostEntry($ServerHost) | Out-Null
        $summary.DnsResolved = $true
    }
    catch {
        $summary.DnsResolved = $false
    }

    try {
        $tcp = Test-NetConnection -ComputerName $ServerHost -Port $ServerPort -WarningAction SilentlyContinue
        $summary.TcpReachable = [bool]$tcp.TcpTestSucceeded
    }
    catch {
        $summary.TcpReachable = $false
    }
}
else {
    $summary.DnsResolved = $true
    $summary.TcpReachable = $true
}

if (-not [string]::IsNullOrWhiteSpace($MsixPath) -and (Test-Path $MsixPath)) {
    $summary.MsixExists = $true
    try {
        $sig = Get-AuthenticodeSignature -FilePath $MsixPath
        $summary.MsixSignatureStatus = [string]$sig.Status
    }
    catch {
        $summary.MsixSignatureStatus = "Error"
    }
}

$pkg = Get-AppxPackage -Name $PackageIdentityName -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $pkg) {
    $summary.InstalledPackageFound = $true
    $summary.InstalledPackage = $pkg.PackageFullName
}

Write-Host "[pilot-preflight] summary"
$summary.GetEnumerator() | ForEach-Object {
    Write-Host ("- {0}: {1}" -f $_.Key, $_.Value)
}

$errors = @()
if (-not $SkipNetworkCheck) {
    if (-not $summary.DnsResolved) { $errors += "DNS resolution failed for $ServerHost" }
    if (-not $summary.TcpReachable) { $errors += "TCP port unreachable: $ServerHost`:$ServerPort" }
}
if (-not $summary.MsixExists) { $errors += "MSIX file not found." }
if ($summary.MsixSignatureStatus -eq "NotSigned") { $errors += "MSIX is not signed." }
if (-not $summary.WebView2RuntimeInstalled) { $errors += "Microsoft Edge WebView2 Runtime is not installed." }

if ($errors.Count -gt 0) {
    Write-Host "[pilot-preflight] result=FAILED"
    foreach ($err in $errors) {
        Write-Host "[pilot-preflight] error=$err"
    }
    exit 1
}

Write-Host "[pilot-preflight] result=PASS"
