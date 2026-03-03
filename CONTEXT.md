# AI Flow Context Log

## Migration Notice
- Date: 2026-03-03
- Client architecture is now native-first.
- Legacy `client-side/` web/electron workspace has been removed from tracked sources.
- Active client runtime lives under `client-native/winui/`.

## Last Updated
- Date: 2026-03-02
- Focus: Workstation UI cleanup + topbar refresh action + launcher directory restore on Ctrl+C.

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
- OCR runtime prerequisites validated on Windows (server-side environment target):
  - `tesseract.exe` available in PATH (`tesseract -v` OK)
  - Installed languages confirmed (user reported `ind` available after setup; initial check showed `eng`, `osd`)
  - `pytesseract` installed in backend venv (`server-side/backend/.venv`) and importable
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
- Topbar `Refresh` button added to refresh frontend render state and reconnect backend socket:
  - Header button added in main tab bar.
  - Refresh action now remounts canvas/workstation view and recreates socket connection.
  - Files:
    - `client-side/ui/src/layout/main-layout/header/TabHeader.tsx`
    - `client-side/ui/src/layout/main-layout/AppLayout.tsx`
    - `client-side/ui/src/index.css`
- Launcher scripts now restore the caller working directory after run/interrupt (`Ctrl+C`):
  - Added `Push-Location`/`Pop-Location` guard in both scripts.
  - Files:
    - `client-side/run-client.ps1`
    - `server-side/run-server.ps1`
- Workstation `Predict` section removed from client UI:
  - Removed `predict` from workstation section type and sidebar menu.
  - Removed dummy `Predict` placeholder panel fallback.
  - File: `client-side/ui/src/layout/main-layout/workstation/WorkstationDummy.tsx`
- Frontend build re-validated after workstation cleanup:
  - `client-side/ui`: `npm run build` -> passed
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
- Multi-client camera source fix (central server topology):
  - `camera-input` now prefers client-scoped camera streams when flow runs from UI/desktop client (uses Socket.IO `session_id`)
  - Backend can ingest JPEG frames from client via `POST /stream/client-camera/frame` and expose them as normal `stream://...` streams
  - Stream manager now tracks camera transport (`server` vs `client`) and `client_session_id` for camera streams
  - Frontend prewarms browser/Electron camera publishers before `run_node` / `process_file` so server receives client frames
  - Camera stop endpoints now support optional `client_session_id` scoping; frontend cleanup passes socket session to avoid stopping other clients' camera streams on central server
  - Manual test symptom reported after patch (desktop client): pressing Run gives no output and no camera permission prompt appears on client laptop
  - Web debug fallback test symptom reported: `run-client.ps1 -Mode Web` opened `http://127.0.0.1:5173/` with `404 Not Found` (likely wrong port opened or port 5173 occupied by another process)
  - Follow-up web-mode logs confirm Vite actually starts on `http://127.0.0.1:5173/`; launcher currently emits npm warnings because `--host/--port` args are partially parsed by npm, but Vite still binds successfully
  - Root cause of web-mode `404`: npm strips forwarded `--host/--port` flags, leaving positional `5173`; resulting command becomes `vite --host 127.0.0.1 5173`, so Vite treats `5173` as project root path (not port), starts dev server but serves no `index.html` at `/`
  - Browser console diagnosis in web mode: `Failed to start client camera publisher ... Browser camera API (getUserMedia) is not available` while UI is loaded from `http://192.168.137.103:3000` (HTTP LAN origin, non-secure context)
- Confirmed workaround: web mode from `http://localhost:3000` successfully shows client camera (secure-context localhost exception works); remaining failure is isolated to desktop app/Electron runtime permissions/permission-handling path
- Desktop app camera fix applied:
  - Electron now installs explicit `media` permission check/request handlers for trusted local origins (`file://`, `localhost`, `127.0.0.1`)
  - Desktop mode no longer loads built UI via `file://`; it serves `client-side/ui/build` through an internal loopback HTTP server (`127.0.0.1:<ephemeral>`) and loads that URL, ensuring secure-context camera APIs (`getUserMedia`) are available in renderer
  - File: `client-side/ui/desktop/main.cjs`
- OCR Reader node backend implementation activated (replaces previous dummy passthrough):
  - `server-side/backend/app/processors/components/extension/ocr_reader_processor.py`
  - Supports file mode (`/asset/<image>`) and stream mode (`stream://...`)
  - Uses `OpenCV` preprocessing + `pytesseract` (`image_to_data`) for text, word boxes, confidences
  - Stream mode now emits overlay stream (boxes/text) and live OCR JSON payload via transform-stream predictions
  - Keeps output compatibility pattern (`media_ref`, `json`) so existing OCR node wiring remains usable
  - Adds auto language selection (prefers `eng+ind` when both are installed) with fallback warnings
  - Adds OCR tuning support via processor config/env (lang/psm/oem/preprocess/fps/confidence/overlay toggles)
  - Errors in per-frame OCR no longer kill stream immediately; stream stays alive and reports error status in payload
- OCR Reader UI help text updated to remove dummy label:
  - `client-side/ui/src/nodes-configuration/ocrReaderNode.ts`
- OCR backend smoke test (local synthetic image) passed:
  - Test text `TES OCR 123` detected successfully
  - Default resolved language observed as `eng+ind` in current environment
- QR Reader readability/output UX hardening:
  - QR stream preview now defaults to box-only overlay (`draw_text` default OFF) so preview stays readable
  - QR node UI now exposes advanced preview toggles (`Draw Boxes`, `Draw Decoded Text`)
  - Display/output rendering now treats OCR/QR output #1 as text even when payload looks like a URL (e.g. QR content)
  - Display processor now honors explicit output handle selection for OCR/QR (`output 1 = text`, `output 2 = preview`)
  - Fixed stream-output race where final node completion event could overwrite newer QR/OCR streaming text with stale initial payload (`No QR code detected`)
    - Async launcher final `progress` now emits latest `processor.get_output()` instead of stale local return value
  - Fixed stream startup race in QR/OCR readers where immediate transform updates could be overwritten by `process_and_update()` startup payload
    - `_process_stream()` now returns fresher `self.get_output()` when already updated for the same stream id
  - Frontend flow progress handler now keeps node in running state for `isDone=false` streaming updates
  - OCR/QR text-first output default font size bumped slightly for readability (`OutputDisplay`)
  - Frontend socket disconnect/reconnect now clears `currentNodesRunning` to prevent stuck loading/start indicators after connection drop (e.g. WinError 10054 disconnects)
  - Added QR/OCR live text fallback in UI via `/stream/<id>/predictions.json` polling when node has mixed outputs (text + stream)
    - Keeps text output visible even if realtime socket progress updates are missed after disconnect/reconnect
  - Client camera publisher cleanup hardened against socket session-id changes after reconnect
    - Stale publishers from previous session ids are now stopped during prewarm/stop paths to release webcam correctly
  - Files:
    - `server-side/backend/app/processors/components/extension/qr_code_reader_processor.py`
    - `server-side/backend/app/processors/components/core/display_processor.py`
    - `client-side/ui/src/nodes-configuration/qrCodeReaderNode.ts`
    - `client-side/ui/src/components/nodes/DisplayNode.tsx`
    - `client-side/ui/src/components/nodes/node-output/OutputDisplay.tsx`
    - `server-side/backend/app/processors/launcher/async_processor_launcher.py`
    - `server-side/backend/app/processors/components/extension/ocr_reader_processor.py`
    - `client-side/ui/src/components/Flow.tsx`
    - `client-side/ui/src/hooks/useFlowSocketListeners.tsx`
    - `client-side/ui/src/components/nodes/node-output/OutputDisplay.tsx`
    - `client-side/ui/src/services/clientCameraPublishers.ts`
  - Validation:
    - `py -3.11 -m py_compile ...display_processor.py ...qr_code_reader_processor.py` -> passed
    - `client-side/ui`: `npm run build` -> passed
    - `py -3.11 -m py_compile ...async_processor_launcher.py` -> passed
    - `py -3.11 -m py_compile ...ocr_reader_processor.py ...qr_code_reader_processor.py` -> passed
    - `client-side/ui`: `npm run build` (predictions polling + camera cleanup patch) -> passed

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
- OCR Reader node registration path preserved (`client-side` node config + backend auto-discovery processor factory).
- Display fit/aspect and output dedup behavior preserved.
- Reactive auto-run guard and erase-output reliability preserved.

## Next Focus
1. Run integrated manual test: `Client -> Server` flow execution and live stream display.
2. Validate multi-client concurrency (two clients connected to one central server) with both using `camera_index=0` simultaneously.
3. Validate OCR Reader end-to-end in UI flows (image asset + camera stream) and inspect payload/overlay behavior.
4. Tune OCR defaults for target use cases (language mix, `psm`, `min_confidence`, stream OCR rate) based on real samples.
5. Verify camera permission / device-index mapping behavior on different client laptops (browser/Electron + Windows camera permissions).
6. Continue tracking detailed side-specific updates in `server-side/CONTEXT.md` and `client-side/CONTEXT.md`.

## Review Notes (2026-02-25, No Code Changes)
- Static performance review requested (no source edits) focused on realtime flow paths: camera upload, stream transforms, socket progress updates, and React Flow rendering.
- Key suspected bottlenecks identified:
  - Frontend per-progress updates map all nodes and trigger upstream `onFlowChange` on every stream event (`Flow.tsx`)
  - Broad `NodeContext` value causes many node components to re-render on each state tick (`NodeProvider.tsx`, `GenericNode.tsx`, `DisplayNode.tsx`)
  - `OutputDisplay` fallback polling (`predictions.json`) can create repeated requests per visible OCR/QR output panel
  - Client camera publisher uses main-thread canvas JPEG encode + HTTP POST per frame (high CPU/network at 720p/20fps)
  - Backend stream manager copies frames (`latest_frame.copy()`), re-encodes JPEG in camera/transform loops, and MJPEG clients poll in 30ms loops
  - Async processor launcher uses fixed `eventlet.sleep(0.5)` scheduler tick (adds latency between dependent nodes)
  - QR reader stream inference can build multiple preprocess variants and attempt multi+single decode per variant per inference cycle
- Recommended next action (before more feature work):
  - Run lightweight profiling/telemetry on `progress` event rate, React render count, frame upload throughput, and per-node stream CPU time to confirm highest-impact bottleneck first.
- Follow-up risk question reviewed (no code changes):
  - Performance optimizations can cause regressions if applied naively (camera release, ROI live update, stale outputs), but risk is manageable with staged rollout and guardrails:
    - never change camera stop/release thread semantics without integration tests
    - throttle only intermediate UI updates (`isDone=false`), never final completion events
    - preserve ROI live param path (`/stream/<id>/roi/params`) and stream-id propagation behavior

## New Chat Bootstrap Prompt
- "Baca `d:/ProjectMagang/aiflow/aski-flow/CONTEXT.md`, lanjutkan task terbaru, dan pertahankan struktur `server-side` + `client-side` saja."

## Optimization Implementation Notes (2026-02-25, 8-Point Pass)
- User requested implementation of the 8 performance optimization recommendations (with caution around regressions like camera release and ROI live updates).
- Frontend (`Flow.tsx`) realtime progress handling updated:
  - intermediate stream progress (`isDone=false`) is throttled per-node (~120ms)
  - final progress (`isDone=true`) is applied immediately
  - `lastRun` no longer updates on every intermediate stream tick
  - `onFlowChange` callback is skipped for throttled intermediate progress updates to reduce parent churn
- Frontend socket listeners (`useFlowSocketListeners.tsx`) now use stable wrapper listeners + refs to avoid repeated attach/detach on rerenders.
- Frontend node runtime context split (`NodeProvider.tsx`):
  - `NodeRuntimeContext` introduced for `currentNodesRunning`, `errorCount`, `isRunning`
  - broad `NodeContext` no longer carries runtime counters or raw `nodes/edges`
  - memoized graph indexes/helpers added to reduce repeated scans
  - updated consumers (`NodePlayButton`, `GenericNode`, `RoiNode`, `useIsPlaying`) to read runtime state from `NodeRuntimeContext`
- Frontend `OutputDisplay.tsx` OCR/QR fallback polling optimized:
  - polling is shared per `predictions.json` URL across components
  - polling only runs when socket is disconnected or text still shows placeholder / no-detection text
  - polling is limited to text output tab (`outputIndex=0`) for OCR/QR preferred-text views
- Client camera publisher (`clientCameraPublishers.ts`) optimized with adaptive pacing/backpressure:
  - upload loop interval now adapts based on EWMA upload duration
  - hidden tab reduces send rate further
  - upload failures increase backoff
- Backend stream manager (`stream_manager.py`) optimized:
  - lazy JPEG encoding only when MJPEG clients are subscribed
  - MJPEG generator uses frame-version checks to avoid busy resend loops and unnecessary wake-ups
- Backend QR reader (`qr_code_reader_processor.py`) stream mode now limits preprocessing variants per frame (configurable env-based budget, safe default).
- Backend async launcher (`async_processor_launcher.py`) scheduler loop changed from fixed 0.5s polling to adaptive active/idle tick timing (lower latency, lower idle overhead).
- Validation after optimization pass:
  - `client-side/ui`: `npm run build` success
  - backend `py_compile` success for modified stream/launcher/QR files
- Regression-sensitive behaviors intentionally preserved:
  - camera stop/release cleanup semantics (no aggressive lifecycle refactor)
  - ROI live runtime param update path
  - final node completion events are not throttled

## Follow-up Q&A Note (2026-02-25)
- User asked whether choppy `Camera Input` preview could be caused by the recent optimization pass (no code changes requested).
- Assessment:
  - Yes, it is possible and even likely in some cases, mainly due to two intentional tradeoff optimizations:
    - frontend intermediate `progress` throttling in `Flow.tsx` (~120ms) can make UI preview updates look less smooth (roughly capped visual refresh for node output previews)
    - client camera adaptive upload pacing/backpressure in `clientCameraPublishers.ts` can lower effective FPS when upload/network/CPU is slow
  - Backend lazy JPEG/MJPEG optimizations are less likely to cause local `Camera Input` node preview stutter directly, but can affect perceived smoothness in MJPEG display paths
  - Scheduler/QR variant optimizations are unlikely to be the primary cause of camera preview choppiness

## Follow-up Q&A Note (2026-02-25, UI Throttle Tuning)
- User asked whether UI throttle can be raised to ~15 FPS for smoother preview, without code changes yet.
- Assessment:
  - Yes, feasible and low-risk if only adjusting intermediate UI progress throttle interval.
  - Current throttle is `120ms` (~8.3 FPS visual cap for intermediate preview updates).
  - Recommended tuning candidates:
    - `66ms` (~15 FPS target, smoother, more UI work)
    - `80ms` (~12.5 FPS, safer compromise)
  - Final completion events (`isDone=true`) should remain unthrottled.
  - Actual observed FPS may still be lower due to adaptive camera upload pacing/backpressure under CPU/network load.

## Follow-up Change Applied (2026-02-25, UI Throttle ~15 FPS)
- User approved applying the UI throttle tuning.
- Implemented change in `client-side/ui/src/components/Flow.tsx`:
  - `STREAM_PROGRESS_UI_MIN_INTERVAL_MS` changed from `120` to `66` (target ~15 FPS for intermediate preview updates)
  - final completion events remain unthrottled
- Validation:
  - `client-side/ui`: `npm run build` success

## Model Artifact Inspection Note (2026-02-26, No Code Changes)
- User asked to inspect `best.pt` and `labels.jpg` and derive a `data.yaml` (without changing code yet).
- Findings:
  - `best.pt` exists and is a legacy YOLOv5-style checkpoint (loading with `torch.load(..., weights_only=False)` fails without `models.*` module: `ModuleNotFoundError: No module named 'models'`)
  - `labels.jpg` confirms 6 PPE classes and distribution chart labels:
    `glasses`, `gloves`, `helmet`, `mask`, `safety-shoes`, `vest`
  - Binary string scan of `best.pt` confirms embedded class names and original training data YAML path:
    `/content/datasets/PPE-2/data.yaml`
- Important caveat:
  - Creating `data.yaml` helps class metadata/dataset config, but will not by itself solve legacy YOLOv5 checkpoint compatibility if runtime expects newer Ultralytics model format.

## Model Artifact Relocation + YAML Creation (2026-02-26, No Code Changes)
- User approved moving files to appropriate project paths and generating the YAML.
- Performed file relocation:
  - `best.pt` -> `server-side/backend/models/best.pt`
  - `labels.jpg` -> `server-side/data/datasets/PPE-2/labels.jpg`
- Created dataset config:
  - `server-side/data/datasets/PPE-2/data.yaml`
- Generated `data.yaml` content uses 6 confirmed PPE classes:
  - `glasses`, `gloves`, `helmet`, `mask`, `safety-shoes`, `vest`
- YAML path layout assumes dataset root is `server-side/data/datasets/PPE-2` with:
  - `train/images`
  - `valid/images`
  - `test/images`
- Reminder preserved:
  - legacy YOLOv5 checkpoint compatibility issue may still require conversion/legacy runtime support even with correct `data.yaml`.

## PPE Compliance Function Design Idea (2026-02-26, No Code Changes)
- User proposed combining:
  - PPE detection bounding boxes from YOLOv5 model (`glasses/gloves/helmet/mask/safety-shoes/vest`)
  - ergonomic/pose keypoints (skeleton dots on person)
  into a new function to determine whether a person is wearing PPE.
- Assessment: this is feasible and a strong approach (rule-based geometric association between person keypoints and PPE boxes).
- Current backend context already supports the required ingredients:
  - pose payload contains `people[].bbox_xyxy` + `people[].keypoints[]` (`x,y,conf`)
  - main vision returns detection boxes/classes for PPE detections
- Recommended future function behavior (design-only, not implemented yet):
  - associate PPE boxes to each person (by center-in-person-box / IoU / distance)
  - derive body-part ROIs from keypoints (head/face/torso/hands/feet)
  - check class-specific PPE presence against corresponding ROI
  - output per-person compliance status: `present / missing / unknown`
  - apply temporal smoothing across frames to reduce flicker
- Key risk/quality notes:
  - occlusion and missing keypoints should produce `unknown`, not immediate `missing`
  - multi-person scenes require robust assignment to avoid swapping PPE across people
  - pose and PPE detections should be computed from the same frame (or time-aligned cache) for consistency

## Legacy YOLOv5 `best.pt` Runtime Error Guidance (2026-02-26, No Code Changes)
- User reported runtime error when loading `server-side/backend/models/best.pt` in current Ultralytics-based pipeline:
  - `ModuleNotFoundError: No module named 'models.yolo'`
  - Ultralytics AutoInstall incorrectly tries `pip install models.yolo` (expected failure; `models.yolo` is a Python module path from legacy YOLOv5 repo, not a pip package)
- Diagnosis:
  - `best.pt` is a legacy YOLOv5 checkpoint and is not directly loadable by the current `ultralytics.YOLO(...)` runtime used by `main_vision_model_processor`.
  - `Client disconnected` lines are incidental and not the root cause.
- Recommended action paths (guidance only, no code changes yet):
  1. Immediate validation path: test the model using the bundled legacy repo `server-side/backend/_tmp_yolov5_legacy` and existing `data.yaml`
  2. Medium-term robust path: retrain/finetune with latest `ultralytics` using `server-side/data/datasets/PPE-2/data.yaml`, then use the new compatible weights in app
  3. Alternative path: export legacy model from YOLOv5 (e.g., ONNX) and integrate via a different runtime (requires code changes later)

## Re-Check Result: Current `best.pt` + `data.yaml` (2026-02-26, No Code Changes)
- User requested re-check of current code safety and whether `server-side/backend/models/best.pt` is usable, plus validation of `server-side/data/datasets/PPE-2/data.yaml`.
- Runtime verification (backend venv, backend cwd):
  - `app.vision.ultralytics_runtime.get_model('models/best.pt')` -> success
  - dummy inference via `runtime.predict(...)` on blank frame -> success
  - model names returned = 8 classes (`no-safety-*`, `safety-*`, `welding-glass`)
- This indicates current `best.pt` in repository is now Ultralytics-loadable in the present backend environment (different from prior failure logs).
- `data.yaml` checks:
  - YAML syntax valid
  - `nc: 8` and `names` length 8 match the current `best.pt` embedded class names
  - contains extra `dataset_info` block (generally fine; ignored by trainers/runtimes that do not use it)
  - dataset folder targets (`train/images`, `valid/images`, `test/images`) do not currently exist under `server-side/data/datasets/PPE-2`
- Operational caveat:
  - `data.yaml` is for training/validation dataset config and is not required by current app inference path (`main_vision_model_processor` -> `ultralytics_runtime`)
  - `models/best.pt` path works when backend process cwd is `server-side/backend` (current run scripts usually do this); if backend cwd differs, model resolution may fail
- IDE note:
  - `server-side/data/datasets/PPE-2/data1.yaml` was not found on disk during check (likely unsaved tab or different location)

## `best.pt` Feels Heavy / No Output Diagnosis (2026-02-26, No Code Changes)
- User reported `best.pt` feels very heavy and shows no detections/output, while other models still work.
- Additional local benchmark (backend venv, dummy 720p frame):
  - `models/best.pt`: first load ~24s, subsequent inference ~1.05s/frame on CPU
  - `models/yolov5mu.pt`: first load ~1s, inference ~1.35s/frame on same test
  - `models/yolov5m.pt`: first load ~0.37s, inference ~1.03s/frame
- Key insight:
  - the biggest pain point for `best.pt` is startup/load latency (not per-frame inference speed)
  - `main_vision_model_processor._process_stream()` primes an initial inference before creating the output stream, so long model load makes the node appear stuck/blank at start
- Current `best.pt` class names (from runtime) are 8 classes:
  - `no-safety-glove`, `no-safety-helmet`, `no-safety-shoes`, `no-welding-glass`, `safety-glove`, `safety-helmet`, `safety-shoes`, `welding-glass`
- Likely reasons for "no detections shown" despite stream running:
  - scene/objects do not match this 8-class dataset/domain
  - confidence threshold too high for the camera setup
  - `classes` filter (if set) uses labels from another model and filters everything / raises errors
  - ergonomic check enabled at the same time adds extra load and increases perceived lag
- Reminder:
  - `data.yaml` is not used for inference in current app path; only `model_path` and node parameters affect runtime detection output

## `best.pt` Startup Responsiveness Fix (2026-02-26)
- User requested code fix because `server-side/backend/models/best.pt` causes very slow startup in Main Vision stream mode.
- Root cause in code:
  - `main_vision_model_processor._process_stream()` synchronously resolved classes and primed an initial inference before returning stream outputs, so heavy model load (e.g. `best.pt`) blocked node startup/UI.
- Implemented backend fix in `server-side/backend/app/processors/components/extension/main_vision_model_processor.py`:
  - moved model warmup (and optional class filter resolution) into a background thread
  - removed synchronous prime inference from stream startup path
  - transform stream now returns passthrough frames while model is still warming up
  - initial stream JSON payload includes startup metadata (`startup_status: warming_up`, `startup_deferred: true`)
  - optional ergonomic pose model warmup also runs in background when enabled (without blocking PPE detection if pose model fails)
- Expected effect:
  - node/start UI no longer appears stuck/blank while `best.pt` loads
  - preview stream should appear sooner, detections start after warmup completes
  - first detection with cold model can still be delayed (model load time remains), but responsiveness improves significantly
- Validation:
  - Python compile (`py_compile`) passed for modified processor file
