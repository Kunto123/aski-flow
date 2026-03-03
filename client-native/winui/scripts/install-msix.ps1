param(
    [string]$MsixPath = "",
    [string]$CertificatePath = "",
    [ValidateSet("CurrentUser", "LocalMachine")]
    [string]$TrustScope = "CurrentUser",
    [ValidateSet("TrustedPeople", "TrustedPeopleAndRoot")]
    [string]$TrustMode = "TrustedPeopleAndRoot",
    [switch]$RemoveExisting,
    [switch]$ForceApplicationShutdown,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-MsixIdentityInfo {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PackagePath
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        $manifestEntry = $zip.GetEntry("AppxManifest.xml")
        if ($null -eq $manifestEntry) {
            throw "AppxManifest.xml not found in package."
        }

        $reader = New-Object System.IO.StreamReader($manifestEntry.Open())
        try {
            $manifestXml = [xml]$reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $zip.Dispose()
    }

    $namespace = New-Object System.Xml.XmlNamespaceManager($manifestXml.NameTable)
    $namespace.AddNamespace("appx", "http://schemas.microsoft.com/appx/manifest/foundation/windows10")
    $identityNode = $manifestXml.SelectSingleNode("/appx:Package/appx:Identity", $namespace)
    if ($null -eq $identityNode) {
        throw "Identity element not found in AppxManifest.xml"
    }

    return [pscustomobject]@{
        Name      = $identityNode.Attributes["Name"].Value
        Publisher = $identityNode.Attributes["Publisher"].Value
        Version   = $identityNode.Attributes["Version"].Value
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ([string]::IsNullOrWhiteSpace($MsixPath)) {
    $defaultMsixDir = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\\artifacts\\msix"))
    $latest = Get-ChildItem -Path $defaultMsixDir -Filter "*.msix" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($null -eq $latest) {
        throw "No .msix file found in $defaultMsixDir. Pass -MsixPath explicitly."
    }
    $MsixPath = $latest.FullName
}

if (-not (Test-Path $MsixPath)) {
    throw "MSIX file not found: $MsixPath"
}

if ([string]::IsNullOrWhiteSpace($CertificatePath)) {
    $defaultCer = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\\artifacts\\cert\\aski-native-dev.cer"))
    if (Test-Path $defaultCer) {
        $CertificatePath = $defaultCer
    }
}

if (-not [string]::IsNullOrWhiteSpace($CertificatePath)) {
    if (-not (Test-Path $CertificatePath)) {
        throw "Certificate file not found: $CertificatePath"
    }

    $trustedPeopleStore = "Cert:\\$TrustScope\\TrustedPeople"
    $rootStore = "Cert:\\$TrustScope\\Root"

    if ($DryRun) {
        Write-Host "[install-msix] dry-run: would import certificate to $trustedPeopleStore : $CertificatePath"
    }
    else {
        try {
            Write-Host "[install-msix] importing certificate to $trustedPeopleStore : $CertificatePath"
            Import-Certificate -FilePath $CertificatePath -CertStoreLocation $trustedPeopleStore | Out-Null
        }
        catch {
            throw "Failed importing certificate to $trustedPeopleStore. If using LocalMachine, run PowerShell as Administrator. Inner: $($_.Exception.Message)"
        }
    }

    if ($TrustMode -eq "TrustedPeopleAndRoot") {
        if ($DryRun) {
            Write-Host "[install-msix] dry-run: would import certificate to $rootStore : $CertificatePath"
        }
        else {
            try {
                Write-Host "[install-msix] importing certificate to $rootStore : $CertificatePath"
                Import-Certificate -FilePath $CertificatePath -CertStoreLocation $rootStore | Out-Null
            }
            catch {
                throw "Failed importing certificate to $rootStore. If using LocalMachine, run PowerShell as Administrator. Inner: $($_.Exception.Message)"
            }
        }
    }
}
else {
    Write-Host "[install-msix] no certificate imported (CertificatePath not provided)."
}

$identity = Get-MsixIdentityInfo -PackagePath $MsixPath
Write-Host "[install-msix] package identity: $($identity.Name) version=$($identity.Version)"

if ($RemoveExisting) {
    $installed = Get-AppxPackage -Name $identity.Name -ErrorAction SilentlyContinue
    if ($null -ne $installed) {
        foreach ($pkg in $installed) {
            if ($DryRun) {
                Write-Host "[install-msix] dry-run: would remove existing package: $($pkg.PackageFullName)"
            }
            else {
                Write-Host "[install-msix] removing existing package: $($pkg.PackageFullName)"
                Remove-AppxPackage -Package $pkg.PackageFullName
            }
        }
    }
}

$addArgs = @{
    Path = $MsixPath
}
if ($ForceApplicationShutdown) {
    $addArgs["ForceApplicationShutdown"] = $true
}

Write-Host "[install-msix] installing package: $MsixPath"
if ($DryRun) {
    Write-Host "[install-msix] dry-run: install skipped."
}
else {
    try {
        Add-AppxPackage @addArgs
    }
    catch {
        $message = $_.Exception.Message
        $activityId = $null
        $activityIdPatternA = [regex]"ActivityId\]\s*([0-9a-fA-F-]{36})"
        $activityIdPatternB = [regex]"ActivityID\s*([0-9a-fA-F-]{36})"

        if ($activityIdPatternA.IsMatch($message)) {
            $activityId = $activityIdPatternA.Match($message).Groups[1].Value
        }
        elseif ($activityIdPatternB.IsMatch($message)) {
            $activityId = $activityIdPatternB.Match($message).Groups[1].Value
        }

        $appxLogSnippet = ""
        if (-not [string]::IsNullOrWhiteSpace($activityId)) {
            try {
                $logLines = Get-AppPackageLog -ActivityID $activityId |
                    Select-Object -First 12 |
                    ForEach-Object {
                        $timeValue = if ($null -ne $_.TimeCreated) { $_.TimeCreated } else { "<no-time>" }
                        $levelValue = if ($null -ne $_.LevelDisplayName) { $_.LevelDisplayName } elseif ($null -ne $_.Level) { $_.Level } else { "<no-level>" }
                        "{0} | {1} | {2}" -f $timeValue, $levelValue, $_.Message
                    }
                if ($logLines.Count -gt 0) {
                    $appxLogSnippet = "`nAppPackageLog (first entries):`n" + ($logLines -join "`n")
                }
            }
            catch {
                $appxLogSnippet = "`nAppPackageLog lookup failed for ActivityId=$activityId. Inner: $($_.Exception.Message)"
            }
        }

        throw @"
Add-AppxPackage failed.
Message: $message
$appxLogSnippet
Try:
- Ensure certificate trust chain is installed in LocalMachine\TrustedPeople and LocalMachine\Root (requires Administrator), or
- Use enterprise/CA-issued signing certificate that chains to trusted root.
"@
    }
}

Write-Host "[install-msix] install complete."
