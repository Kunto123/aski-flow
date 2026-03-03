# Native Scripts

- `publish-core.ps1`
  - Publishes `Aski.NativeClient.Core` for a target runtime.
  - Example:
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/publish-core.ps1`
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/publish-core.ps1 -Runtime win-x64 -Configuration Release`

- `build-msix.ps1`
  - Publishes `Aski.NativeClient.Host`, prepares package layout, generates placeholder assets, and builds `.msix`.
  - Example (unsigned package):
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/build-msix.ps1`
  - Example (custom identity + version):
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/build-msix.ps1 -IdentityName com.aski.nativeclient -Version 1.0.0.0`
  - Example (sign package):
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/build-msix.ps1 -CertificatePath C:\cert\aski-native.pfx -CertificatePassword yourPassword`

Requirements:
- .NET SDK 8 or newer.
- Windows SDK tools (`makeappx.exe`, `signtool.exe`) installed.

- `new-dev-signing-cert.ps1`
  - Generates self-signed dev code-signing certificate (`.cer` + `.pfx`) for pilot distribution.
  - Example:
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/new-dev-signing-cert.ps1 -PfxPassword myStrongPassword`

- `sign-msix.ps1`
  - Signs an existing `.msix` package with provided (or default dev) `.pfx`.
  - Example:
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/sign-msix.ps1 -MsixPath client-native/winui/artifacts/msix/com.aski.nativeclient_1.0.0.0_win-x64.msix -CertificatePath client-native/winui/artifacts/cert/aski-native-dev.pfx -CertificatePassword myStrongPassword`

- `install-msix.ps1`
  - Imports signing certificate to `CurrentUser\TrustedPeople` and installs the `.msix` package for pilot device.
  - On install failure, attempts to parse `ActivityId` and include `Get-AppPackageLog` snippet automatically.
  - Example:
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/install-msix.ps1 -MsixPath client-native/winui/artifacts/msix/com.aski.nativeclient_1.0.0.0_win-x64.msix -CertificatePath client-native/winui/artifacts/cert/aski-native-dev.cer -RemoveExisting`
  - Example (machine trust, requires Administrator):
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/install-msix.ps1 -TrustScope LocalMachine -TrustMode TrustedPeopleAndRoot -RemoveExisting`
  - Example (dry-run):
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/install-msix.ps1 -DryRun`

Pilot note:
- If install fails with `0x800B0109`, certificate trust is incomplete for Appx deployment.
- Run with `-TrustScope LocalMachine` from elevated PowerShell or use enterprise CA-issued signing certificate.

- `pilot-preflight.ps1`
  - Checks pilot readiness: DNS/TCP backend reachability, MSIX existence/signature status, installed package status.
  - Example:
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/pilot-preflight.ps1 -ServerHost 192.168.137.103 -ServerPort 8000`
  - Example (offline preflight):
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/pilot-preflight.ps1 -SkipNetworkCheck`

- `pilot-smoke.ps1`
  - Runs pilot smoke checks: installed package presence, backend reachability, app launch verification, host process detection.
  - Uses `PackageFamilyName!AppId` automatically for AUMID launch target (fixes identity-name launch mismatch).
  - Example:
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/pilot-smoke.ps1 -ServerHost 192.168.137.103 -ServerPort 8000`
  - Example (dry-run):
    - `powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/pilot-smoke.ps1 -DryRun -SkipNetworkCheck -SkipLaunch`
