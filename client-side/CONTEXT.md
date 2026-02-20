# Client Side Context

## Last Updated
- Date: 2026-02-20
- Scope: Thin client for central server.

## Canonical Path
- `client-side/ui`: client UI source code.

## Responsibility
- Flow editor and node wiring UI.
- Trigger run/stop actions to server.
- Render outputs (JSON/text/media/stream) from server responses.
- Subscribe to realtime run events and stream outputs.

## Current Progress
- Node cleanup flow aligned with robust camera-stop behavior.
- ROI node can push live ROI params update without rerun storm.
- Display node rendering improved for fit/contain and no-stretch behavior.
- Output indicator dedup and output-view consistency improved.
- Main Vision node updated for 2-output UX (JSON + scene output).
- Main Vision ergonomic control exposed in node config.

## Known Validation Note
- Existing UI build blocker from prior cycle remains noted:
  - `client-side/ui/src/nodes-configuration/lampControlNode.ts:21`
  - Type mismatch: `"output"` not assignable to `SectionType`.

## Next Client Tasks
1. Validate UI against central-server auth/session flow.
2. Verify realtime sync behavior when many clients open same server.
3. Continue all UI changes only in `client-side/ui`.

