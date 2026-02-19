# AI Flow Context Log

## Rule
- This file is the single resume point when chat context is lost.
- Update this file on every assistant reply that changes analysis, code, or next actions.

## Last Updated
- Date: 2026-02-19
- Scope: Main Vision Model output simplification (2 outputs), ROI-runtime reactive update, default model `yolov5mu`.

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

## New Chat Bootstrap Prompt
- Use this prompt in a new chat to restore context quickly:
  - "Baca `d:/ProjectMagang/aiflow/aski-flow/CONTEXT.md` sebagai sumber konteks utama proyek ini. Lanjutkan dari checkpoint terbaru tanpa mengulang pekerjaan yang sudah selesai. Fokus pada task yang saya minta setelah ini, dan update kembali `CONTEXT.md` setiap jawaban."
