# Client Side Context

## Last Updated
- Date: 2026-02-20
- Scope: Thin desktop client for central server.

## Canonical Path
- `client-side/ui`: client UI source code.

## Responsibility
- Flow editor and node wiring UI.
- Trigger run/stop actions to server.
- Render outputs (JSON/text/media/stream) from server responses.
- Subscribe to realtime run events and stream outputs.

## Progress Update (This Cycle)
- Frontend dependencies installed successfully (`npm ci`).
- TypeScript + Vite production build passed (`npm run build`).
- Frontend preview smoke test passed:
  - `http://127.0.0.1:5173` returns `200`.
- Desktop runtime added using Electron (Windows app style client).

## Code Changes (This Cycle)
1. Build blocker fix:
   - Added `"output"` to `SectionType` union.
   - File: `client-side/ui/src/nodes-configuration/types.ts`
2. Desktop runtime added:
   - Files:
     - `client-side/ui/desktop/main.cjs`
     - `client-side/ui/desktop/preload.cjs`
     - `client-side/ui/scripts/run-desktop.cjs`
     - `client-side/ui/scripts/run-desktop-dev.cjs`
3. Client launcher upgraded:
   - `client-side/run-client.ps1` now defaults to desktop mode.
   - Supports central server params: `-ServerHost`, `-ServerPort`, `-UseHttps`.
   - Writes runtime target config to `client-side/ui/.env.local`.
   - Exposes runtime desktop target via env:
     - `ASKI_SERVER_HOST`
     - `ASKI_SERVER_PORT`
     - `ASKI_SERVER_USE_HTTPS`
4. Runtime config reader updated:
   - File: `client-side/ui/src/config/config.ts`
   - Desktop mode can override host/port/protocol from preload runtime values.
5. Desktop blank-window fix:
   - `vite.config.ts` now uses relative build base (`"./"`).
   - `i18n` locale path now uses `import.meta.env.BASE_URL`.
   - Public asset paths adjusted to relative for file-based Electron loading.
   - `run-client.ps1` now rebuilds automatically when source files are newer than build output.
6. Root operational guide updated:
   - File: `guide.md`

## Validation Status
- Prior blocker is resolved:
  - Old issue at `lampControlNode.ts:21` (`"output"` not assignable to `SectionType`) no longer blocks build.
- Latest build command result:
  - `npm run build` -> success.

## Run Instructions
- First-time setup + run desktop client:
  - `powershell -ExecutionPolicy Bypass -File client-side/run-client.ps1 -InstallDeps`
- Normal run desktop client:
  - `powershell -ExecutionPolicy Bypass -File client-side/run-client.ps1`
- Multi-client to one central server:
  - `powershell -ExecutionPolicy Bypass -File client-side/run-client.ps1 -ServerHost <SERVER_IP> -ServerPort 8000`
- Optional browser mode for debugging only:
  - `powershell -ExecutionPolicy Bypass -File client-side/run-client.ps1 -Mode Web`

## Preserved UI Functional Progress
- ROI live param update behavior remains available.
- Display fit/contain and no-stretch behavior remains available.
- Main Vision 2-output UX and ergonomic toggle remain available.
- Output indicator dedup remains available.

## Next Client Tasks
1. Run manual flow regression with backend live (`camera -> ROI -> main vision -> display`).
2. Validate realtime behavior with two clients connected simultaneously.
3. Continue all UI changes only in `client-side/ui`.
