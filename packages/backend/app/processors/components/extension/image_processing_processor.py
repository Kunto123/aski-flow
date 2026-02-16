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


class ImageProcessingProcessor(BasicProcessor):
    """Basic image ops v1 (resize/blur/grayscale/threshold).

    For stream input, outputs a transform stream.
    For file input, outputs /asset/<processed>.jpg
    """

    processor_type = ProcessorType.IMAGE_PROCESSING

    def __init__(self, config):
        super().__init__(config)
        self.input_url = config.get("input_url")
        self.resize_width = config.get("resize_width")
        self.resize_height = config.get("resize_height")
        self.grayscale = bool(config.get("grayscale", False))
        self.blur = int(config.get("blur", 0) or 0)
        self.threshold = config.get("threshold")

    def process(self):
        if cv2 is None or np is None:
            raise RuntimeError(
                "opencv-python and numpy are required for image-processing processor"
            )

        input_ref = self.get_input_by_name("input_url", self.input_url)
        if not input_ref:
            raise ValueError("image-processing requires input_url")

        stream_id = _extract_stream_id(input_ref)
        if stream_id:
            return self._process_stream(stream_id)
        return self._process_file(input_ref)

    def _apply_ops(self, frame):
        img = frame

        if self.resize_width or self.resize_height:
            h, w = img.shape[:2]
            new_w = int(self.resize_width) if self.resize_width else w
            new_h = int(self.resize_height) if self.resize_height else h
            img = cv2.resize(img, (max(1, new_w), max(1, new_h)))

        if self.grayscale:
            img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

        if self.blur and self.blur > 0:
            k = int(self.blur)
            if k % 2 == 0:
                k += 1
            img = cv2.GaussianBlur(img, (k, k), 0)

        if self.threshold is not None and str(self.threshold) != "":
            t = float(self.threshold)
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            _, th = cv2.threshold(gray, t, 255, cv2.THRESH_BINARY)
            img = cv2.cvtColor(th, cv2.COLOR_GRAY2BGR)

        return img

    def _process_stream(self, source_stream_id: str):
        manager = get_stream_manager()

        def _transform(frame):
            return self._apply_ops(frame)

        out_stream_id = manager.create_transform_stream(source_stream_id, _transform)
        return [f"stream://{out_stream_id}", manager.build_mjpeg_url(out_stream_id)]

    def _process_file(self, input_url: str):
        filename = _extract_asset_filename(input_url)
        if not filename:
            raise ValueError(
                "image-processing expects /asset/<file> URL or stream:// ref"
            )

        storage = self.get_storage()
        content = storage.get_file(filename)
        image = cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError("Could not decode input image")

        processed = self._apply_ops(image)
        ok, encoded = cv2.imencode(".jpg", processed)
        if not ok:
            raise RuntimeError("Could not encode processed image")

        out_name = f"{self.name}-imgproc-{uuid.uuid4().hex[:10]}.jpg"
        out_url = self.get_storage().save(out_name, encoded.tobytes())
        return [out_url]
