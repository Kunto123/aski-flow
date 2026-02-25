from .processor_type_name_utils import ProcessorType
from ..processor import BasicProcessor


def _processor_type_name(value) -> str:
    if value is None:
        return ""
    if hasattr(value, "value"):
        try:
            return str(value.value or "")
        except Exception:
            return str(value)
    return str(value or "")


def _looks_like_media_reference(value) -> bool:
    if not isinstance(value, str):
        return False
    s = value.strip().lower()
    if not s:
        return False
    return (
        s.startswith("http://")
        or s.startswith("https://")
        or s.startswith("stream://")
        or s.startswith("/asset/")
        or s.startswith("/image/")
        or "/stream/" in s
        or s.endswith("#file")
    )


class DisplayProcessor(BasicProcessor):
    processor_type = "display"

    def __init__(self, config):
        super().__init__(config)

    def process(self):
        input_processor = self.get_input_processor()
        if input_processor is None:
            return ""

        requested_key = self.get_input_node_output_key()
        input_data = input_processor.get_output(requested_key)

        # Edge handles can become stale when upstream output arity changes.
        # Fallback to the first available output instead of returning blank.
        if input_data is None and requested_key not in (None, 0):
            input_data = input_processor.get_output(0)

        if input_data is None:
            outputs = input_processor.get_output()
            if isinstance(outputs, list):
                preferred = self._prefer_text_for_ocr_like_outputs(
                    input_processor,
                    current_value=None,
                    outputs=outputs,
                )
                if preferred is not None:
                    return preferred

                for item in outputs:
                    if item is None:
                        continue
                    if isinstance(item, str) and item.strip() == "":
                        continue
                    return item
            return ""

        preferred = self._prefer_text_for_ocr_like_outputs(
            input_processor,
            current_value=input_data,
        )
        if preferred is not None:
            return preferred

        return input_data

    def _prefer_text_for_ocr_like_outputs(self, input_processor, current_value, outputs=None):
        processor_type = _processor_type_name(getattr(input_processor, "processor_type", ""))
        if processor_type not in ("ocr-reader", "qr-code-reader"):
            return None

        if not isinstance(outputs, list):
            outputs = input_processor.get_output()
        if not isinstance(outputs, list):
            outputs = []
        if len(outputs) < 2:
            if isinstance(current_value, str) and _looks_like_media_reference(current_value):
                return "Text output is not available yet. Run the node again."
            return None

        if isinstance(current_value, str):
            current_text = current_value.strip()
            if current_text and not _looks_like_media_reference(current_text):
                return current_value

        # Prefer a non-empty non-media string (OCR text), even if the edge still
        # points to the older media output handle.
        for item in outputs:
            if not isinstance(item, str):
                continue
            text = item.strip()
            if not text:
                continue
            if _looks_like_media_reference(text):
                continue
            return item

        return current_value
