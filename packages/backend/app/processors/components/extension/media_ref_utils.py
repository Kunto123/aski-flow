import time
import uuid
from urllib.parse import urlparse

try:
    import cv2
    import numpy as np
except Exception:
    cv2 = None
    np = None
from werkzeug.utils import secure_filename

from ....streaming import get_stream_manager


def extract_stream_id(ref: str):
    if not ref:
        return None
    if ref.startswith("stream://"):
        return ref.replace("stream://", "", 1)
    if "/stream/" in ref and ".mjpg" in ref:
        return ref.split("/stream/")[1].split(".mjpg")[0]
    if "/stream/" in ref and ".mjpeg" in ref:
        return ref.split("/stream/")[1].split(".mjpeg")[0]
    return None


def extract_asset_filename(url: str):
    if not url:
        return None
    parsed = urlparse(url)
    path = parsed.path
    marker = "/asset/"
    if marker not in path:
        return None
    raw = path.split(marker, 1)[1]
    return secure_filename(raw)


def resolve_stream_image_to_asset_url(ref: str, storage, output_prefix: str) -> str:
    """Convert a stream reference into a static image asset URL.

    If `ref` is not a stream reference, it is returned as-is.
    """
    stream_id = extract_stream_id(ref)
    if not stream_id:
        return ref

    if cv2 is None or np is None:
        raise RuntimeError(
            "opencv-python and numpy are required to snapshot image from stream ref."
        )

    manager = get_stream_manager()
    frame = None
    for _ in range(20):
        frame = manager.get_latest_frame(stream_id)
        if frame is not None:
            break
        time.sleep(0.05)

    if frame is None:
        raise RuntimeError(f"No frame available from stream: {stream_id}")

    encoded_ok, encoded = cv2.imencode(".jpg", frame)
    if not encoded_ok:
        raise RuntimeError("Could not encode stream frame to image")

    safe_prefix = secure_filename(output_prefix or "stream")
    filename = f"{safe_prefix}-snapshot-{uuid.uuid4().hex[:10]}.jpg"
    return storage.save(filename, encoded.tobytes())
