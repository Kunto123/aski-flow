# Client Side Context

## Last Updated
- Date: 2026-02-25
- Scope: Thin desktop client for central server + OCR/QR output readability UX.

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
- Main Vision model fields now support searchable recommendations from server-side local model files.
- Legacy standalone `Ergonomic Check` node removed from UI node palette/registry.
- QR Reader UI/Display output readability improved:
  - QR preview overlay text is now optional via node config (default OFF)
  - Output renderer keeps OCR/QR output #1 rendered as text, including URL-like QR payloads
  - Display node now forwards upstream processor type hint so OCR/QR text-first behavior applies downstream
- Streaming progress UI no longer clears running state on intermediate (`isDone=false`) updates
- OCR/QR text-first output default font size slightly increased for better readability
- Socket disconnect/reconnect now clears per-node running indicators to avoid stuck `Start` loading state after dropped WS connection
- QR/OCR output text now has fallback live refresh from stream predictions endpoint (`predictions.json`) when socket progress events are missed
- Client camera publisher cleanup now handles stale publishers from previous socket session IDs (post-reconnect), helping release webcam after node delete/clear

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
7. Legacy ergonomic node cleanup (UI):
   - Removed `ergonomic-check` node registration from `nodeConfig.ts`
   - Deleted `client-side/ui/src/nodes-configuration/ergonomicCheckNode.ts`
8. Main Vision model search dropdown (server-backed):
   - `model_path` and `ergonomic_pose_model_path` now use autocomplete suggestions
   - Suggestions fetched from server local model-file endpoint
   - Files:
     - `client-side/ui/src/hooks/useFormFields.tsx`
     - `client-side/ui/src/api/models.ts`
9. Canvas-scale dropdown sizing fix:
   - Model autocomplete dropdown now renders inside node/canvas (`withinPortal: false`)
   - Prevents oversized dropdown when node is visually scaled in flow canvas
   - File: `client-side/ui/src/hooks/useFormFields.tsx`
10. Model autocomplete option click fix in React Flow:
   - Wrapped autocomplete in `nodrag/nopan` container and stopped pointer/mouse propagation
   - Fixes suggestion list visible but not selectable due to canvas drag/pan interception
   - File: `client-side/ui/src/hooks/useFormFields.tsx`
11. QR Reader output readability and preview controls:
   - Added advanced `QR Code Reader` UI toggles:
     - `Draw Boxes (stream preview)` (default ON)
     - `Draw Decoded Text (preview)` (default OFF)
   - Updated help text to clarify:
     - Output 1 = decoded text
     - Output 2 = preview media/stream
   - Files:
     - `client-side/ui/src/nodes-configuration/qrCodeReaderNode.ts`
     - `client-side/ui/src/components/nodes/DisplayNode.tsx`
     - `client-side/ui/src/components/nodes/node-output/OutputDisplay.tsx`
12. Streaming progress UX fix for realtime processors:
   - `Flow.tsx` now keeps node as running until `progress.isDone === true`
   - Prevents premature spinner stop during live `progress` updates from stream processors
   - File: `client-side/ui/src/components/Flow.tsx`
13. Socket lifecycle UX hardening for node run indicators:
   - `useFlowSocketListeners` now supports optional `onConnect` callback
   - `Flow.tsx` clears `currentNodesRunning` on disconnect/reconnect to recover from dropped socket sessions
   - Files:
     - `client-side/ui/src/hooks/useFlowSocketListeners.tsx`
     - `client-side/ui/src/components/Flow.tsx`
14. QR/OCR live text fallback (socket-loss tolerant):
   - `OutputDisplay` polls `/stream/<id>/predictions.json` for OCR/QR nodes with text+stream outputs
   - Uses payload (`qr_text` / `text`) to refresh visible text output when socket realtime updates are unavailable
   - File: `client-side/ui/src/components/nodes/node-output/OutputDisplay.tsx`
15. Client camera publisher stale-session cleanup:
   - Stops publishers from previous socket session IDs during prewarm and stop operations
   - Prevents webcam lock persisting after reconnect + node deletion
   - File: `client-side/ui/src/services/clientCameraPublishers.ts`

## Validation Status
- Prior blocker is resolved:
  - Old issue at `lampControlNode.ts:21` (`"output"` not assignable to `SectionType`) no longer blocks build.
- Latest build command result:
  - `npm run build` -> success.
- Post-model-picker update build result:
  - `npm run build` -> success.
- Post-clickability fix build result:
  - `npm run build` -> success.
- Post-QR readability/output patch build result:
  - `npm run build` -> success.
- Post-streaming-race/readability patch build result:
  - `npm run build` -> success.
- Post-socket-disconnect/stuck-start patch build result:
  - `npm run build` -> success.
- Post-predictions-fallback/camera-cleanup patch build result:
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
- Main Vision model path remains manually editable (autocomplete is assistive, not mandatory).
- Output indicator dedup remains available.

## Next Client Tasks
1. Run manual flow regression with backend live (`camera -> ROI -> main vision -> display`).
2. Validate realtime behavior with two clients connected simultaneously.
3. Continue all UI changes only in `client-side/ui`.
