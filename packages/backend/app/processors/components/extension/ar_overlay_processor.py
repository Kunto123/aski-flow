import json
import uuid

try:
    import cv2
    import numpy as np
except Exception:
    cv2 = None
    np = None

from ..core.processor_type_name_utils import ProcessorType
from ..processor import BasicProcessor
from .media_ref_utils import extract_asset_filename, resolve_stream_image_to_asset_url
from ....vision import draw_boxes_overlay


class AROverlayProcessor(BasicProcessor):
    processor_type = ProcessorType.AR_OVERLAY

    def __init__(self, config):
        super().__init__(config)
        self.image_url = config.get("image_url")
        self.predictions_json = config.get("predictions_json")

    def process(self):
        if cv2 is None or np is None:
            raise RuntimeError(
                "opencv-python and numpy are required for ar-overlay processor."
            )
        image_url = self.get_input_by_name("image_url", self.image_url)
        predictions_raw = self.get_input_by_name(
            "predictions_json",
            self.predictions_json,
            accept_object=True,
        )
        if not image_url:
            raise ValueError("ar-overlay requires image_url")

        image_url = resolve_stream_image_to_asset_url(
            image_url,
            self.get_storage(),
            self.name,
        )
        filename = extract_asset_filename(image_url)
        if not filename:
            raise ValueError("ar-overlay expects /asset/<file> image URL")

        if isinstance(predictions_raw, str):
            predictions = json.loads(predictions_raw) if predictions_raw else {}
        else:
            predictions = predictions_raw or {}

        content = self.get_storage().get_file(filename)
        image = cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError("Could not decode image for ar-overlay")

        overlay = draw_boxes_overlay(image, predictions)
        ok, encoded = cv2.imencode(".jpg", overlay)
        if not ok:
            raise RuntimeError("Could not encode overlay image")

        output_filename = f"{self.name}-overlay-{uuid.uuid4().hex[:10]}.jpg"
        return self.get_storage().save(output_filename, encoded.tobytes())

    def cancel(self):
        pass
