# AI Flow Context Log

## Rule
- This file is the single resume point when chat context is lost.
- Update this file on every assistant reply that changes analysis, code, or next actions.

## Last Updated
- Date: 2026-02-20
- Scope: Main Vision ergonomic-check integration (toggle ON/OFF + skeleton overlay + risk JSON).

## User Goal
- Use `ai-flow-main.zip` as reference base.
- Focus on solving camera still being accessed after node is removed.
- Keep a persistent context file for future continuation.
- New scope (after camera stable): fix ROI box drag so Display updates to latest ROI position.
- Current scope: `main-vision-model` should output only 2 channels (`json` live-state + `image`), follow ROI box changes at runtime, and default model should be `yolov5mu`.

## Checkpoint
- User confirmed camera stream stop behavior is now safe/working.
- Camera fix stack (owner/by-index/global stop + eventlet cooperative MJPEG) is considered checkpoint-stable.
- User confirmed ROI box can now move/update correctly in runtime.
- ROI `x/y/w/h` propagation fix is considered checkpoint-stable.
- User requested ROI display should preserve aspect ratio (no stretch); this mode is now checkpoint-stable.
- New chat context bootstrap prompt in this file is now the standard resume prompt.
- Main Vision patch (2 outputs + ROI-reactive rerun + `yolov5mu` default) is implemented and awaiting runtime confirmation.
- Main Vision lag-reduction patch is implemented and awaiting runtime confirmation.
- Main Vision anti-stutter patch (controlled inference FPS + JPEG quality optimization) is implemented and awaiting runtime confirmation.
- Node auto-run-on-insert guard patch is implemented for ROI and stream-reactive generic processors, awaiting runtime confirmation.
- ROI seamless live-update patch (stable ROI stream + runtime params API) is implemented and awaiting runtime confirmation.
- Erase-output reliability patch + no-auto-run-on-connect guard is implemented and awaiting runtime confirmation.
- ROI node erase-output visibility fix is implemented and awaiting runtime confirmation.
- Stream duplicate-output simplification patch is implemented and awaiting runtime confirmation.
- Output indicator dedup patch is implemented and awaiting runtime confirmation.
- Main Vision JSON summary/output-view patch is implemented and awaiting runtime confirmation.
- Main Vision JSON render classification fix is implemented and awaiting runtime confirmation.
- Main Vision ergonomic-check integration patch is implemented and awaiting runtime confirmation.

## Reference Check
- `d:/ProjectMagang/aiflow/ai-flow-main.zip` extracted to `d:/ProjectMagang/aiflow/ai-flow-main/ai-flow-main`.
- Result: archive does not contain active backend/frontend runtime source used in this workspace (mostly assets/docker/tests).
- Active implementation source remains `d:/ProjectMagang/aiflow/aski-flow`.

## Root Cause Found
- Camera cleanup on node deletion had inconsistent paths:
  - `NodeProvider.removeNode` and `clearNodeOutput` used owner/stream-id stop with global camera stop only as conditional fallback.
  - `Flow.onNodesChange` (keyboard delete path) did not include camera global fallback logic.
- Owner-based stop can return success for non-camera streams and skip fallback even when camera stream is still alive.
- Result: camera handle may remain locked until idle reaper timeout.
- Follow-up from user runtime logs:
  - `create_transform_stream` was still allowed even when source camera stream was already inactive/stopping.
  - This produced transient/stale transform streams and made frontend state recovery look like it required a page restart.
- Latest finding from new user logs:
  - While MJPEG stream is active, cleanup stop requests often appear only after refresh.
  - Root cause candidate: `mjpeg_generator` used blocking `time.sleep()` under eventlet server.
  - In eventlet mode, blocking sleep in long-lived stream handlers can starve/delay other HTTP requests (including `/stream/*/stop`) until stream disconnect.
- ROI issue root cause:
  - Runtime flow serialization used `convertFlowToJson(..., withCoordinates=true, ...)` in `runNode` / `runAllNodes`.
  - ROI processor also uses config keys `x` and `y`.
  - Canvas coordinates (`position.x/y`) overwrote ROI `x/y` during runtime payload generation, so dragging ROI box did not reach backend with correct values.
- Display issue root cause:
  - Display media outputs (image/video/base64) were rendered with content-driven size (`width:100%`, `height:auto`, extra top margins), causing vertical overflow/scroll in bounded display node containers.
  - Display node resize only persisted dimensions on `onResizeEnd`, with limited live layout updates and node internals refresh.
  - Sidebar still exposed both `display` and `text-display` entries although both map to the same `DisplayNode` component.
- Image-processing rerun issue root cause:
  - ROI auto-runs when ROI box changes, but downstream `image-processing` node did not auto-run on upstream stream change.
  - Result: users had to manually rerun `image-processing` to see updated ROI-based output.
- Main vision runtime issue root cause:
  - `main-vision-model` stream mode returned 4 outputs, causing unnecessary output-handle complexity.
  - Downstream runtime from ROI updates required rerun of `main-vision-model`; without auto-run behavior, users could see stale main-vision outputs after ROI changes.
- Main vision lag/delay root cause:
  - Transform stream loop used fixed `sleep(delay)` after each iteration, even when processing already exceeded frame budget; this added unnecessary extra latency.
  - Transform loop performed an extra frame copy (`source_frame.copy()`) although frame was already copied in `get_latest_frame()`.
  - Main Vision stream inference default settings were not tuned for realtime responsiveness (`stream_fps`/`imgsz` not exposed).
- Main vision stutter root cause (follow-up):
  - YOLO inference still ran on every transform frame, which is too heavy on CPU and causes frame pacing collapse.
  - MJPEG encode quality default was relatively high and added encoding overhead under load.
- ROI seamlessness root cause (latest):
  - ROI drag/resize previously triggered frequent `run_node` executions.
  - Each ROI stream run recreated transform stream IDs, which forced downstream reruns and caused visible stutter/non-seamless updates.
- Erase output reliability root cause (latest):
  - Some nodes appeared unchanged after erase because reactive auto-run re-triggered immediately after `outputData` was cleared.
  - Display node also prioritizes upstream connected output, so clearing Display's own output alone did not blank the view.
- Surprise auto-run root cause (latest):
  - Auto-run logic on ROI / stream-reactive generic nodes still triggered on input wiring/upstream signature change even before users intentionally ran the node.
- Duplicate stream output root cause (latest):
  - Several stream processors emitted both `stream://<id>` and `/stream/<id>.mjpg` as separate outputs.
  - This created unnecessary multi-output handles and UX confusion because both values referenced the same underlying stream.
- Output indicator duplication root cause (latest):
  - Some nodes/legacy states still exposed duplicate-equivalent values in `outputData`.
  - UI output selector dots counted raw array length, so duplicate-equivalent outputs still appeared as 2 dots.
- Main Vision output utility root cause (latest):
  - Main Vision stream JSON output previously focused on runtime metadata (`live`, `predictions_url`, `stream_id`) and was less usable directly for `conditional-state` / `python-code`.
  - Multi-output selector dots for Main Vision were noisy for users who wanted a single output-view entry with multiline content.
- Main Vision display error root cause (latest):
  - Output type detection treated any string containing `/stream/` as stream image URL.
  - Main Vision JSON payload contains `predictions_url` with `/stream/...`, so JSON was wrongly rendered as image and showed `Expired URL`.
- Main Vision ergonomic scope root cause (latest):
  - Existing `ergonomic-check` node was still dummy placeholder and not integrated with runtime detection output.
  - User needs ergonomic analysis attached directly to `main-vision-model` so one node can output both detection state and posture-injury risk state.

## Changes Implemented
1. Backend stream manager:
   - Added `stop_camera_streams_by_index(camera_index)` in:
     - `packages/backend/app/streaming/stream_manager.py`
2. Backend route:
   - Added `POST /stream/camera/by-index/stop` in:
     - `packages/backend/app/flask/app_routes/stream_routes.py`
   - Request body: `{ "camera_index": <int> }`
3. Frontend API:
   - Added `stopCameraStreamsByIndex(cameraIndex)` in:
     - `packages/ui/src/api/stream.ts`
4. Frontend cleanup flow:
   - Updated camera cleanup to call stop by index first, then global fallback if needed:
     - `packages/ui/src/providers/NodeProvider.tsx`
     - `packages/ui/src/components/Flow.tsx`
5. Follow-up hardening (from new logs):
   - Backend: reject transform stream creation when source stream is inactive/stopping:
     - `packages/backend/app/streaming/stream_manager.py` (`create_transform_stream`)
   - Frontend: move delete cleanup to `onNodesDelete` callback (more reliable than remove diff parsing in `onNodesChange`):
     - `packages/ui/src/components/Flow.tsx`
   - Frontend: broaden camera-node detection (not only strict `processorType === "camera-input"`):
     - `packages/ui/src/components/Flow.tsx`
     - `packages/ui/src/providers/NodeProvider.tsx`
6. Eventlet concurrency fix:
   - Added cooperative sleep helper in stream manager (`_cooperative_sleep`) that uses `eventlet.sleep` when available.
   - Replaced blocking sleeps in `mjpeg_generator` with cooperative sleep calls.
   - File:
     - `packages/backend/app/streaming/stream_manager.py`
7. ROI runtime serialization fix:
   - Updated runtime execution payload generation to disable coordinate injection:
     - `packages/ui/src/providers/NodeProvider.tsx`
   - Changed:
     - `runNode`: `convertFlowToJson(..., false, true)`
     - `runAllNodes`: `convertFlowToJson(..., false, true)`
   - Reason: prevent collision between canvas `x/y` and ROI config `x/y`.
8. Display node improvements:
   - Added fit mode for output renderer (`fitInContainer`) and applied it in `DisplayNode`.
   - Updated media outputs to support container-fit rendering (image/video/base64):
     - `packages/ui/src/components/nodes/node-output/ImageUrlOutput.tsx`
     - `packages/ui/src/components/nodes/node-output/VideoUrlOutput.tsx`
     - `packages/ui/src/components/nodes/node-output/ImageBase64Output.tsx`
   - Updated markdown output to support full-height scroll region in fit mode:
     - `packages/ui/src/components/nodes/node-output/MarkdownOutput.tsx`
   - Updated output wrapper behavior for fit mode:
     - `packages/ui/src/components/nodes/node-output/OutputDisplay.tsx`
   - Improved display node resize behavior:
     - live dimension update during resize (`onResize`)
     - persistent save on resize end (`onResizeEnd`)
     - explicit min dimensions and node internals refresh on dimension changes
     - `packages/ui/src/components/nodes/DisplayNode.tsx`
9. Display/Text node consolidation:
   - Sidebar/output section now exposes only one display entry:
     - `packages/ui/src/nodes-configuration/sectionConfig.ts`
   - Backward compatibility kept for existing flows with `text-display` type via mapping in:
     - `packages/ui/src/utils/mappings.tsx`
10. ROI fill-to-fit in Display:
   - Added output fit mode plumbing (`contain` / `cover` / `fill`) in output renderer:
     - `packages/ui/src/components/nodes/node-output/OutputDisplay.tsx`
   - Updated media outputs to honor `fitMode` when displayed in container-fit mode:
     - `packages/ui/src/components/nodes/node-output/ImageUrlOutput.tsx`
     - `packages/ui/src/components/nodes/node-output/VideoUrlOutput.tsx`
     - `packages/ui/src/components/nodes/node-output/ImageBase64Output.tsx`
   - Display now detects ROI as upstream source and switches fit mode to `fill`:
     - `packages/ui/src/components/nodes/DisplayNode.tsx`
11. ROI display mode adjustment (latest request):
   - Updated Display rendering to keep ROI aspect ratio while scaling to available Display area.
   - Disabled stretch/fill behavior for ROI by enforcing `fitMode="contain"` in Display node.
   - File:
     - `packages/ui/src/components/nodes/DisplayNode.tsx`
12. Image-processing reactive auto-run:
   - Added targeted auto-run logic in generic node component for `processorType === "image-processing"`.
   - Trigger condition:
     - upstream input signature changed (including ROI stream output change), and
     - node has downstream connections, and
     - node is not currently running.
   - Also includes processing parameter fingerprint (`resize_*`, `grayscale`, `blur`, `threshold`) so parameter changes retrigger processing.
   - File:
     - `packages/ui/src/components/nodes/GenericNode.tsx`
13. Main Vision output simplification (stream mode):
   - Reduced stream outputs from 4 to 2 only:
     - output[0]: JSON live-state payload (`mode`, `live`, `predictions_url`, `stream_id`)
     - output[1]: image stream reference (`stream://<overlay_stream_id>`)
   - File:
     - `packages/backend/app/processors/components/extension/main_vision_model_processor.py`
14. Main Vision ROI-reactive auto-run:
   - Extended generic auto-run behavior to include `processorType === "main-vision-model"`.
   - Trigger condition:
     - upstream signature changed (including ROI stream ref changes), and
     - node has downstream connections OR already has existing output, and
     - node is not currently running.
   - Parameter fingerprint includes `model_path`, `conf_threshold`, `classes`.
   - File:
     - `packages/ui/src/components/nodes/GenericNode.tsx`
15. Default YOLO model updated to `yolov5mu`:
   - Frontend node default:
     - `packages/ui/src/nodes-configuration/mainVisionModelNode.ts` (`models/yolov5mu.pt`)
   - Backend defaults:
     - `packages/backend/app/processors/components/extension/main_vision_model_processor.py`
     - `packages/backend/app/vision/ultralytics_runtime.py`
16. Transform loop realtime pacing optimization:
   - Removed extra frame copy in `_transform_loop`.
   - Replaced fixed post-process sleep with elapsed-aware pacing (`sleep only remaining frame budget`).
   - Replaced fallback sleeps with cooperative sleep helper.
   - File:
     - `packages/backend/app/streaming/stream_manager.py`
17. Main Vision realtime tuning parameters:
   - Added `stream_fps` (default `12`) and `imgsz` (default `512`) to Main Vision node config.
   - Backend now consumes these parameters and applies them in stream/file inference.
   - `create_transform_stream(..., fps=stream_fps)` now used for main vision stream.
   - File:
     - `packages/ui/src/nodes-configuration/mainVisionModelNode.ts`
     - `packages/backend/app/processors/components/extension/main_vision_model_processor.py`
     - `packages/backend/app/vision/ultralytics_runtime.py`
18. Main Vision auto-run fingerprint update:
   - Added `stream_fps` and `imgsz` into auto-run parameter signature so changes retrigger run immediately.
   - File:
     - `packages/ui/src/components/nodes/GenericNode.tsx`
19. MJPEG anti-buffering response headers:
   - Added no-cache / no-buffer headers to stream endpoint to reduce display latency caused by buffering:
     - `Cache-Control: no-cache, no-store, must-revalidate`
     - `Pragma: no-cache`
     - `Expires: 0`
     - `X-Accel-Buffering: no`
   - File:
     - `packages/backend/app/flask/app_routes/stream_routes.py`
20. Main Vision controlled inference rate:
   - Added `inference_fps` parameter (default `6`) so YOLO inference is not executed on every displayed frame.
   - Stream transform now:
     - runs inference only at `inference_fps`,
     - reuses latest predictions between inference ticks,
     - still renders output at `stream_fps`.
   - Files:
     - `packages/backend/app/processors/components/extension/main_vision_model_processor.py`
     - `packages/ui/src/nodes-configuration/mainVisionModelNode.ts`
     - `packages/ui/src/components/nodes/GenericNode.tsx`
21. Stream JPEG encoding optimization:
   - Added configurable JPEG quality in stream manager (`ASKI_STREAM_JPEG_QUALITY`, default `80`, clamped `30..95`).
   - Camera and transform loops now use shared JPEG encoder helper with this quality.
   - File:
     - `packages/backend/app/streaming/stream_manager.py`
22. Runtime defaults tuned in backend env (for immediate smoother behavior):
   - Added:
     - `ASKI_MAIN_VISION_STREAM_FPS=10`
     - `ASKI_MAIN_VISION_INFERENCE_FPS=5`
     - `ASKI_MAIN_VISION_IMGSZ=416`
     - `ASKI_STREAM_JPEG_QUALITY=70`
   - File:
     - `packages/backend/.env`
23. Node initial auto-run guard (latest request):
   - Prevented first-mount auto-run so nodes do not execute immediately when first inserted on canvas.
   - Kept reactive auto-run behavior for subsequent user-driven input/upstream changes.
   - Files:
     - `packages/ui/src/components/nodes/GenericNode.tsx`
     - `packages/ui/src/components/nodes/RoiNode.tsx`
24. ROI seamless live stream update (latest request):
   - Backend stream manager now supports mutable per-stream runtime params (`runtime_params`) and stream tagging (`stream_tag`).
   - Added ROI runtime update route:
     - `POST /stream/<stream_id>/roi/params`
     - Body supports: `x`, `y`, `w`, `h`, `width`, `height`.
   - ROI stream processor now:
     - creates transform stream with `stream_tag="roi"` and initial params,
     - reads latest runtime params each frame (no stream recreation needed for ROI moves).
   - Frontend ROI node now:
     - updates ROI stream params live (throttled) while drag/resize,
     - avoids auto-rerun-on-every-ROI-param-change for stream input mode.
   - Files:
     - `packages/backend/app/streaming/stream_manager.py`
     - `packages/backend/app/flask/app_routes/stream_routes.py`
     - `packages/backend/app/processors/components/extension/roi_processor.py`
     - `packages/ui/src/api/stream.ts`
     - `packages/ui/src/components/nodes/RoiNode.tsx`
25. Erase-output reliability + no-auto-run-on-connect (latest request):
   - Added `outputClearedAt` marker on node clear actions (`clearNodeOutput` / `clearAllOutput`) so clear state is explicit in node data.
   - Display now respects `outputClearedAt` and temporarily blocks stale upstream rendering until upstream is rerun after clear.
   - Updated auto-run guards:
     - `GenericNode` (`image-processing`, `main-vision-model`) now auto-runs only if node already has existing output.
     - `RoiNode` now auto-runs only if node already has existing output.
   - Effect: connecting a fresh input no longer auto-runs these nodes unexpectedly; clear output no longer instantly re-runs and repopulates output.
   - Files:
     - `packages/ui/src/providers/NodeProvider.tsx`
     - `packages/ui/src/components/nodes/DisplayNode.tsx`
     - `packages/ui/src/components/nodes/GenericNode.tsx`
     - `packages/ui/src/components/nodes/RoiNode.tsx`
26. ROI erase-output visibility fix (latest):
   - ROI preview panel now respects `outputClearedAt` and stays hidden after erase until node is rerun.
   - This removes confusion where ROI looked like it still had output because source preview stayed visible.
   - File:
     - `packages/ui/src/components/nodes/RoiNode.tsx`
27. Stream output simplification (latest request):
   - Stream processors now emit a single canonical output (`stream://<id>`) instead of duplicate URL pair.
   - Applied to:
     - `camera-input`
     - `image-processing` (stream mode)
     - `roi` (stream mode)
     - `face-recognition` (stream mode; now `[stream_ref, json_payload]`)
     - `ocr-reader` (stream mode; now `[stream_ref, json_payload]`)
     - `qr-code-reader` (stream mode; now `[stream_ref, json_payload]`)
   - Added backward compatibility for old flows that still reference removed output indexes:
     - old `index=1` on single-stream nodes maps to `index=0`
     - old `index=2` on `(stream_ref, json)` nodes maps to `index=1`
   - Files:
     - `packages/backend/app/processors/components/core/camera_input_processor.py`
     - `packages/backend/app/processors/components/extension/image_processing_processor.py`
     - `packages/backend/app/processors/components/extension/roi_processor.py`
     - `packages/backend/app/processors/components/extension/face_recognition_processor.py`
     - `packages/backend/app/processors/components/extension/ocr_reader_processor.py`
     - `packages/backend/app/processors/components/extension/qr_code_reader_processor.py`
     - `packages/backend/app/processors/components/processor.py`
28. UI output-dot deduplication (latest request):
   - Output selector dots are now computed from normalized + deduplicated outputs.
   - Equivalent stream outputs (e.g. `stream://id` and `/stream/id.mjpg`) collapse into one dot/view entry.
   - Applied in output renderer so legacy duplicated outputs no longer show multiple dots if content is effectively the same.
   - File:
     - `packages/ui/src/components/nodes/node-output/OutputDisplay.tsx`
29. Main Vision output redesign (latest request):
   - Main Vision output remains 2 types:
     - output[0]: JSON code with detection summary + detections list (usable by `conditional-state` and `python-code`)
     - output[1]: scene condition output (existing overlay image/stream)
   - Stream mode JSON now includes:
     - `detection_summary` (`total_detections`, `counts_by_label`, `labels_detected`)
     - `detections` list (`label`, `confidence`, `position`)
     - runtime metadata (`live`, `predictions_url`, `stream_id`)
   - Added initial inference priming in stream mode so first JSON is meaningful right after run.
   - Main Vision output panel now uses one yellow selector-dot visual while showing combined content (JSON + scene output) in one view.
   - Files:
     - `packages/backend/app/processors/components/extension/main_vision_model_processor.py`
     - `packages/ui/src/components/nodes/node-output/OutputDisplay.tsx`
30. Main Vision JSON classification fix (latest):
   - Tightened `isStreamUrl` detection to only accept true stream refs/endpoints (`stream://...` or `/stream/<id>.mjpg|.mjpeg` URLs).
   - Prevents JSON text containing `/stream/` substring from being treated as image output.
   - File:
     - `packages/ui/src/components/nodes/node-output/outputUtils.ts`
31. Main Vision ergonomic-check integration (latest request):
   - Added ergonomic posture analysis into `main-vision-model` with ON/OFF control:
     - `enable_ergonomic_check` (switch)
     - `ergonomic_pose_model_path` (default `models/yolov8n-pose.pt`)
     - `ergonomic_min_keypoint_conf` (default `0.35`)
   - Backend `main-vision-model` now, when enabled:
     - runs pose inference (YOLO pose model),
     - computes ergonomic risk summary per person (`risk_score`, `risk_level`, issues, pose label),
     - overlays skeleton + ergonomic risk label on output frame,
     - injects ergonomic JSON object into output[0] payload.
   - Added reusable ergonomic utilities:
     - `assess_ergonomic_risk(...)`
     - `draw_skeleton_overlay(...)`
   - Added Ultralytics runtime pose helper:
     - `predict_pose(...)`
   - Files:
     - `packages/backend/app/processors/components/extension/main_vision_model_processor.py`
     - `packages/backend/app/vision/ultralytics_runtime.py`
     - `packages/backend/app/vision/ergonomic_utils.py`
     - `packages/backend/app/vision/__init__.py`
     - `packages/ui/src/nodes-configuration/mainVisionModelNode.ts`
     - `packages/ui/src/components/nodes/GenericNode.tsx`

## Current Behavior After Patch
- When a camera node is removed/cleared (including keyboard delete path), UI now attempts:
  1. stop by owner
  2. stop explicit stream IDs
  3. stop camera stream(s) by `camera_index`
  4. fallback `stopAllCameraStreams()` only if still not stopped
- This reduces cases where webcam remains locked after node deletion.
- Additional guard:
  - Backend now prevents creation of new transform streams from stale/inactive source stream IDs.
  - This avoids race cases seen in logs where transform stream was created after camera entered stop flow.
- Eventlet serving behavior improvement:
  - MJPEG handler now yields cooperatively, so stop endpoints should be processed immediately while stream is still active (without waiting page refresh/disconnect).
- ROI behavior expectation after patch:
  - Dragging ROI box updates `x/y/w/h` that are sent correctly to backend on runtime run.
  - Display downstream should reflect latest ROI position instead of sticking to initial crop.
- Display behavior expectation after patch:
  - Media content in Display node fits the node viewport without causing node-level scroll.
  - Resize interaction feels more stable and updates content layout live while dragging.
  - Sidebar contains a single Display node entry for both text and video/image outputs.
- ROI on Display expectation after patch:
  - ROI output scales to fit Display area while preserving original aspect ratio (no stretching).
- Image-processing expectation after patch:
  - In ROI -> image-processing pipelines, changing ROI box should automatically retrigger image-processing and refresh downstream output without manual rerun.
- Main Vision expectation after patch:
  - Stream mode now exposes only 2 outputs (JSON live-state + image stream).
  - In ROI -> Main Vision pipelines, ROI move/resize should retrigger main-vision processing automatically so output stays updated at runtime.
  - Default model path for new Main Vision nodes is `models/yolov5mu.pt`.
- Main Vision lag expectation after patch:
  - Overlay stream should feel more responsive (reduced end-to-end delay).
  - Default realtime tuning for new Main Vision nodes:
    - `stream_fps = 12`
    - `inference_fps = 6`
    - `imgsz = 512`
  - Users can further tune these fields per node for speed/accuracy tradeoff.
- Main Vision anti-stutter expectation after patch:
  - Reduced patah-patah under CPU load because inference frequency is decoupled from display frame frequency.
  - Better smoothness/throughput due lighter JPEG encoding.
  - Global runtime tuning now defaults to lower load values via backend `.env`.
- Node run logic expectation after patch (latest):
  - Adding a new ROI / Image Processing / Main Vision node to canvas does not trigger immediate auto-run on initial mount.
  - Auto-run still works on later user-driven changes (e.g. input value updates, upstream output/signature changes).
- ROI seamless expectation after patch (latest):
  - In stream pipelines (e.g., Camera -> ROI -> Display / Image Processing / Main Vision), moving/resizing ROI updates crop live without rerunning ROI/downstream nodes.
  - ROI output stream ID should remain stable while only ROI box parameters change.
  - Downstream nodes continue consuming updated frames from the same stream reference.
- Erase output expectation after patch (latest):
  - Erasing output on nodes should visibly clear output state and not be immediately overwritten by auto-run side effects.
  - Erasing Display output should blank Display even when connected, until upstream is rerun.
- Connect-input expectation after patch (latest):
  - Connecting input handles to upstream outputs should not auto-run ROI / Image Processing / Main Vision when the target node has never produced output yet.
  - Reactive auto-run remains active only for nodes that already have output history.
- ROI erase-output expectation after patch (latest):
  - After `erase output` on ROI node, ROI preview panel is blank.
  - ROI preview appears again only after node is run and produces fresh output.
- Stream output expectation after patch (latest):
  - Camera Input, Image Processing (stream), and ROI (stream) expose only one output handle/value.
  - Nodes with stream+JSON outputs no longer include duplicate MJPEG URL output.
  - Display/downstream rendering still works because `stream://<id>` is normalized to stream URL in UI.
- Output-dot expectation after patch (latest):
  - If multiple raw outputs resolve to the same effective value, only one yellow selector dot is shown.
  - Dot count now reflects unique rendered outputs, not raw duplicated array entries.
- Main Vision output expectation after patch (latest):
  - Main Vision provides exactly two output types (JSON summary + scene output) as requested.
  - JSON output can be consumed directly by `conditional-state` (`json_path`) and `python-code` nodes.
  - Main Vision output panel shows a single yellow selector-dot visual and combined output view (no noisy multi-dot switching).
- Main Vision display expectation after fix (latest):
  - On Display node, Main Vision JSON output is rendered as text/code, not as image.
  - Selecting JSON output should no longer show `Expired URL`.
- Main Vision ergonomic expectation after patch (latest):
  - Ergonomic analysis can be toggled ON/OFF directly from Main Vision node.
  - When ON, overlay output includes person skeleton and ergonomic risk label.
  - JSON output includes ergonomic summary + per-person risk details for downstream `conditional-state` / `python-code` usage.
  - If pose model file is missing locally, detection still runs and ergonomic JSON includes error status instead of crashing node execution.

## Validation Status
- Static code update completed.
- Python syntax check passed:
  - `python -m py_compile packages/backend/app/streaming/stream_manager.py packages/backend/app/flask/app_routes/stream_routes.py`
- Frontend full build currently blocked by pre-existing unrelated TypeScript error:
  - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`
  - Error: `Type '"output"' is not assignable to type 'SectionType'`
- Runtime verification still pending (manual UI test needed).
- Follow-up validation:
  - Re-ran frontend build after follow-up patch; still only the same unrelated `lampControlNode.ts` error.
- Latest validation:
  - Python syntax check still passes after cooperative-sleep patch:
    - `python -m py_compile packages/backend/app/streaming/stream_manager.py`
- ROI patch validation:
  - Static code update completed; runtime verification pending user test for ROI drag-update.
- Display patch validation:
  - Static code update completed.
  - Frontend build remains blocked only by pre-existing unrelated error:
    - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`
- ROI fill-to-fit validation:
  - Static code update completed; runtime verification pending user test.
- ROI no-stretch validation:
  - Static code update completed; runtime verification pending user test.
- Image-processing auto-run validation:
  - Static code update completed; runtime verification pending user test.
- Main Vision patch validation:
  - Static code update completed.
  - Python syntax check passed:
    - `python -m py_compile packages/backend/app/processors/components/extension/main_vision_model_processor.py packages/backend/app/vision/ultralytics_runtime.py`
  - Frontend build remains blocked only by pre-existing unrelated error:
    - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`
- Main Vision lag patch validation:
  - Python syntax check passed:
    - `python -m py_compile packages/backend/app/streaming/stream_manager.py packages/backend/app/processors/components/extension/main_vision_model_processor.py packages/backend/app/vision/ultralytics_runtime.py`
    - `python -m py_compile packages/backend/app/flask/app_routes/stream_routes.py`
  - Frontend build remains blocked only by pre-existing unrelated error:
    - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`
- Main Vision anti-stutter patch validation:
  - Python syntax check passed:
    - `python -m py_compile packages/backend/app/processors/components/extension/main_vision_model_processor.py packages/backend/app/streaming/stream_manager.py`
  - Frontend build remains blocked only by pre-existing unrelated error:
    - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`
- Node initial auto-run guard validation:
  - Static code update completed.
  - Frontend build remains blocked only by pre-existing unrelated error:
    - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`
- ROI seamless live-update validation:
  - Python syntax check passed:
    - `python -m py_compile packages/backend/app/streaming/stream_manager.py packages/backend/app/flask/app_routes/stream_routes.py packages/backend/app/processors/components/extension/roi_processor.py`
  - Frontend build remains blocked only by pre-existing unrelated error:
    - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`
- Erase-output + connect-input guard validation:
  - Static code update completed.
  - Frontend build remains blocked only by pre-existing unrelated error:
    - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`
- ROI erase-output visibility fix validation:
  - Static code update completed.
  - Frontend build remains blocked only by pre-existing unrelated error:
    - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`
- Stream output simplification validation:
  - Python syntax check passed:
    - `python -m py_compile packages/backend/app/processors/components/core/camera_input_processor.py packages/backend/app/processors/components/extension/image_processing_processor.py packages/backend/app/processors/components/extension/roi_processor.py packages/backend/app/processors/components/extension/face_recognition_processor.py packages/backend/app/processors/components/extension/ocr_reader_processor.py packages/backend/app/processors/components/extension/qr_code_reader_processor.py packages/backend/app/processors/components/processor.py`
  - Frontend build status unchanged (same unrelated error):
    - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`
- Output-dot dedup validation:
  - Static code update completed.
  - Frontend build status unchanged (same unrelated error):
    - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`
- Main Vision output redesign validation:
  - Python syntax check passed:
    - `python -m py_compile packages/backend/app/processors/components/extension/main_vision_model_processor.py`
  - Frontend build status unchanged (same unrelated error):
    - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`
- Main Vision JSON classification fix validation:
  - Static code update completed.
  - Frontend build status unchanged (same unrelated error):
    - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`
- Main Vision ergonomic integration validation:
  - Python syntax check passed:
    - `python -m py_compile packages/backend/app/processors/components/extension/main_vision_model_processor.py packages/backend/app/vision/ultralytics_runtime.py packages/backend/app/vision/ergonomic_utils.py packages/backend/app/vision/__init__.py`
  - Frontend build status unchanged (same unrelated error):
    - `packages/ui/src/nodes-configuration/lampControlNode.ts:21`

## Worktree Notes
- Repository already had unrelated local changes before this patch, including:
  - `packages/backend/app/processors/launcher/*.py`
  - `packages/backend/app/processors/runtime/` (untracked)
- Camera fix changes were limited to stream routes/manager + UI stream cleanup + this context file.

## Next Suggested Verification
1. Start backend and UI.
2. Add Camera Input node (`camera_index=0`), run, verify stream active.
3. Delete node using:
   - node action menu/button
   - keyboard delete/backspace
4. Confirm webcam LED/device is released immediately.
5. Run Main Vision node from stream input, then delete/re-add camera node quickly to test race.
6. Confirm in `/stream/debug`:
   - no `create_transform_stream` against inactive camera source
   - presence of cleanup event (`stop_camera_streams_by_index` or `stop_camera_streams`)
7. Verify no-refresh stop:
   - Keep camera preview open, then delete/clear camera node.
   - Expected: immediate stop events appear (without pressing refresh), followed by `camera_loop_stopped`.
8. Verify ROI drag propagation:
  - Build chain: Camera -> ROI -> Display.
  - Run once, then drag ROI box to a clearly different area.
  - Expected: Display crop updates to new area without page refresh.
9. Verify Display layout/resize:
   - Connect image and video outputs to Display node.
   - Resize Display node smaller/larger repeatedly.
   - Expected: media remains contained without node scrollbars.
10. Verify Display consolidation:
   - Open sidebar output section.
   - Expected: only one Display entry shown (no separate Text/JSON Display entry).
11. Verify ROI fill-to-fit:
  - Build chain: Camera -> ROI -> Display.
  - Resize Display to a non-native aspect ratio.
   - Expected: ROI output scales with preserved aspect ratio (no stretch).
12. Verify image-processing auto-rerun:
   - Build chain: Camera -> ROI -> Image Processing -> Display.
   - Move/resize ROI box repeatedly.
   - Expected: image-processing output updates automatically after ROI change, without pressing run on image-processing node.
13. Verify main-vision output count + ROI reactive rerun:
   - Build chain: Camera -> ROI -> Main Vision Model -> Display.
   - Run flow, then inspect Main Vision output selector.
   - Expected: only 2 outputs shown (`json` payload + image stream).
   - Move/resize ROI box repeatedly.
   - Expected: Main Vision reruns automatically and Display updates without manual rerun.
14. Verify default model:
   - Add new Main Vision node.
   - Expected default `model_path` value: `models/yolov5mu.pt`.
15. Verify main-vision lag reduction:
   - Build chain: Camera -> ROI -> Main Vision Model -> Display.
   - Observe live movement latency before/after patch.
   - Expected: reduced delay and more stable realtime feel.
   - Tune `stream_fps` (`8-15`) and `imgsz` (`384-640`) if device is slower/faster.
16. Verify anti-stutter tuning:
   - On Main Vision node set:
     - `stream_fps = 10..12`
     - `inference_fps = 4..8`
     - `imgsz = 384..512`
   - Expected: smoother stream (less patah-patah) with acceptable detection refresh.
17. Verify node does not auto-run on insert:
   - Add ROI / Image Processing / Main Vision node to canvas (without pressing Run).
   - Expected: node does not start processing on initial insert/mount.
   - Then change input (connect upstream or edit `input_url`/params).
   - Expected: auto-run can trigger on subsequent user-driven changes.
18. Verify ROI seamless live update (no rerun storm):
   - Build chain: Camera -> ROI -> Display (and optionally -> Image Processing / Main Vision -> Display).
   - Run flow once until ROI output stream exists.
   - Move/resize ROI box continuously.
   - Expected:
     - Display/downstream output updates smoothly without repeatedly pressing run.
     - ROI stream ID remains unchanged while dragging.
     - `/stream/debug` shows `update_stream_runtime_params` events for ROI stream updates.
19. Verify erase output on each node type:
   - Test clear output on ROI, Image Processing, Main Vision, and Display nodes.
   - Expected:
     - output clears immediately,
     - no immediate auto-rerun repopulating output unless user runs again.
   - For Display:
     - after clear, display area becomes empty even with incoming connection,
     - display shows again only after upstream rerun/new output.
20. Verify no surprise run on connect:
   - Add fresh ROI / Image Processing / Main Vision node (never run), then connect inputs.
   - Expected: node does not auto-run only due connection.
   - Run node once manually, then change upstream signature.
   - Expected: reactive auto-run works for subsequent updates.
21. Verify ROI erase visibility:
   - Run ROI once (Camera -> ROI -> Display), ensure preview active.
   - Click `erase output` on ROI.
   - Expected: ROI preview panel becomes blank with erase message.
   - Run ROI again.
   - Expected: ROI preview appears again.
22. Verify single-output stream nodes:
   - Run Camera Input node.
   - Expected: only one output handle/value shown (`stream://...` equivalent render path).
   - Chain Camera -> ROI -> Image Processing -> Display.
   - Expected: ROI and Image Processing stream nodes each show one output only; pipeline remains functional.
23. Verify backward compatibility on old flows:
   - Load flow that previously connected to removed duplicate output index (camera/image-processing/roi index 1, or face/ocr/qr index 2).
   - Expected: data still flows due backend key fallback mapping.
24. Verify output-dot dedup:
   - Open nodes that previously showed 2 identical-equivalent outputs.
   - Expected: only 1 yellow output selector dot shown when outputs are effectively the same.
25. Verify Main Vision JSON summary + scene output:
   - Build chain: Camera -> ROI -> Main Vision -> Display.
   - Run Main Vision and inspect output panel.
   - Expected:
     - JSON contains `detection_summary` and `detections`.
     - Scene output remains visible as existing overlay stream/image.
26. Verify Main Vision JSON downstream usage:
   - Connect Main Vision output to `conditional-state` or `python-code`.
   - Expected: JSON can be parsed directly (`json.loads`) and used for conditions (e.g. `detection_summary.total_detections`).
27. Verify Main Vision yellow-dot simplification:
   - Inspect Main Vision output panel selector indicator.
   - Expected: single yellow-dot visual while combined output content remains available in one panel.
28. Verify Main Vision JSON on Display is not expired:
   - Connect Main Vision output to Display.
   - Switch to JSON output in Display.
   - Expected: JSON text/code is shown; no `Expired URL`.
29. Verify Main Vision ergonomic ON/OFF behavior:
   - Build chain: Camera -> Main Vision -> Display.
   - Run with `enable_ergonomic_check = OFF`.
   - Expected: output behaves like regular detection (no skeleton, `ergonomic.enabled=false` in JSON).
   - Turn `enable_ergonomic_check = ON` and rerun.
   - Expected: skeleton + ergonomic label drawn on person; JSON contains `ergonomic.risk_summary` and `ergonomic.people[*].assessment`.
30. Verify local pose model fallback behavior:
   - Set `enable_ergonomic_check = ON` with missing pose model path.
   - Expected: node still returns detection output; JSON ergonomic section has `status=error` with message about missing model (no hard crash).

## New Chat Bootstrap Prompt
- Use this prompt in a new chat to restore context quickly:
  - "Baca `d:/ProjectMagang/aiflow/aski-flow/CONTEXT.md` sebagai sumber konteks utama proyek ini. Lanjutkan dari checkpoint terbaru tanpa mengulang pekerjaan yang sudah selesai. Fokus pada task yang saya minta setelah ini, dan update kembali `CONTEXT.md` setiap jawaban."
