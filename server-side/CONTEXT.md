# Server Side Context

## Last Updated
- Date: 2026-02-23
- Scope: Central server runtime for many clients + local model recommendation support.

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

## Run Instructions
- First-time setup + run:
  - `powershell -ExecutionPolicy Bypass -File server-side/run-server.ps1 -InstallDeps`
- Normal run:
  - `powershell -ExecutionPolicy Bypass -File server-side/run-server.ps1`

## Next Server Tasks
1. Validate multi-client run ownership and cancel behavior.
2. Verify stream cleanup under concurrent client subscriptions.
3. Execute camera/ROI/Main Vision regression tests on centralized mode.
