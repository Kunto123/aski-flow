import json
from urllib.parse import urlparse

from werkzeug.utils import secure_filename


def extract_stream_id(ref: str):
    if not ref or not isinstance(ref, str):
        return None
    if ref.startswith("stream://"):
        return ref.replace("stream://", "", 1)
    if "/stream/" in ref and ".mjpg" in ref:
        return ref.split("/stream/")[1].split(".mjpg")[0]
    if "/stream/" in ref and ".mjpeg" in ref:
        return ref.split("/stream/")[1].split(".mjpeg")[0]
    return None


def extract_asset_filename(url: str):
    if not url or not isinstance(url, str):
        return None
    parsed = urlparse(url)
    path = parsed.path
    marker = "/asset/"
    if marker not in path:
        return None
    raw = path.split(marker, 1)[1]
    return secure_filename(raw)


def unwrap_primary_input(raw_value):
    """Normalize linked input value to a single primary item.

    Handles values passed as:
    - direct scalar (string/number/object)
    - list (returns first non-empty item)
    - JSON-encoded list string (legacy path)
    """

    if isinstance(raw_value, list):
        for item in raw_value:
            if item is None:
                continue
            if isinstance(item, str) and item.strip() == "":
                continue
            return item
        return None

    if isinstance(raw_value, str):
        value = raw_value.strip()
        if value.startswith("[") and value.endswith("]"):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return unwrap_primary_input(parsed)
            except Exception:
                return raw_value
        return raw_value

    return raw_value
