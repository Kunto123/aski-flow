import os
from typing import List


COMMON_OCR_LANGUAGE_RECOMMENDATIONS = [
    "eng",
    "ind",
    "eng+ind",
]


def _safe_unique(items: List[str]) -> List[str]:
    seen = set()
    output: List[str] = []
    for raw in items:
        item = str(raw or "").strip()
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(item)
    return output


def list_ocr_languages_payload() -> dict:
    try:
        import pytesseract
    except Exception as e:
        return {
            "languages": [],
            "count": 0,
            "recommended": COMMON_OCR_LANGUAGE_RECOMMENDATIONS,
            "tesseract_available": False,
            "error": f"pytesseract unavailable: {e}",
        }

    tesseract_cmd = (
        os.getenv("ASKI_TESSERACT_CMD")
        or os.getenv("TESSERACT_CMD")
        or os.getenv("PYTESSERACT_TESSERACT_CMD")
    )
    if tesseract_cmd:
        try:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        except Exception:
            pass

    try:
        installed = pytesseract.get_languages(config="") or []
        installed = _safe_unique([lang for lang in installed if str(lang).strip() != "osd"])

        recommended: List[str] = []
        if "eng" in installed:
            recommended.append("eng")
        if "ind" in installed:
            recommended.append("ind")
        if "eng" in installed and "ind" in installed:
            recommended.append("eng+ind")

        # Include common fallbacks and the installed list as additional suggestions.
        recommended.extend(COMMON_OCR_LANGUAGE_RECOMMENDATIONS)
        recommended.extend(installed)
        recommended = _safe_unique(recommended)

        return {
            "languages": installed,
            "count": len(installed),
            "recommended": recommended,
            "tesseract_available": True,
        }
    except Exception as e:
        return {
            "languages": [],
            "count": 0,
            "recommended": COMMON_OCR_LANGUAGE_RECOMMENDATIONS,
            "tesseract_available": False,
            "error": str(e),
        }
