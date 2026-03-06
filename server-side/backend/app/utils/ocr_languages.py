from typing import List


COMMON_OCR_LANGUAGE_RECOMMENDATIONS = ["eng"]


def _safe_unique(items: List[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for raw in items:
        item = str(raw or "").strip()
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def list_ocr_languages_payload() -> dict:
    # keras-ocr default recognizer is English-only.
    try:
        import keras_ocr  # noqa: F401
    except Exception as e:
        return {
            "engine": "keras-ocr",
            "engine_available": False,
            "languages": [],
            "count": 0,
            "recommended": COMMON_OCR_LANGUAGE_RECOMMENDATIONS,
            # Kept for backward compatibility with older clients expecting this key.
            "tesseract_available": False,
            "error": f"keras_ocr unavailable: {e}",
        }

    languages = _safe_unique(["eng"])
    return {
        "engine": "keras-ocr",
        "engine_available": True,
        "languages": languages,
        "count": len(languages),
        "recommended": _safe_unique(COMMON_OCR_LANGUAGE_RECOMMENDATIONS + languages),
        # Kept for backward compatibility with older clients expecting this key.
        "tesseract_available": True,
    }
