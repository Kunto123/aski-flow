# Native Client (WinUI) Scaffold

This directory is the active Windows native client workspace.

## Current Phase
- Stage 1: baseline freeze complete.
- Stage 2: stack decision frozen (`WinUI 3 + Windows App SDK`).
- Stage 3: communication contract v1 frozen.
- Stage 4: server hardening initial batch complete (`/v1`, `client_id`, optional token).
- Stage 5: initial module scaffold created.
- Stage 6: native settings implementation initial batch complete.
- Stage 7: typed REST client implementation initial batch complete.
- Stage 8: Socket.IO transport implementation complete.
- Stage 9: native camera pipeline core complete.
- Stage 10: output rendering core complete (controller + polling orchestration).
- Stage 11: flow editor host runtime core complete.
- Stage 12: MSIX packaging pipeline complete (host publish + manifest templating + package build).
- Stage 13: pilot toolkit complete and validated.

## Folder Layout
- `src/AppShell` - app bootstrap and navigation host.
- `src/Settings` - server endpoint config and local persistence.
- `src/FlowRunner` - run node / run flow orchestration.
- `src/CameraService` - native camera capture and jpeg upload.
- `src/SocketService` - Socket.IO connect/subscribe/emit.
- `src/StreamViewer` - stream and prediction rendering.

## Important
- Native implementation must keep communication compatibility with:
  - `docs/native-migration/COMMUNICATION_CONTRACT_V1.md`

## Implemented Core Files
- `Aski.NativeClient.Core.csproj`
- `src/Settings/NativeClientSettings.cs`
- `src/Settings/JsonClientSettingsStore.cs`
- `src/FlowRunner/AskiRestClient.cs`
- `src/AppShell/NativeClientBootstrap.cs`
- `src/SocketService/IFlowSocketClient.cs`
- `src/SocketService/FlowSocketClientSocketIo.cs`
- `src/SocketService/FlowSocketClientStub.cs`
- `src/CameraService/CameraFrameUploader.cs`
- `src/FlowEditor/FlowEditorHostRuntime.cs`
- `Aski.NativeClient.Host/Aski.NativeClient.Host.csproj`
- `Aski.NativeClient.ConnectionCheck/Aski.NativeClient.ConnectionCheck.csproj`

## Scripts
- `scripts/publish-core.ps1` for core publish output artifacts.
- `scripts/build-msix.ps1` for host MSIX build output artifacts.
- `scripts/new-dev-signing-cert.ps1` for pilot signing certificate generation.
- `scripts/sign-msix.ps1` for signing generated MSIX package.
- `scripts/install-msix.ps1` for pilot install flow (cert import + app install).
- `scripts/pilot-preflight.ps1` for pilot environment readiness checks.
- `scripts/pilot-smoke.ps1` for pilot smoke execution (launch/process/connectivity baseline).
- `scripts/check-native-connection.ps1` for native REST + Socket connectivity verification.

## Prerequisites (to start coding WinUI)
- Install .NET SDK 8+.
- Install Visual Studio 2022 with:
  - Windows App SDK / WinUI workload.
  - MSIX packaging tools (Windows SDK `makeappx` + `signtool`).
