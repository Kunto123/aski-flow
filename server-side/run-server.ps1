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

function Invoke-NativeCommandQuietly {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,

        [string[]]$Arguments = @()
    )

    $previousErrorPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $capturedOutput = & $Command @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorPreference
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = @($capturedOutput)
    }
}

function Test-PythonRuntime {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,

        [string[]]$Arguments = @(),

        [Parameter(Mandatory = $true)]
        [string]$RequiredMajorMinor
    )

    $result = Invoke-NativeCommandQuietly -Command $Command -Arguments ($Arguments + @("-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"))
    if ($result.ExitCode -ne 0) {
        return $false
    }

    $reportedVersion = ("" + ($result.Output | Select-Object -First 1)).Trim()
    return $reportedVersion -eq $RequiredMajorMinor
}

function Get-CompatiblePythonRuntime {
    $preferredVersions = @("3.11", "3.10", "3.9")
    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($null -ne $launcher) {
        foreach ($version in $preferredVersions) {
            if (Test-PythonRuntime -Command $launcher.Source -Arguments @("-$version") -RequiredMajorMinor $version) {
                return [pscustomobject]@{
                    Command = $launcher.Source
                    Arguments = @("-$version")
                    Display = "py -$version"
                    Version = $version
                }
            }
        }
    }

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($null -ne $pythonCommand) {
        foreach ($version in $preferredVersions) {
            if (Test-PythonRuntime -Command $pythonCommand.Source -RequiredMajorMinor $version) {
                return [pscustomobject]@{
                    Command = $pythonCommand.Source
                    Arguments = @()
                    Display = $pythonCommand.Source
                    Version = $version
                }
            }
        }
    }

    return $null
}

function Get-DetectedPythonRuntimesSummary {
    $detected = @()

    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($null -ne $launcher) {
        $launcherResult = Invoke-NativeCommandQuietly -Command $launcher.Source -Arguments @("-0p")
        if ($launcherResult.ExitCode -eq 0) {
            foreach ($line in $launcherResult.Output) {
                $trimmed = ("" + $line).Trim()
                if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
                    $detected += $trimmed
                }
            }
        }
    }

    if ($detected.Count -eq 0) {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if ($null -ne $pythonCommand) {
            $pythonVersionResult = Invoke-NativeCommandQuietly -Command $pythonCommand.Source -Arguments @("-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')")
            if ($pythonVersionResult.ExitCode -eq 0) {
                $trimmedVersion = ("" + ($pythonVersionResult.Output | Select-Object -First 1)).Trim()
                if (-not [string]::IsNullOrWhiteSpace($trimmedVersion)) {
                    $detected += ("python -> {0} ({1})" -f $pythonCommand.Source, $trimmedVersion)
                }
            }
        }
    }

    if ($detected.Count -eq 0) {
        return "none"
    }

    return ($detected -join "; ")
}

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
        $pythonRuntime = Get-CompatiblePythonRuntime
        if ($null -eq $pythonRuntime) {
            $detectedRuntimes = Get-DetectedPythonRuntimesSummary
            Write-Host @"
Compatible Python runtime not found.
This backend supports Python 3.9, 3.10, or 3.11, and prefers 3.11.
Detected runtimes: $detectedRuntimes

Install Python 3.11, then rerun:
  winget install Python.Python.3.11
  powershell -ExecutionPolicy Bypass -File server-side/run-server.ps1 -InstallDeps
"@
            exit 1
        }

        Write-Host ("[run-server] creating virtual environment using {0}" -f $pythonRuntime.Display)
        & $pythonRuntime.Command @($pythonRuntime.Arguments + @("-m", "venv", ".venv"))
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $venvPython)) {
            throw ("Failed to create backend virtual environment using {0}." -f $pythonRuntime.Display)
        }
    }

    if ($InstallDeps) {
        & $venvPython -m pip install --upgrade pip
        & $venvPython -m pip install -r requirements.txt
        $windowsRequirements = Join-Path $backendDir "requirements_windows.txt"
        if ($env:OS -eq "Windows_NT" -and (Test-Path $windowsRequirements)) {
            & $venvPython -m pip install -r $windowsRequirements
        }
    }

    & $venvPython main.py
}
finally {
    if ($didPushLocation) {
        Pop-Location
    }
}
