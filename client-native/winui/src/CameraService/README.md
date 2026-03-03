# CameraService

Responsibilities:
- Native camera capture.
- Encode frame to jpeg.
- Upload frame to `/stream/client-camera/frame`.
- Include `X-Aski-Client-Session-Id` header.

Implemented:
- `CameraFrame` model.
- `CameraPipelineOptions` model.
- `ICameraFrameSource` abstraction.
- `OpenCvCameraFrameSource` concrete capture adapter.
- `CameraFrameUploader` upload pipeline aligned to backend ingest endpoint.
- `CameraPipelineSession` orchestrator for source + uploader lifecycle.
