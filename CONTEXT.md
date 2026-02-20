# AI Flow Context Log

## Last Updated
- Date: 2026-02-20
- Focus: Repository restructured to Central Server + Many Clients layout.

## Current Goal
- Use architecture mode `Central Server + Many Clients`.
- Keep only two main work areas: `server-side/` and `client-side/`.

## Canonical Structure
- `server-side/backend`: Flask backend, processors, stream manager, AI model runtime.
- `server-side/data`: persistent server DB and runtime data.
- `client-side/ui`: flow editor and monitoring client UI.

## Status
- Legacy monorepo folders/files removed: `packages/`, `scripts/`, root npm meta files.
- Backend source is now canonical in `server-side/backend`.
- Frontend source is now canonical in `client-side/ui`.
- Cache/build artifacts cleaned: `client-side/ui/node_modules`, `client-side/ui/build`, backend `__pycache__`.

## Key Technical Progress Preserved
- Camera cleanup hardened (stop by index + global fallback + cooperative stream handling).
- ROI live runtime update implemented via `POST /stream/<id>/roi/params` without stream recreation.
- Main Vision output simplified to 2 outputs (`json` + `image`) with default model `models/yolov5mu.pt`.
- Ergonomic check integrated into Main Vision with ON/OFF control and JSON risk summary.
- Display output fit/aspect fixes and output dedup behavior already implemented.
- Reactive auto-run guard and erase-output reliability fixes already implemented.

## Next Focus
1. Continue all code changes only under `server-side/backend` and `client-side/ui`.
2. Validate end-to-end runtime for central-server multi-client workflow.
3. Keep side-specific progress in:
   - `server-side/CONTEXT.md`
   - `client-side/CONTEXT.md`

## New Chat Bootstrap Prompt
- "Baca `d:/ProjectMagang/aiflow/aski-flow/CONTEXT.md`, lalu lanjutkan task terbaru dengan basis struktur `server-side` dan `client-side` saja."

