# Server Side Context

## Last Updated
- Date: 2026-02-20
- Scope: Central server runtime for many clients.

## Canonical Paths
- `server-side/backend`: backend source code.
- `server-side/data`: shared database and runtime server data.

## Responsibility
- Run flow/node execution.
- Manage stream lifecycle and camera/transform cleanup.
- Serve REST + realtime events for clients.
- Host model inference, dataset, annotation, and training endpoints.

## Current Progress
- Camera stop reliability hardened (owner/index/global cleanup path).
- Eventlet stream responsiveness improved with cooperative sleep.
- ROI stream params can be updated live via `POST /stream/<stream_id>/roi/params`.
- Main Vision stream pipeline optimized (controlled inference FPS, stream FPS, image size tuning).
- Main Vision now supports ergonomic analysis integration (toggle + JSON summary).
- Stream outputs simplified to canonical `stream://<id>` where applicable.

## Current Validation Note
- Python compile checks for key backend modules passed in previous cycle.
- Manual runtime verification for final multi-client scenario is still pending.

## Next Server Tasks
1. Validate multi-client run ownership and cancellation behavior.
2. Verify stream subscribe/unsubscribe cleanup under concurrent clients.
3. Finalize API contract for central auth/session handling.

