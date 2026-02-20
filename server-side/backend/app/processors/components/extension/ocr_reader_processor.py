import json

try:
    import cv2
except Exception:
    cv2 = None

from ..processor import BasicProcessor
from ....streaming import get_stream_manager
from .media_ref_utils import extract_stream_id, unwrap_primary_input


class OcrReaderProcessor(BasicProcessor):
    """OCR Reader (Week 6 target) - dummy skeleton for Week 5."""

    processor_type = "ocr-reader"

    def __init__(self, config):
        super().__init__(config)
        self.input_url = config.get("input_url")

    def process(self):
        input_raw = self.get_input_by_name(
            "input_url",
            self.input_url,
            accept_object=True,
        )
        input_ref = unwrap_primary_input(input_raw)
        if not input_ref:
            raise ValueError("ocr-reader requires input_url")

        stream_id = extract_stream_id(input_ref)
        if stream_id:
            return self._process_stream(stream_id)

        payload = {
            "mode": "file",
            "status": "dummy",
            "text": "",
            "message": "OCR will be implemented in Week 6.",
        }
        return [input_ref, json.dumps(payload)]

    def _process_stream(self, source_stream_id: str):
        if cv2 is None:
            raise RuntimeError("opencv-python is required for ocr-reader stream mode")

        manager = get_stream_manager()
        manager.stop_streams_by_owner(self.name)

        def _transform(frame):
            return frame

        out_stream_id = manager.create_transform_stream(
            source_stream_id,
            _transform,
            owner_name=self.name,
        )
        payload = {
            "mode": "stream",
            "status": "dummy",
            "text": "",
            "message": "OCR will be implemented in Week 6.",
        }
        return [
            f"stream://{out_stream_id}",
            json.dumps(payload),
        ]

    def cancel(self):
        pass
