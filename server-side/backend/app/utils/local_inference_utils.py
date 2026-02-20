import base64
import os
from datetime import datetime
from typing import Any, Dict, Optional

import requests

DEFAULT_TIMEOUT_SECONDS = int(os.getenv("LOCAL_INFERENCE_TIMEOUT_SECONDS", "300"))

MIME_EXTENSION_MAP = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
}


def coerce_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def coerce_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def sanitize_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = {}
    for key, value in payload.items():
        if value is None:
            continue
        if isinstance(value, str) and value.strip() == "":
            continue
        cleaned[key] = value
    return cleaned


def resolve_endpoint_url(endpoint_url: Optional[str], path: str) -> str:
    if endpoint_url:
        return endpoint_url
    base_url = os.getenv("LOCAL_INFERENCE_BASE_URL", "http://localhost:8001").rstrip(
        "/"
    )
    return f"{base_url}{path}"


def post_json(
    path: str, payload: Dict[str, Any], endpoint_url: Optional[str] = None
) -> Dict[str, Any]:
    url = resolve_endpoint_url(endpoint_url, path)
    response = requests.post(url, json=payload, timeout=DEFAULT_TIMEOUT_SECONDS)
    if response.status_code != 200:
        raise Exception(f"Local inference error {response.status_code}: {response.text}")
    return response.json()


def extract_text_output(data: Dict[str, Any]) -> str:
    for key in ("output", "text", "result"):
        if key in data and data[key] is not None:
            return data[key]
    raise Exception("Local inference response missing text output")


def extract_embedding(data: Dict[str, Any]):
    for key in ("embedding", "vector", "embeddings"):
        if key in data and data[key] is not None:
            return data[key]
    raise Exception("Local inference response missing embedding")


def extract_base64(data: Dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = data.get(key)
        if value:
            return value
    return None


def extension_from_mime(mime_type: Optional[str], default_ext: str) -> str:
    if not mime_type:
        return default_ext
    return MIME_EXTENSION_MAP.get(mime_type, default_ext)


def save_base64_to_storage(
    storage, base64_str: str, filename_prefix: str, mime_type: Optional[str], default_ext: str
) -> str:
    data = base64.b64decode(base64_str)
    ext = extension_from_mime(mime_type, default_ext)
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    filename = f"{filename_prefix}-{timestamp}.{ext}"
    return storage.save(filename, data)
