# StreamViewer

Responsibilities:
- Render stream media (`mjpg`).
- Render text/json output.
- Poll `/stream/{id}/predictions.json` for OCR/QR fallback.

Implemented:
- `OutputInterpreter` for text/json/url/stream output classification.
- `StreamUrlResolver` for `stream://<id>` -> concrete mjpg/predictions URLs.
- `StreamPredictionsPoller` for polling predictions endpoint.
- `StreamViewerController` for node output state orchestration and polling lifecycle.
