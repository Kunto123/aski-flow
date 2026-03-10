param(
    [switch]$InstallDeps,
    [switch]$CheckOnly,
    [string]$ServerHost = "127.0.0.1",
    [int]$ServerPort = 8000,
    [switch]$UseHttps,
    [int]$HealthTimeoutSeconds = 20,
    [switch]$AllowRunningInstance,
    [switch]$StopRunningInstance
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$backendDir = Join-Path $PSScriptRoot "backend"
$healthScript = Join-Path $PSScriptRoot "check-backend-health.ps1"
$didPushLocation = $false

function Get-BackendMainProcesses {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BackendRoot
    )

    $normalizedRoot = [System.IO.Path]::GetFullPath($BackendRoot).ToLowerInvariant()
    $processes = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue
    if ($null -eq $processes) {
        return @()
    }

    $processMatches = @()
    foreach ($proc in $processes) {
        $cmd = ("" + $proc.CommandLine).Trim()
        if ([string]::IsNullOrWhiteSpace($cmd)) {
            continue
        }

        $lowerCmd = $cmd.ToLowerInvariant()
        $looksLikeBackendMain = $lowerCmd.Contains($normalizedRoot) -and (
            $lowerCmd.Contains("\\main.py") -or $lowerCmd -match '\bmain\.py\b'
        )
        if (-not $looksLikeBackendMain) {
            continue
        }

        $processMatches += [pscustomobject]@{
            ProcessId = [int]$proc.ProcessId
            CommandLine = $cmd
        }
    }

    return $processMatches
}

if ($CheckOnly) {
    if (-not (Test-Path $healthScript)) {
        throw "Health check script not found: $healthScript"
    }

    & $healthScript `
        -ServerHost $ServerHost `
        -ServerPort $ServerPort `
        -UseHttps:$UseHttps `
        -TimeoutSeconds $HealthTimeoutSeconds
    if (-not $?) {
        exit 1
    }
    exit 0
}

$runningBackend = @(Get-BackendMainProcesses -BackendRoot $backendDir)
if ($runningBackend.Count -gt 0) {
    if ($StopRunningInstance) {
        foreach ($proc in $runningBackend) {
            try {
                Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
                Write-Host "[run-server] stopped existing backend process pid=$($proc.ProcessId)"
            }
            catch {
                Write-Host "[run-server] warning: failed stopping pid=$($proc.ProcessId): $($_.Exception.Message)"
            }
        }
        Start-Sleep -Seconds 1
    }
    elseif (-not $AllowRunningInstance) {
        Write-Host "[run-server] existing backend process detected:"
        foreach ($proc in $runningBackend) {
            Write-Host ("- pid={0} cmd={1}" -f $proc.ProcessId, $proc.CommandLine)
        }
        Write-Host "[run-server] use -AllowRunningInstance to keep current instance, or -StopRunningInstance to restart cleanly."
        exit 1
    }
}

try {
    Push-Location $backendDir
    $didPushLocation = $true

    $venvPython = Join-Path $backendDir ".venv\\Scripts\\python.exe"

    if (-not (Test-Path $venvPython)) {
        py -3.11 -m venv .venv
    }

    if ($InstallDeps) {
        & $venvPython -m pip install --upgrade pip
        & $venvPython -m pip install -r requirements.txt
    }

    & $venvPython main.py
}
finally {
    if ($didPushLocation) {
        Pop-Location
    }
}
