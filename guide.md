# Run Guide (Server + Native Client)

## Prerequisites
- Windows + PowerShell
- Python 3.11 (`py -3.11`)
- .NET SDK 8+

## 1. Run Backend (Server)
Open terminal at:
- `D:\ProjectMagang\aiflow\aski-flow`

First time:
```powershell
powershell -ExecutionPolicy Bypass -File server-side/run-server.ps1 -InstallDeps
```

Normal run:
```powershell
powershell -ExecutionPolicy Bypass -File server-side/run-server.ps1
```

Health check:
```powershell
curl http://127.0.0.1:8000/health
```

Expected:
- `{"status":"ok"}`

## 2. Run Native Client Host
Open another terminal at:
- `D:\ProjectMagang\aiflow\aski-flow`

Run:
```powershell
& "C:\Program Files\dotnet\dotnet.exe" run --project client-native/winui/Aski.NativeClient.Host/Aski.NativeClient.Host.csproj
```

Inside the app:
1. Fill `Server Host` and `Port` (example `192.168.137.103` and `8000`).
2. Click `Save Settings`.
3. Click `Test /health`.
4. Click `Test API v1`.
5. Click `Connect Socket`.

## 3. Native Connectivity Check (CLI)
```powershell
powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/check-native-connection.ps1 -ServerHost 192.168.137.103 -ServerPort 8000
```

Expected success lines:
- `health_ok`
- `socket_connected`
- `SUCCESS`

## 4. Client Config Storage
Runtime config is stored at:
- `%LOCALAPPDATA%\AskiFlowNative\settings.json`

## 5. Quick Troubleshooting
- Port 8000 already in use:
```powershell
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```
- Reinstall backend dependencies:
```powershell
powershell -ExecutionPolicy Bypass -File server-side/run-server.ps1 -InstallDeps
```
- Validate native connectivity:
```powershell
powershell -ExecutionPolicy Bypass -File client-native/winui/scripts/check-native-connection.ps1 -ServerHost 127.0.0.1 -ServerPort 8000
```
