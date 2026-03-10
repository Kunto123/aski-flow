param(
    [string]$PackageIdentityName = "com.aski.nativeclient",
    [string]$AppId = "AskiNativeClient",
    [string]$ProcessName = "Aski.NativeClient.Host",
    [string]$ServerHost = "127.0.0.1",
    [int]$ServerPort = 8000,
    [switch]$UseHttps,
    [switch]$SkipNetworkCheck,
    [switch]$SkipLaunch,
    [switch]$AutoStopProcess,
    [int]$LaunchWaitSeconds = 8,
    [switch]$DryRun
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

$webView2 = Get-WebView2RuntimeInfo

$summary = [ordered]@{
    TimestampUtc            = (Get-Date).ToUniversalTime().ToString("O")
    WebView2RuntimeInstalled = [bool]$webView2.Installed
    WebView2RuntimeVersion   = $webView2.Version
    WebView2RuntimeSource    = $webView2.Source
    PackageInstalled        = $false
    PackageFullName         = ""
    PackageFamilyName       = ""
    Aumid                   = ""
    NetworkReachable        = $false
    Launched                = $false
    ProcessDetected         = $false
    Result                  = "FAILED"
}

$package = Get-AppxPackage -Name $PackageIdentityName -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $package) {
    $summary.PackageInstalled = $true
    $summary.PackageFullName = $package.PackageFullName
    $summary.PackageFamilyName = $package.PackageFamilyName
}

$aumidFamilyName = if ($summary.PackageInstalled -and -not [string]::IsNullOrWhiteSpace($summary.PackageFamilyName)) {
    $summary.PackageFamilyName
}
else {
    $PackageIdentityName
}
$summary.Aumid = "{0}!{1}" -f $aumidFamilyName, $AppId

if (-not $SkipNetworkCheck) {
    try {
        $tcp = Test-NetConnection -ComputerName $ServerHost -Port $ServerPort -WarningAction SilentlyContinue
        $summary.NetworkReachable = [bool]$tcp.TcpTestSucceeded
    }
    catch {
        $summary.NetworkReachable = $false
    }
}
else {
    $summary.NetworkReachable = $true
}

$launchSucceeded = $false
if (-not $SkipLaunch) {
    if (-not $summary.PackageInstalled) {
        Write-Host "[pilot-smoke] package is not installed: $PackageIdentityName"
    }
    else {
        if ($DryRun) {
            Write-Host "[pilot-smoke] dry-run: would launch shell:AppsFolder\$($summary.Aumid)"
            $launchSucceeded = $true
        }
        else {
            try {
                Start-Process "explorer.exe" "shell:AppsFolder\$($summary.Aumid)"
                $launchSucceeded = $true
            }
            catch {
                $launchSucceeded = $false
            }
        }
    }
}
else {
    $launchSucceeded = $true
}
$summary.Launched = $launchSucceeded

if ($launchSucceeded -and -not $SkipLaunch) {
    if ($DryRun) {
        $summary.ProcessDetected = $true
    }
    else {
        Start-Sleep -Seconds $LaunchWaitSeconds
        $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
        $summary.ProcessDetected = $null -ne $proc

        if ($summary.ProcessDetected -and $AutoStopProcess) {
            Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Stop-Process -Force
        }
    }
}
elseif ($SkipLaunch) {
    $summary.ProcessDetected = $true
}

$errors = @()
if (-not $summary.WebView2RuntimeInstalled) {
    $errors += "Microsoft Edge WebView2 Runtime is not installed."
}
if (-not $summary.PackageInstalled -and -not $SkipLaunch) {
    $errors += "Package not installed."
}
if (-not $summary.NetworkReachable) {
    $errors += "Backend unreachable: $ServerHost`:$ServerPort"
}
if (-not $summary.Launched) {
    $errors += "Launch step failed."
}
if (-not $summary.ProcessDetected) {
    $errors += "Host process not detected: $ProcessName"
}

if ($errors.Count -eq 0) {
    $summary.Result = "PASS"
}

Write-Host "[pilot-smoke] summary"
$summary.GetEnumerator() | ForEach-Object {
    Write-Host ("- {0}: {1}" -f $_.Key, $_.Value)
}

if ($errors.Count -gt 0) {
    Write-Host "[pilot-smoke] result=FAILED"
    foreach ($err in $errors) {
        Write-Host "[pilot-smoke] error=$err"
    }
    exit 1
}

Write-Host "[pilot-smoke] result=PASS"
