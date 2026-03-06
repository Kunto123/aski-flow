param(
    [string]$ServerAddress = "",
    [Nullable[int]]$ServerPort = $null,
    [switch]$UseHttps,
    [string]$ApiVersion = "",
    [string]$ClientId = "",
    [string]$AuthToken = "",
    [switch]$NoCanvasOnly,
    [switch]$NoAutoOpenCanvas,
    [string]$EditorUrl = "",
    [string]$EditorBundleRoot = "",
    [string]$EditorEntryFile = "index.html"
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptRoot "..\\..\\..")).Path
$projectPath = Join-Path $repoRoot "client-native/winui/Aski.NativeClient.Host/Aski.NativeClient.Host.csproj"
$defaultBundlePath = Join-Path $repoRoot "client-native/winui/embedded/flow-editor"

if (-not (Test-Path $projectPath)) {
    throw "Host project not found: $projectPath"
}

if ([string]::IsNullOrWhiteSpace($EditorBundleRoot) -and (Test-Path $defaultBundlePath)) {
    $EditorBundleRoot = $defaultBundlePath
}

$nativeArgs = @()

if (-not [string]::IsNullOrWhiteSpace($ServerAddress)) {
    $nativeArgs += @("--ServerAddress", $ServerAddress)
}

if ($ServerPort.HasValue) {
    $nativeArgs += @("--ServerPort", $ServerPort.Value.ToString())
}

if (-not [string]::IsNullOrWhiteSpace($ApiVersion)) {
    $nativeArgs += @("--ApiVersion", $ApiVersion)
}

if ($UseHttps) {
    $nativeArgs += "--UseHttps"
}

if (-not [string]::IsNullOrWhiteSpace($ClientId)) {
    $nativeArgs += @("--ClientId", $ClientId)
}

if (-not [string]::IsNullOrWhiteSpace($AuthToken)) {
    $nativeArgs += @("--AuthToken", $AuthToken)
}

if (-not [string]::IsNullOrWhiteSpace($EditorUrl)) {
    $nativeArgs += @("--EditorUrl", $EditorUrl)
}

if (-not [string]::IsNullOrWhiteSpace($EditorBundleRoot)) {
    $nativeArgs += @("--EditorBundleRoot", $EditorBundleRoot)
}

if (-not [string]::IsNullOrWhiteSpace($EditorEntryFile)) {
    $nativeArgs += @("--EditorEntryFile", $EditorEntryFile)
}

if (-not $NoCanvasOnly) {
    $nativeArgs += "--CanvasOnly"
}

if ($NoAutoOpenCanvas) {
    $nativeArgs += "--NoAutoOpenCanvas"
} elseif ($NoCanvasOnly) {
    $nativeArgs += "--OpenCanvas"
}

$dotnetExe = "C:\Program Files\dotnet\dotnet.exe"
if (-not (Test-Path $dotnetExe)) {
    $dotnetExe = "dotnet"
}

& $dotnetExe run --project $projectPath -- @nativeArgs
