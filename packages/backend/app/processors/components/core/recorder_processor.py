import time
import tempfile
import uuid
import os
from typing import Optional

try:
    import cv2
except Exception:
    cv2 = None

from ..processor import BasicProcessor
from .processor_type_name_utils import ProcessorType
from ....streaming import get_stream_manager


def _extract_stream_id(ref: str) -> Optional[str]:
    if not ref:
        return None

    if ref.startswith("stream://"):
        return ref.replace("stream://", "", 1)

    if "/stream/" in ref and ".mjpg" in ref:
        try:
            return ref.split("/stream/")[1].split(".mjpg")[0]
        except Exception:
            return None

    if "/stream/" in ref and ".mjpeg" in ref:
        try:
            return ref.split("/stream/")[1].split(".mjpeg")[0]
        except Exception:
            return None

    return None


class RecorderProcessor(BasicProcessor):
    processor_type = ProcessorType.RECORDER

    def __init__(self, config):
        super().__init__(config)
        self.duration_seconds = float(config.get("duration_seconds", 5))
        self.fps = float(config.get("fps", 20))
        self.stream_ref = config.get("stream_ref")

    def process(self):
        if cv2 is None:
            raise RuntimeError(
                "opencv-python is required for recorder processor. Install backend dependencies first."
            )
        manager = get_stream_manager()
        stream_ref = self.get_input_by_name("stream_ref", self.stream_ref)
        stream_id = _extract_stream_id(stream_ref)
        if not stream_id:
            raise ValueError("Recorder requires stream_ref (stream://<id> or /stream/<id>.mjpg)")

        deadline = time.time() + max(self.duration_seconds, 0.1)
        interval = 1.0 / max(self.fps, 1.0)

        first_frame = None
        while time.time() < deadline:
            first_frame = manager.get_latest_frame(stream_id)
            if first_frame is not None:
                break
            time.sleep(0.03)

        if first_frame is None:
            raise RuntimeError("No frame available from stream for recorder")

        height, width = first_frame.shape[:2]
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        filename = f"{self.name}-{uuid.uuid4().hex[:10]}.mp4"
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            output_path = tmp.name
        writer = cv2.VideoWriter(output_path, fourcc, max(self.fps, 1.0), (width, height))
        if not writer.isOpened():
            raise RuntimeError("Could not initialize VideoWriter")

        try:
            while time.time() < deadline:
                frame = manager.get_latest_frame(stream_id)
                if frame is None:
                    time.sleep(interval)
                    continue
                writer.write(frame)
                time.sleep(interval)
        finally:
            writer.release()

        with open(output_path, "rb") as f:
            content = f.read()
        try:
            os.remove(output_path)
        except OSError:
            pass

        return self.get_storage().save(filename, content)

    def cancel(self):
        pass
