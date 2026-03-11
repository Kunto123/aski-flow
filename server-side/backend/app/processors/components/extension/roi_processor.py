import uuid
import os
import tempfile
import json
from urllib.parse import urlparse

try:
    import cv2
    import numpy as np
except Exception:
    cv2 = None
    np = None

from werkzeug.utils import secure_filename

from ..core.processor_type_name_utils import ProcessorType
from ..processor import BasicProcessor
from ....streaming import get_stream_manager

VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}


def _extract_stream_id(ref: str):
    if not ref:
        return None
    if ref.startswith("stream://"):
        return ref.replace("stream://", "", 1)
    if "/stream/" in ref and ".mjpg" in ref:
        return ref.split("/stream/")[1].split(".mjpg")[0]
    if "/stream/" in ref and ".mjpeg" in ref:
        return ref.split("/stream/")[1].split(".mjpeg")[0]
    return None


def _extract_asset_filename(url: str):
    parsed = urlparse(url)
    path = parsed.path
    marker = "/asset/"
    if marker not in path:
        return None
    raw = path.split(marker, 1)[1]
    return secure_filename(raw)


def _safe_float(value, default):
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _clamp(value, min_value, max_value):
    return max(min_value, min(max_value, value))


class RoiProcessor(BasicProcessor):
    """Simple ROI crop/warp/mask v1.

    Supports:
    - file images via /asset/<file>
    - stream refs (stream:// or /stream/<id>.mjpg) via transform stream

    Output:
    - image_url / video_url (file mode) OR stream ref (stream mode)
    """

    processor_type = ProcessorType.ROI

    def __init__(self, config):
        super().__init__(config)
        self.input_url = config.get("input_url")
        # Normalized crop box (0..1)
        self.x = _safe_float(config.get("x"), 0.0)
        self.y = _safe_float(config.get("y"), 0.0)
        self.w = _safe_float(config.get("w"), 1.0)
        self.h = _safe_float(config.get("h"), 1.0)
        # Pixel crop box (preferred by new UI). Falls back to normalized w/h.
        self.width = _safe_float(config.get("width"), 0.0)
        self.height = _safe_float(config.get("height"), 0.0)

    def process(self):
        if cv2 is None or np is None:
            raise RuntimeError("opencv-python and numpy are required for ROI processor")

        # NOTE:
        # Upstream processors typically output a *list* of values.
        # get_input_by_name() historically JSON-serializes lists unless
        # accept_object=True, so we unwrap here to reliably support stream refs.
        input_raw = self.get_input_by_name(
            "input_url",
            self.input_url,
            accept_object=True,
        )

        input_ref = None
        if isinstance(input_raw, list):
            input_ref = input_raw[0] if len(input_raw) > 0 else None
        elif isinstance(input_raw, str):
            s = input_raw.strip()
            # Backward-compat: some chains pass JSON like ["stream://..."]
            if s.startswith("[") and s.endswith("]"):
                try:
                    parsed = json.loads(s)
                    if isinstance(parsed, list) and len(parsed) > 0:
                        input_ref = parsed[0]
                    else:
                        input_ref = input_raw
                except Exception:
                    input_ref = input_raw
            else:
                input_ref = input_raw
        else:
            input_ref = input_raw

        if not input_ref:
            raise ValueError("roi requires input_url")

        stream_id = _extract_stream_id(input_ref)
        if stream_id:
            return self._process_stream(stream_id)
        return self._process_file(input_ref)

    def _resolve_roi_px(self, frame_w: int, frame_h: int, params=None):
        if frame_w <= 0 or frame_h <= 0:
            return 0, 0, frame_w, frame_h

        params = params or {}
        x_norm = _clamp(_safe_float(params.get("x"), self.x), 0.0, 1.0)
        y_norm = _clamp(_safe_float(params.get("y"), self.y), 0.0, 1.0)

        # Prefer normalized w/h. This matches the UI behavior where width/height
        # are specified in preview pixels, but we persist the normalized ROI (w/h).
        w_norm = _safe_float(params.get("w"), self.w)
        h_norm = _safe_float(params.get("h"), self.h)
        width_px = _safe_float(params.get("width"), self.width)
        height_px = _safe_float(params.get("height"), self.height)

        if 0.0 < w_norm <= 1.0 and 0.0 < h_norm <= 1.0:
            roi_w = max(1, int(_clamp(w_norm, 0.0, 1.0) * frame_w))
            roi_h = max(1, int(_clamp(h_norm, 0.0, 1.0) * frame_h))
        elif width_px > 0 and height_px > 0:
            # Pixel crop mode (advanced).
            roi_w = int(_clamp(width_px, 1.0, float(frame_w)))
            roi_h = int(_clamp(height_px, 1.0, float(frame_h)))
        else:
            roi_w = frame_w
            roi_h = frame_h

        x1 = int(x_norm * frame_w)
        y1 = int(y_norm * frame_h)
        x1 = int(_clamp(x1, 0, max(0, frame_w - roi_w)))
        y1 = int(_clamp(y1, 0, max(0, frame_h - roi_h)))

        return x1, y1, roi_w, roi_h

    def _crop(self, frame, params=None):
        h, w = frame.shape[:2]
        x1, y1, roi_w, roi_h = self._resolve_roi_px(w, h, params=params)
        x2 = x1 + roi_w
        y2 = y1 + roi_h
        if x2 <= x1 or y2 <= y1:
            return frame
        return frame[y1:y2, x1:x2]

    def _process_stream(self, source_stream_id: str):
        manager = get_stream_manager()
        initial_params = {
            "x": self.x,
            "y": self.y,
            "w": self.w,
            "h": self.h,
            "width": self.width,
            "height": self.height,
        }

        # Reuse active ROI stream when the source stream is unchanged.
        # This avoids stop/start churn while users tweak ROI continuously.
        existing_stream_id = manager.find_transform_stream(
            owner_name=self.name,
            source_stream_id=source_stream_id,
            stream_tag="roi",
        )
        if existing_stream_id:
            manager.update_stream_runtime_params(existing_stream_id, initial_params)
            return [f"stream://{existing_stream_id}"]

        manager.stop_streams_by_owner(self.name)
        stream_id_ref = {"value": None}

        def _transform(frame):
            stream_id = stream_id_ref.get("value")
            live_params = (
                manager.get_stream_runtime_params(stream_id) if stream_id else {}
            )
            roi_params = {**initial_params, **live_params}
            return self._crop(frame, params=roi_params)

        out_stream_id = manager.create_transform_stream(
            source_stream_id,
            _transform,
            owner_name=self.name,
            stream_tag="roi",
            runtime_params=initial_params,
        )
        stream_id_ref["value"] = out_stream_id
        # Single canonical output: downstream and UI can render from stream ref directly.
        return [f"stream://{out_stream_id}"]

    def _process_file(self, input_url: str):
        filename = _extract_asset_filename(input_url)
        if not filename:
            raise ValueError("roi expects /asset/<file> URL or stream:// ref")

        extension = os.path.splitext(filename)[1].lower()
        if extension in VIDEO_EXTENSIONS:
            return self._process_video_file(filename)

        return self._process_image_file(filename)

    def _process_image_file(self, filename: str):
        storage = self.get_storage()
        content = storage.get_file(filename)
        image = cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError("Could not decode input image")

        cropped = self._crop(image)
        ok, encoded = cv2.imencode(".jpg", cropped)
        if not ok:
            raise RuntimeError("Could not encode roi image")

        out_name = f"{self.name}-roi-{uuid.uuid4().hex[:10]}.jpg"
        out_url = self.get_storage().save(out_name, encoded.tobytes())
        return [out_url]

    def _process_video_file(self, filename: str):
        storage = self.get_storage()
        content = storage.get_file(filename)
        ext = os.path.splitext(filename)[1].lower() or ".mp4"

        input_path = None
        output_path = None
        cap = None
        writer = None

        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as temp_input:
                temp_input.write(content)
                input_path = temp_input.name

            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp_output:
                output_path = temp_output.name

            cap = cv2.VideoCapture(input_path)
            if not cap.isOpened():
                raise RuntimeError("Could not decode input video")

            frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = float(cap.get(cv2.CAP_PROP_FPS))
            fps = fps if fps and fps > 0 else 25.0

            x1, y1, roi_w, roi_h = self._resolve_roi_px(frame_w, frame_h)
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(output_path, fourcc, fps, (roi_w, roi_h))
            if not writer.isOpened():
                raise RuntimeError("Could not initialize output video writer")

            wrote_any_frame = False
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                crop = frame[y1 : y1 + roi_h, x1 : x1 + roi_w]
                if crop is None or crop.size == 0:
                    continue
                writer.write(crop)
                wrote_any_frame = True

            if not wrote_any_frame:
                raise RuntimeError("Could not crop any video frame")

            with open(output_path, "rb") as f:
                out_bytes = f.read()

            out_name = f"{self.name}-roi-{uuid.uuid4().hex[:10]}.mp4"
            out_url = storage.save(out_name, out_bytes)
            return [out_url]
        finally:
            if cap is not None:
                cap.release()
            if writer is not None:
                writer.release()
            if input_path and os.path.exists(input_path):
                try:
                    os.remove(input_path)
                except Exception:
                    pass
            if output_path and os.path.exists(output_path):
                try:
                    os.remove(output_path)
                except Exception:
                    pass
