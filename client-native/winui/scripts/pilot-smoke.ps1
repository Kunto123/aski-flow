param(
    [string]$PackageIdentityName = "com.aski.nativeclient",
    [string]$AppId = "AskiNativeClient",
    [string]$ProcessName = "Aski.NativeClient.Host",
    [string]$ServerHost = "127.0.0.1",
    [int]$ServerPort = 8000,
    [switch]$UseHttps,
    [switch]$SkipNetworkCheck,
    [switch]$SkipPackageCheck,
    [switch]$SkipLaunch,
    [switch]$AutoStopProcess,
    [int]$LaunchWaitSeconds = 15,
    [switch]$DryRun,
    [switch]$RuntimeOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$webView2HelperPath = Join-Path $scriptDir "shared\\webview2-runtime.ps1"
if (-not (Test-Path $webView2HelperPath)) {
    throw "Missing helper script: $webView2HelperPath"
}
. $webView2HelperPath

if ($RuntimeOnly) {
    $SkipNetworkCheck = $true
    $SkipPackageCheck = $true
    $SkipLaunch = $true
}

$webView2 = Get-WebView2RuntimeInfo
$effectiveSkipLaunch = [bool]$SkipLaunch

$summary = [ordered]@{
    TimestampUtc            = (Get-Date).ToUniversalTime().ToString("O")
    RuntimeOnly             = [bool]$RuntimeOnly
    WebView2RuntimeInstalled = [bool]$webView2.Installed
    WebView2RuntimeVersion   = $webView2.Version
    WebView2RuntimeSource    = $webView2.Source
    LaunchWaitSeconds        = $LaunchWaitSeconds
    PackageCheckSkipped     = [bool]$SkipPackageCheck
    LaunchCheckSkipped      = $false
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

if ($SkipPackageCheck -and -not $summary.PackageInstalled -and -not $effectiveSkipLaunch) {
    Write-Host "[pilot-smoke] package check skipped and package not installed; launch step auto-skipped."
    $effectiveSkipLaunch = $true
}
$summary.LaunchCheckSkipped = [bool]$effectiveSkipLaunch

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
if (-not $effectiveSkipLaunch) {
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

if ($launchSucceeded -and -not $effectiveSkipLaunch) {
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
elseif ($effectiveSkipLaunch) {
    $summary.ProcessDetected = $true
}

$errors = @()
if (-not $summary.WebView2RuntimeInstalled) {
    $errors += "Microsoft Edge WebView2 Runtime is not installed."
}
if (-not $summary.PackageInstalled -and -not $SkipPackageCheck -and -not $effectiveSkipLaunch) {
    $errors += "Package not installed."
}
if (-not $summary.NetworkReachable) {
    $errors += "Backend unreachable: $ServerHost`:$ServerPort"
}
if (-not $summary.Launched) {
    $errors += "Launch step failed."
}
if (-not $summary.ProcessDetected) {
    $errors += "Host process not detected within $LaunchWaitSeconds second(s): $ProcessName"
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
