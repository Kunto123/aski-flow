import json
import os
import tempfile
import uuid
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
from ....vision import draw_boxes_overlay, get_ultralytics_runtime


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


def _is_video_filename(filename: str):
    lower = filename.lower()
    return lower.endswith(".mp4") or lower.endswith(".mov") or lower.endswith(".avi")


class MainVisionModelProcessor(BasicProcessor):
    processor_type = ProcessorType.MAIN_VISION_MODEL

    def __init__(self, config):
        super().__init__(config)
        self.model_path = config.get("model_path", "yolov8n.pt")
        self.conf_threshold = float(config.get("conf_threshold", 0.25))
        self.input_url = config.get("input_url")

    def process(self):
        if cv2 is None or np is None:
            raise RuntimeError(
                "opencv-python and numpy are required for main-vision-model processor."
            )
        input_ref = self.get_input_by_name("input_url", self.input_url)
        if not input_ref:
            raise ValueError("main-vision-model requires input_url")

        stream_id = _extract_stream_id(input_ref)
        if stream_id:
            return self._process_stream(stream_id)
        return self._process_file(input_ref)

    def _process_stream(self, source_stream_id: str):
        manager = get_stream_manager()
        runtime = get_ultralytics_runtime()

        # Fail fast in local-first mode if the model weights are missing.
        # Without this, the transform thread can silently loop without frames.
        _ = runtime._normalize_key(self.model_path)

        def _transform(frame):
            predictions = runtime.predict(
                frame,
                model_path=self.model_path,
                conf=self.conf_threshold,
            )
            overlay = draw_boxes_overlay(frame, predictions)
            return overlay, predictions

        overlay_stream_id = manager.create_transform_stream(source_stream_id, _transform)
        predictions_url = manager.build_predictions_url(overlay_stream_id)

        predictions_payload = {
            "mode": "stream",
            "predictions_url": predictions_url,
            "stream_id": overlay_stream_id,
        }

        return [
            json.dumps(predictions_payload),
            f"stream://{overlay_stream_id}",
            manager.build_mjpeg_url(overlay_stream_id),
            predictions_url,
        ]

    def _process_file(self, input_url: str):
        filename = _extract_asset_filename(input_url)
        if not filename:
            raise ValueError("main-vision-model expects /asset/<file> URL or stream:// ref")

        storage = self.get_storage()
        content = storage.get_file(filename)
        runtime = get_ultralytics_runtime()

        if _is_video_filename(filename):
            return self._process_video_bytes(content, runtime)
        return self._process_image_bytes(content, runtime)

    def _process_image_bytes(self, content: bytes, runtime):
        image = cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError("Could not decode input image")

        predictions = runtime.predict(
            image,
            model_path=self.model_path,
            conf=self.conf_threshold,
        )
        overlay = draw_boxes_overlay(image, predictions)
        ok, encoded = cv2.imencode(".jpg", overlay)
        if not ok:
            raise RuntimeError("Could not encode overlay image")

        filename = f"{self.name}-overlay-{uuid.uuid4().hex[:10]}.jpg"
        overlay_url = self.get_storage().save(filename, encoded.tobytes())
        return [json.dumps(predictions), overlay_url]

    def _process_video_bytes(self, content: bytes, runtime):
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as src:
            src.write(content)
            src_path = src.name

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as dst:
            dst_path = dst.name

        cap = cv2.VideoCapture(src_path)
        if not cap.isOpened():
            raise RuntimeError("Could not open input video")

        fps = cap.get(cv2.CAP_PROP_FPS) or 20.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)
        writer = cv2.VideoWriter(
            dst_path,
            cv2.VideoWriter_fourcc(*"mp4v"),
            fps,
            (width, height),
        )
        if not writer.isOpened():
            cap.release()
            raise RuntimeError("Could not initialize output video writer")

        last_predictions = {}
        frame_count = 0
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            preds = runtime.predict(
                frame,
                model_path=self.model_path,
                conf=self.conf_threshold,
            )
            frame_overlay = draw_boxes_overlay(frame, preds)
            writer.write(frame_overlay)
            last_predictions = preds
            frame_count += 1

        cap.release()
        writer.release()

        with open(dst_path, "rb") as f:
            overlay_bytes = f.read()
        for p in (src_path, dst_path):
            try:
                os.remove(p)
            except OSError:
                pass

        overlay_filename = f"{self.name}-overlay-{uuid.uuid4().hex[:10]}.mp4"
        overlay_url = self.get_storage().save(overlay_filename, overlay_bytes)
        payload = {
            "mode": "video",
            "frame_count": frame_count,
            "last_predictions": last_predictions,
        }
        return [json.dumps(payload), overlay_url]

    def cancel(self):
        pass
