# Run Guide (Server + Client)

## Environment Clarification
- For this `aski-flow` project, backend runtime uses:
  - `D:\ProjectMagang\aiflow\aski-flow\server-side\backend\.venv`
- The old env at:
  - `D:\ProjectMagang\aiflow\.venv`
  is not used by current `aski-flow` run flow.
- You can keep `D:\ProjectMagang\aiflow\.venv` if needed for other projects, otherwise it is safe to remove.

## Prerequisites
- Windows + PowerShell
- Python 3.11 available (`py -3.11`)
- Node.js + npm installed

## 1. Run Backend (Server)
Open terminal at:
- `D:\ProjectMagang\aiflow\aski-flow`

First time (create venv + install deps + run):
```powershell
powershell -ExecutionPolicy Bypass -File server-side/run-server.ps1 -InstallDeps
```

Normal run:
```powershell
powershell -ExecutionPolicy Bypass -File server-side/run-server.ps1
```

Backend default address:
- `http://127.0.0.1:8000`

Health check:
```powershell
curl http://127.0.0.1:8000/health
```

Expected:
- `{"status":"ok"}`

## 2. Run Desktop Client (Windows App)
Open another terminal at:
- `D:\ProjectMagang\aiflow\aski-flow`

First time (install deps + run desktop client):
```powershell
powershell -ExecutionPolicy Bypass -File client-side/run-client.ps1 -InstallDeps
```

Normal run (desktop mode is default):
```powershell
powershell -ExecutionPolicy Bypass -File client-side/run-client.ps1
```

Desktop mode behavior:
- UI runs in Electron window (no browser tab).
- Uses static `client-side/ui/build` as app shell.
- If build is missing, launcher builds it automatically.

Example for many clients to one central server:
```powershell
powershell -ExecutionPolicy Bypass -File client-side/run-client.ps1 -ServerHost 192.168.1.10 -ServerPort 8000
```

Optional web debug mode (if needed only):
```powershell
powershell -ExecutionPolicy Bypass -File client-side/run-client.ps1 -Mode Web
```

## 3. Client Server Target Config
Launcher writes two runtime paths:
- Desktop runtime env (used by Electron):
  - `ASKI_SERVER_HOST`
  - `ASKI_SERVER_PORT`
  - `ASKI_SERVER_USE_HTTPS`
- Web debug file (used only in `-Mode Web`):
  - `client-side/ui/.env.local`

Set automatically from launcher params:
- `VITE_APP_WS_HOST=<ServerHost>`
- `VITE_APP_WS_PORT=<ServerPort>`
- `VITE_APP_API_REST_PORT=<ServerPort>`
- `VITE_APP_USE_HTTPS=<true|false>`

To change backend target, run `run-client.ps1` with new `-ServerHost/-ServerPort`.

## 4. Quick Troubleshooting
- Port 8000 already in use:
```powershell
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```
- Port 5173 already in use:
```powershell
netstat -ano | findstr :5173
taskkill /PID <PID> /F
```
  - Needed only for optional `-Mode Web` debugging.
- Missing Python package on backend:
```powershell
powershell -ExecutionPolicy Bypass -File server-side/run-server.ps1 -InstallDeps
```
- Frontend dependency issue:
```powershell
powershell -ExecutionPolicy Bypass -File client-side/run-client.ps1 -InstallDeps
```
- Desktop window blank:
  - Fixed in latest launcher/build config.
  - If still happens on old checkout, run:
```powershell
powershell -ExecutionPolicy Bypass -File client-side/run-client.ps1 -InstallDeps
```
