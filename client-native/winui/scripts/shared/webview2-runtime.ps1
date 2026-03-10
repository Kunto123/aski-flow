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
