# AI Flow Context Log

## Rule
- This file is the single resume point when chat context is lost.
- Update this file on every assistant reply that changes analysis, code, or next actions.

## Last Updated
- Date: 2026-02-19
- Scope: Follow-up fix for stop requests delayed until page refresh.

## User Goal
- Use `ai-flow-main.zip` as reference base.
- Focus on solving camera still being accessed after node is removed.
- Keep a persistent context file for future continuation.

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
