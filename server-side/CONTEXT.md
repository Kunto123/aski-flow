# Server Side Context

## Last Updated
- Date: 2026-02-25
- Scope: Central server runtime for many clients + OCR/QR display semantics/readability support.

## Canonical Paths
- `server-side/backend`: backend source code.
- `server-side/data`: shared database and runtime server data.

## Responsibility
- Run flow/node execution.
- Manage stream lifecycle and camera/transform cleanup.
- Serve REST + realtime events for clients.
- Host model inference, dataset, annotation, and training endpoints.

## Progress Update (This Cycle)
- Backend environment prepared with Python 3.11 virtualenv:
  - `server-side/backend/.venv`
- Legacy env at workspace root (`D:/ProjectMagang/aiflow/.venv`) is not used by this backend run flow.
- Dependencies installed from `requirements.txt`.
- Runtime smoke test passed:
  - `GET /health` returns `200 {"status":"ok"}` while server is running.
- Local model-file scan helper now enumerates server-side YOLO weights for UI recommendation dropdown.
- Display processor + QR reader semantics refined for QR/OCR dual outputs:
  - Explicit display handle selection is now respected (`output 1` text vs `output 2` preview)
  - QR preview overlay text default changed to OFF (box-only preview clearer by default)
- Streaming processor completion event now emits latest processor output (prevents stale final output overwriting newer streaming text updates)
- QR/OCR stream startup output race fixed:
  - If transform stream emits text immediately during startup, processor now returns the fresher output for the same stream id instead of stale initial payload (`No ... detected`)
- Frontend now also uses existing server stream predictions endpoint as fallback for QR/OCR text visibility when socket updates drop:
  - `GET /stream/<stream_id>/predictions.json` remains the canonical polling endpoint used by UI fallback

## Code Changes (This Cycle)
1. Storage mode detection fix:
   - `is_s3_enabled()` now checks non-empty `S3_BUCKET_NAME`.
   - Prevents false `S3` mode activation when env values are empty strings.
   - File: `server-side/backend/app/env_config.py`
2. Static UI path resolution update:
   - Added canonical path support for `client-side/ui/build` with legacy fallbacks.
   - File: `server-side/backend/app/env_config.py`
3. Local asset URL generation hardening:
   - Uses `BACKEND_HOST/HOST`, `BACKEND_PORT/PORT`, and `USE_HTTPS`.
   - File: `server-side/backend/app/storage/local_storage_strategy.py`
4. Server launcher script added:
   - File: `server-side/run-server.ps1`
5. Root operational guide added:
   - File: `guide.md`
6. Flask 3.1 + Socket.IO compatibility fix:
   - Set `manage_session=False` in SocketIO init to avoid
     `AttributeError: property 'session' of 'RequestContext' object has no setter`
   - File: `server-side/backend/app/flask/socketio_init.py`
7. Local model-file discovery utility added for UI recommendations:
   - Scans common local-first model directories for `.pt` / `.onnx`
   - File: `server-side/backend/app/utils/local_model_files.py`
8. Always-available local model list endpoint added:
   - `GET /node/local-model-files` (registered on `node_blueprint`)
   - File: `server-side/backend/app/flask/app_routes/node_routes.py`
9. Compatibility endpoint added under models routes:
   - `GET /models/local-files` delegates to shared scanner utility
   - File: `server-side/backend/app/flask/app_routes/model_routes.py`
10. Legacy standalone ergonomic dummy processor removed:
   - File deleted: `server-side/backend/app/processors/components/extension/ergonomic_check_processor.py`
11. OCR/QR Display semantic output handling fix:
   - `display` processor now honors explicit selected output index for OCR/QR readers and defaults to text output only when handle is missing/stale
   - File: `server-side/backend/app/processors/components/core/display_processor.py`
12. QR reader preview readability default:
   - `draw_text` overlay default changed from `True` to `False` (still overrideable via node config/env)
   - File: `server-side/backend/app/processors/components/extension/qr_code_reader_processor.py`
13. Async launcher streaming output race fix:
   - Final `progress` event now sends `processor.get_output()` (latest output) instead of stale local return value
   - Prevents QR/OCR stream nodes from reverting to initial `No ... detected` text after a valid streaming decode event
   - File: `server-side/backend/app/processors/launcher/async_processor_launcher.py`
14. QR/OCR stream startup race hardening:
   - `_process_stream()` returns fresher `self.get_output()` when transform thread already produced a newer result for the same stream
   - Files:
     - `server-side/backend/app/processors/components/extension/qr_code_reader_processor.py`
     - `server-side/backend/app/processors/components/extension/ocr_reader_processor.py`

## Validation Status
- Python compile check passed:
  - `.venv\\Scripts\\python.exe -m compileall -q app main.py server.py`
- Health smoke test passed:
  - Startup: `.venv\\Scripts\\python.exe main.py`
  - Check: `http://127.0.0.1:8000/health`
- Socket.IO connect/disconnect smoke test passed via `socketio.test_client`:
  - Connect returns `connected True`
  - Disconnect completes without handler error
- Python compile checks passed for local-model endpoint changes:
  - `py -3.11 -m py_compile server-side/backend/app/flask/app_routes/node_routes.py`
  - `py -3.11 -m py_compile server-side/backend/app/flask/app_routes/model_routes.py`
  - `py -3.11 -m py_compile server-side/backend/app/utils/local_model_files.py`
- Local model scan helper smoke test (cwd=`server-side/backend`) found local weights:
  - Example count: `4` (`models/yolov5mu.pt`, `models/yolov8n-pose.pt`, etc.)
- `models/ppe.pt` compatibility/capability check:
  - File exists (`~14.4 MB`) and checkpoint metadata includes PPE classes:
    `glasses`, `gloves`, `helmet`, `mask`, `safety-shoes`, `vest`
  - Current `ultralytics` runtime load failed with `ModuleNotFoundError: models.yolo`
    (legacy/custom YOLOv5-style checkpoint serialization dependency)
  - Conclusion: class targets match PPE use case, but model is not directly compatible with current runtime without conversion/support path
- `models/ppe.pt` conversion investigation (legacy YOLOv5 -> Ultralytics `.pt`):
  - Loaded checkpoint successfully under temporary YOLOv5 legacy source + `torch.load(..., weights_only=False)`
  - Legacy model type: `models.yolo.DetectionModel`, `nc=6`, names confirmed for PPE classes
  - Rebuild attempt with `ultralytics.nn.tasks.DetectionModel` failed:
    `TypeError: Detect.__init__() ... but 6 were given`
    (legacy YAML `Detect[nc, anchors]` is not forward-compatible with current Ultralytics parser/head)
  - No reliable direct re-export to current Ultralytics `.pt` achieved in this cycle
- Python compile checks passed for OCR/QR display/readability patch:
  - `py -3.11 -m py_compile server-side/backend/app/processors/components/core/display_processor.py`
  - `py -3.11 -m py_compile server-side/backend/app/processors/components/extension/qr_code_reader_processor.py`
- Python compile checks passed for async launcher race fix:
  - `py -3.11 -m py_compile server-side/backend/app/processors/launcher/async_processor_launcher.py`
- Python compile checks passed for QR/OCR startup race hardening:
  - `py -3.11 -m py_compile server-side/backend/app/processors/components/extension/qr_code_reader_processor.py`
  - `py -3.11 -m py_compile server-side/backend/app/processors/components/extension/ocr_reader_processor.py`

## Run Instructions
- First-time setup + run:
  - `powershell -ExecutionPolicy Bypass -File server-side/run-server.ps1 -InstallDeps`
- Normal run:
  - `powershell -ExecutionPolicy Bypass -File server-side/run-server.ps1`

## Next Server Tasks
1. Validate multi-client run ownership and cancel behavior.
2. Verify stream cleanup under concurrent client subscriptions.
3. Execute camera/ROI/Main Vision regression tests on centralized mode.

## Optimization Pass (2026-02-25)
- Implemented backend-side portions of requested 8-point performance optimization pass.
- `server-side/backend/app/streaming/stream_manager.py`
  - lazy JPEG encode only when `mjpeg_clients > 0` (camera and transform loops)
  - MJPEG generator now tracks frame version and avoids redundant resend/poll churn
  - reduces idle wake-ups when no new frame is available
- `server-side/backend/app/processors/components/extension/qr_code_reader_processor.py`
  - stream-mode QR decode limits preprocessing variants per frame (`stream_variant_limit`, env-tunable, safe default)
  - keeps broader variant search for non-stream/single-shot path
- `server-side/backend/app/processors/launcher/async_processor_launcher.py`
  - replaced fixed 0.5s scheduler polling tick with adaptive active/idle sleep intervals
  - lower dependency-chain latency while avoiding hot idle loop
- Validation:
  - `py_compile` passed for modified backend files (`stream_manager.py`, `async_processor_launcher.py`, `qr_code_reader_processor.py`)
- Regression-sensitive behavior intentionally preserved:
  - camera stop/release lifecycle logic not aggressively refactored in this pass
  - stream final output/`isDone` signaling semantics kept intact

## Model Artifact Inspection (2026-02-26, No Code Changes)
- Inspected repository-root `best.pt` and `labels.jpg` to derive a usable `data.yaml`.
- `best.pt` is legacy YOLOv5 checkpoint (`models.yolo.DetectionModel` pickle dependency), so direct load under current environment fails without YOLOv5 legacy modules.
- Confirmed class names from both `labels.jpg` and raw checkpoint bytes:
  - `glasses`, `gloves`, `helmet`, `mask`, `safety-shoes`, `vest`
- Found embedded original dataset YAML reference inside checkpoint bytes:
  - `/content/datasets/PPE-2/data.yaml`
- Note: providing `data.yaml` restores dataset/class metadata, but does not alone convert legacy checkpoint compatibility to current `ultralytics` runtime.

## Model Artifact Relocation + Dataset YAML (2026-02-26, No Code Changes)
- Relocated uploaded PPE artifacts into server-side conventions:
  - model weights: `server-side/backend/models/best.pt`
  - dataset label summary image: `server-side/data/datasets/PPE-2/labels.jpg`
- Created `server-side/data/datasets/PPE-2/data.yaml` with confirmed class names and YOLO dataset keys:
  - `train: train/images`
  - `val: valid/images`
  - `test: test/images`
  - `nc: 6`
  - names = `glasses`, `gloves`, `helmet`, `mask`, `safety-shoes`, `vest`
- Intended usage notes:
  - backend model path for UI/Main Vision can reference `models/best.pt` (relative to backend cwd)
  - dataset YAML is ready but actual dataset image/label folders still need to exist/populate under `server-side/data/datasets/PPE-2`
