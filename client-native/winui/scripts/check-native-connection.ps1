param(
    [string]$ServerHost = "127.0.0.1",
    [int]$ServerPort = 8000,
    [switch]$UseHttps,
    [string]$ApiVersion = "v1",
    [string]$AuthToken = "",
    [string]$ClientId = "",
    [int]$TimeoutSeconds = 10,
    [int]$SocketWaitSeconds = 2,
    [string]$Configuration = "Debug"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$dotnetPath = "C:\Program Files\dotnet\dotnet.exe"
if (-not (Test-Path $dotnetPath)) {
    $dotnetPath = "dotnet"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\\Aski.NativeClient.ConnectionCheck\\Aski.NativeClient.ConnectionCheck.csproj"))
if (-not (Test-Path $projectPath)) {
    throw "Connection check project not found: $projectPath"
}

$argsList = @(
    "run",
    "--project", $projectPath,
    "-c", $Configuration,
    "--",
    "--host", $ServerHost,
    "--port", $ServerPort.ToString(),
    "--api-version", $ApiVersion,
    "--timeout", $TimeoutSeconds.ToString(),
    "--socket-wait", $SocketWaitSeconds.ToString()
)

if ($UseHttps) {
    $argsList += "--https"
}
if (-not [string]::IsNullOrWhiteSpace($AuthToken)) {
    $argsList += @("--auth-token", $AuthToken)
}
if (-not [string]::IsNullOrWhiteSpace($ClientId)) {
    $argsList += @("--client-id", $ClientId)
}

Write-Host "[check-native-connection] target=$ServerHost`:$ServerPort https=$UseHttps api=$ApiVersion"
& $dotnetPath @argsList
