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


class RoiProcessor(BasicProcessor):
    """Simple ROI crop/warp/mask v1.

    Supports:
    - file images via /asset/<file>
    - stream refs (stream:// or /stream/<id>.mjpg) via transform stream

    Output:
    - image_url (file mode) OR stream:// + mjpeg_url (stream mode)
    """

    processor_type = ProcessorType.ROI

    def __init__(self, config):
        super().__init__(config)
        self.input_url = config.get("input_url")
        # Normalized crop box (0..1)
        self.x = float(config.get("x", 0.0))
        self.y = float(config.get("y", 0.0))
        self.w = float(config.get("w", 1.0))
        self.h = float(config.get("h", 1.0))

    def process(self):
        if cv2 is None or np is None:
            raise RuntimeError("opencv-python and numpy are required for ROI processor")

        input_ref = self.get_input_by_name("input_url", self.input_url)
        if not input_ref:
            raise ValueError("roi requires input_url")

        stream_id = _extract_stream_id(input_ref)
        if stream_id:
            return self._process_stream(stream_id)
        return self._process_file(input_ref)

    def _crop(self, frame):
        h, w = frame.shape[:2]
        x1 = int(max(0, min(1.0, self.x)) * w)
        y1 = int(max(0, min(1.0, self.y)) * h)
        x2 = int(max(0, min(1.0, self.x + self.w)) * w)
        y2 = int(max(0, min(1.0, self.y + self.h)) * h)
        if x2 <= x1 or y2 <= y1:
            return frame
        return frame[y1:y2, x1:x2]

    def _process_stream(self, source_stream_id: str):
        manager = get_stream_manager()

        def _transform(frame):
            return self._crop(frame)

        out_stream_id = manager.create_transform_stream(source_stream_id, _transform)
        return [f"stream://{out_stream_id}", manager.build_mjpeg_url(out_stream_id)]

    def _process_file(self, input_url: str):
        filename = _extract_asset_filename(input_url)
        if not filename:
            raise ValueError("roi expects /asset/<file> URL or stream:// ref")

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
