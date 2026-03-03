param(
    [string]$Configuration = "Release",
    [string]$Runtime = "win-x64",
    [string]$OutputDir = "..\\artifacts\\core",
    [switch]$SelfContained
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Join-Path $scriptDir "..\\Aski.NativeClient.Core.csproj"
$dotnetPath = "C:\\Program Files\\dotnet\\dotnet.exe"

if (-not (Test-Path $projectPath)) {
    throw "Project file not found: $projectPath"
}

if (-not (Test-Path $dotnetPath)) {
    throw "dotnet not found at expected path: $dotnetPath"
}

$resolvedOutput = Join-Path $scriptDir $OutputDir
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

$selfContainedValue = if ($SelfContained) { "true" } else { "false" }

Write-Host "[publish-core] project=$projectPath"
Write-Host "[publish-core] configuration=$Configuration runtime=$Runtime self-contained=$selfContainedValue"
Write-Host "[publish-core] output=$resolvedOutput"

& $dotnetPath publish $projectPath `
    -c $Configuration `
    -r $Runtime `
    --self-contained $selfContainedValue `
    -o $resolvedOutput

Write-Host "[publish-core] completed."
