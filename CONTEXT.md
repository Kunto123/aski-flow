# AI Flow Context Log

## Last Updated
- Date: 2026-02-23
- Focus: Main Vision model picker UX from server + legacy ergonomic node cleanup.

## Current Goal
- Keep architecture mode `Central Server + Many Clients`.
- Keep all active development only in `server-side/` and `client-side/`.
- Ensure client runs as Windows desktop app (no browser-first workflow) while keeping central server topology.

## Canonical Structure
- `server-side/backend`: Flask backend, processors, stream manager, AI runtime.
- `server-side/data`: server DB and shared runtime data.
- `client-side/ui`: flow editor and monitoring UI.

## Runtime Readiness (Validated)
- Backend dependency environment prepared on Python 3.11 (`server-side/backend/.venv`).
- Backend smoke test passed:
  - Startup command: `.venv\\Scripts\\python.exe main.py`
  - Health endpoint: `GET http://127.0.0.1:8000/health` -> `200 {"status":"ok"}`
- Frontend dependencies installed (`npm ci`) and production build passed (`npm run build`).
- Frontend preview smoke test passed:
  - `http://127.0.0.1:5173` -> `200`

## Desktop Client Runtime (Latest)
- Client launcher now defaults to desktop mode (`Electron`) instead of browser mode.
- Desktop mode loads local built UI (`client-side/ui/build`) directly in app window.
- `client-side/run-client.ps1` now writes `client-side/ui/.env.local` from:
  - `-ServerHost`
  - `-ServerPort`
  - `-UseHttps`
- Central server target is injected at runtime via:
  - `ASKI_SERVER_HOST`
  - `ASKI_SERVER_PORT`
  - `ASKI_SERVER_USE_HTTPS`
- This keeps many Windows clients pointing to one central server endpoint.
- Desktop blank-window issue fixed:
  - Build output now uses relative base paths (compatible with `file://` in Electron).
  - i18n locale loading now uses `import.meta.env.BASE_URL`.
  - Launcher auto-rebuilds when source files are newer than existing build.

## Key Fixes Applied This Cycle
- Backend local/cloud storage detection fixed:
  - `is_s3_enabled()` now requires non-empty `S3_BUCKET_NAME` (avoid false S3 activation on empty env).
  - File: `server-side/backend/app/env_config.py`
- Backend static build path resolver updated for new repo layout with fallback compatibility.
  - File: `server-side/backend/app/env_config.py`
- Local asset URL generation now uses `BACKEND_HOST/BACKEND_PORT` with protocol awareness.
  - File: `server-side/backend/app/storage/local_storage_strategy.py`
- UI type blocker fixed (`SectionType` now includes `"output"`).
  - File: `client-side/ui/src/nodes-configuration/types.ts`
- Desktop runtime added for client:
  - `client-side/ui/desktop/main.cjs`
  - `client-side/ui/desktop/preload.cjs`
  - `client-side/ui/scripts/run-desktop.cjs`
  - `client-side/ui/scripts/run-desktop-dev.cjs`
- Client launcher upgraded:
  - `client-side/run-client.ps1` (desktop default + central server target params)
- Client package updated:
  - `client-side/ui/package.json` (desktop scripts + Electron dev dependency)
- Client runtime config resolution updated:
  - `client-side/ui/src/config/config.ts` (desktop runtime override path)
- Desktop static load compatibility fixes:
  - `client-side/ui/vite.config.ts` (`base: "./"`)
  - `client-side/ui/src/i18n.js` (`BASE_URL` loadPath)
  - `client-side/ui/index.html` and `client-side/ui/src/layout/main-layout/header/TabHeader.tsx` relative public paths
- Desktop launcher build freshness guard:
  - `client-side/run-client.ps1` now rebuilds when source is newer than `build/index.html`
- Backend Socket.IO compatibility fix for Flask 3.1:
  - Set `manage_session=False` in `server-side/backend/app/flask/socketio_init.py`
  - Prevents `RequestContext.session` setter error on connect/disconnect events
- Root run guide added:
  - `guide.md`
  - Includes env clarification (`server-side/backend/.venv` is canonical for backend runtime).
- Legacy standalone ergonomic node removed (already integrated into Main Vision):
  - UI node config deleted: `client-side/ui/src/nodes-configuration/ergonomicCheckNode.ts`
  - Legacy backend dummy processor deleted: `server-side/backend/app/processors/components/extension/ergonomic_check_processor.py`
  - Node registry cleanup: `client-side/ui/src/nodes-configuration/nodeConfig.ts`
- Main Vision model path fields now use searchable server-backed recommendations:
  - `model_path` and `ergonomic_pose_model_path` fetch local model files from server
  - UI implementation: `client-side/ui/src/hooks/useFormFields.tsx`
  - Client API helper: `client-side/ui/src/api/models.ts`
- Backend local model-file discovery endpoint added (for UI recommendations):
  - Always-available route: `GET /node/local-model-files`
  - Compatibility route: `GET /models/local-files`
  - Shared scanner utility: `server-side/backend/app/utils/local_model_files.py`
- Main Vision model autocomplete dropdown now renders inside canvas (not portal):
  - Fixes dropdown sizing/zoom mismatch when node is scaled in React Flow
  - File: `client-side/ui/src/hooks/useFormFields.tsx`
- Main Vision model autocomplete options made clickable inside React Flow nodes:
  - Added `nodrag/nopan` wrapper + stopped pointer/mouse propagation on autocomplete container
  - Prevents React Flow drag/pan from swallowing option-click selection
  - File: `client-side/ui/src/hooks/useFormFields.tsx`
- `ppe.pt` capability check (server local model):
  - Embedded class names found in checkpoint metadata: `glasses`, `gloves`, `helmet`, `mask`, `safety-shoes`, `vest`
  - Indicates PPE detection intent matches helmet/gloves/safety gear use case
  - Current backend `ultralytics` runtime cannot load it directly (legacy checkpoint requires module `models.yolo`, YOLOv5-style custom pickle)
- `ppe.pt` re-export attempt to Ultralytics-compatible `.pt`:
  - Legacy YOLOv5 checkpoint successfully loaded using YOLOv5 repo code (with `weights_only=False`)
  - Class map confirmed: `{glasses, gloves, helmet, mask, safety-shoes, vest}`
  - Conversion to current `ultralytics` `DetectionModel` failed due parser/head incompatibility (`Detect` args mismatch; YOLOv5 anchor head vs current Ultralytics model parser)
  - Practical conclusion: no safe direct `.pt` forward-conversion with current runtime stack; use legacy YOLOv5 runtime support or export to another supported format (e.g. ONNX/TorchScript) instead

## Run Commands
1. Server:
   - First-time deps: `powershell -ExecutionPolicy Bypass -File server-side/run-server.ps1 -InstallDeps`
   - Normal run: `powershell -ExecutionPolicy Bypass -File server-side/run-server.ps1`
2. Client:
   - First-time deps: `powershell -ExecutionPolicy Bypass -File client-side/run-client.ps1 -InstallDeps`
   - Normal run (desktop): `powershell -ExecutionPolicy Bypass -File client-side/run-client.ps1`
   - Multi-client to one server: `powershell -ExecutionPolicy Bypass -File client-side/run-client.ps1 -ServerHost <SERVER_IP> -ServerPort 8000`
3. Reference:
   - Full operational guide: `guide.md`

## Preserved Functional Progress
- Camera cleanup hardened (stop by index + global fallback + cooperative stream handling).
- ROI live runtime params update via `POST /stream/<id>/roi/params`.
- Main Vision output simplified to 2 outputs (`json` + `image`) and default `models/yolov5mu.pt`.
- Ergonomic check integrated into Main Vision.
- Main Vision ergonomic toggle preserved while legacy standalone node is removed.
- Display fit/aspect and output dedup behavior preserved.
- Reactive auto-run guard and erase-output reliability preserved.

## Next Focus
1. Run integrated manual test: `Client -> Server` flow execution and live stream display.
2. Validate multi-client concurrency (two clients connected to one central server).
3. Continue tracking detailed side-specific updates in `server-side/CONTEXT.md` and `client-side/CONTEXT.md`.

## New Chat Bootstrap Prompt
- "Baca `d:/ProjectMagang/aiflow/aski-flow/CONTEXT.md`, lanjutkan task terbaru, dan pertahankan struktur `server-side` + `client-side` saja."
