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

$summary = [ordered]@{
    TimestampUtc       = (Get-Date).ToUniversalTime().ToString("O")
    PackageInstalled   = $false
    PackageFullName    = ""
    PackageFamilyName  = ""
    Aumid              = ""
    NetworkReachable   = $false
    Launched           = $false
    ProcessDetected    = $false
    Result             = "FAILED"
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
