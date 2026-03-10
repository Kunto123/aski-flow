param(
    [string]$ServerHost = "127.0.0.1",
    [int]$ServerPort = 8000,
    [switch]$UseHttps,
    [int]$TimeoutSeconds = 20,
    [int]$IntervalSeconds = 1,
    [switch]$SkipTcpCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($TimeoutSeconds -lt 1) {
    throw "TimeoutSeconds must be >= 1."
}

if ($IntervalSeconds -lt 1) {
    throw "IntervalSeconds must be >= 1."
}

$scheme = if ($UseHttps) { "https" } else { "http" }
$baseUrl = "{0}://{1}:{2}" -f $scheme, $ServerHost, $ServerPort
$healthUrl = "$baseUrl/health"

$summary = [ordered]@{
    TimestampUtc    = (Get-Date).ToUniversalTime().ToString("O")
    BaseUrl         = $baseUrl
    HealthUrl       = $healthUrl
    TimeoutSeconds  = $TimeoutSeconds
    SkipTcpCheck    = [bool]$SkipTcpCheck
    TcpReachable    = $false
    HealthOk        = $false
    HealthStatus    = ""
    HealthBody      = ""
    LastError       = ""
}

if (-not $SkipTcpCheck) {
    try {
        $tcp = Test-NetConnection -ComputerName $ServerHost -Port $ServerPort -WarningAction SilentlyContinue
        $summary.TcpReachable = [bool]$tcp.TcpTestSucceeded
    }
    catch {
        $summary.TcpReachable = $false
        $summary.LastError = $_.Exception.Message
    }
}
else {
    $summary.TcpReachable = $true
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec ([Math]::Min(5, $TimeoutSeconds))
        $summary.HealthStatus = [string]$response.StatusCode
        $summary.HealthBody = ("" + $response.Content).Trim()
        if ($response.StatusCode -eq 200) {
            $summary.HealthOk = $true
            break
        }
    }
    catch {
        $summary.LastError = $_.Exception.Message
    }

    Start-Sleep -Seconds $IntervalSeconds
}

Write-Host "[backend-health] summary"
$summary.GetEnumerator() | ForEach-Object {
    Write-Host ("- {0}: {1}" -f $_.Key, $_.Value)
}

$errors = @()
if (-not $SkipTcpCheck -and -not $summary.TcpReachable) {
    $errors += "TCP port unreachable: $ServerHost`:$ServerPort"
}

if (-not $summary.HealthOk) {
    if (-not [string]::IsNullOrWhiteSpace($summary.HealthStatus)) {
        $errors += "Health check did not return HTTP 200. LastStatus=$($summary.HealthStatus)"
    }
    elseif (-not [string]::IsNullOrWhiteSpace($summary.LastError)) {
        $errors += "Health check failed: $($summary.LastError)"
    }
    else {
        $errors += "Health check failed without status."
    }
}

if ($errors.Count -gt 0) {
    Write-Host "[backend-health] result=FAILED"
    foreach ($err in $errors) {
        Write-Host "[backend-health] error=$err"
    }
    exit 1
}

Write-Host "[backend-health] result=PASS"
