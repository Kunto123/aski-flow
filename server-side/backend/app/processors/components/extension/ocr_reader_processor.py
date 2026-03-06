import os
import threading
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

try:
    import cv2
except Exception:
    cv2 = None

try:
    import numpy as np
except Exception:
    np = None

try:
    import keras_ocr
except Exception:
    keras_ocr = None

from ..processor import BasicProcessor
from ....streaming import get_stream_manager
from .media_ref_utils import extract_asset_filename, extract_stream_id, unwrap_primary_input


def _safe_float(value: Any, default: Optional[float] = None) -> Optional[float]:
    try:
        if value in (None, ""):
            return default
        return float(value)
    except Exception:
        return default


def _safe_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    try:
        if value in (None, ""):
            return default
        return int(float(value))
    except Exception:
        return default


def _to_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in ("1", "true", "yes", "on")


OCR_PROFILE_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "general": {"preprocess": "auto", "scale_factor": 1.8, "stream_fps": 10.0, "ocr_fps": 2.0, "draw_boxes": True, "draw_text": True, "psm": 6, "oem": 3, "min_confidence": 15.0},
    "ui-screenshot": {"preprocess": "adaptive", "scale_factor": 2.5, "stream_fps": 10.0, "ocr_fps": 1.5, "draw_boxes": True, "draw_text": True, "psm": 11, "oem": 3, "min_confidence": 8.0},
    "document": {"preprocess": "auto", "scale_factor": 2.0, "stream_fps": 10.0, "ocr_fps": 2.0, "draw_boxes": True, "draw_text": True, "psm": 6, "oem": 3, "min_confidence": 20.0},
    "single-line": {"preprocess": "auto", "scale_factor": 2.2, "stream_fps": 10.0, "ocr_fps": 2.0, "draw_boxes": True, "draw_text": True, "psm": 7, "oem": 3, "min_confidence": 5.0},
}


class OcrReaderProcessor(BasicProcessor):
    processor_type = "ocr-reader"
    _pipeline_lock = threading.Lock()
    _cached_pipeline = None

    def __init__(self, config):
        super().__init__(config)
        self.input_url = config.get("input_url")
        self.show_advanced = _to_bool(config.get("show_advanced"), False)
        self.ocr_profile = str(config.get("ocr_profile") or os.getenv("ASKI_OCR_PROFILE", "general")).strip().lower() or "general"
        if self.ocr_profile not in OCR_PROFILE_DEFAULTS:
            self.ocr_profile = "general"
        defaults = OCR_PROFILE_DEFAULTS[self.ocr_profile]

        def _pick(name: str, env_key: str, fallback: Any = None, *, advanced: bool = False):
            if (not advanced) or self.show_advanced:
                if config.get(name) not in (None, ""):
                    return config.get(name)
            if advanced and not self.show_advanced:
                return defaults.get(name, fallback)
            env_v = os.getenv(env_key)
            if env_v not in (None, ""):
                return env_v
            return defaults.get(name, fallback)

        self.requested_lang = str(config.get("lang") or os.getenv("ASKI_OCR_LANG", "")).strip()
        self.preprocess_mode = str(_pick("preprocess", "ASKI_OCR_PREPROCESS", "auto", advanced=True)).strip().lower() or "auto"
        self.min_confidence = float(_safe_float(_pick("min_confidence", "ASKI_OCR_MIN_CONFIDENCE", 15.0, advanced=True), 15.0) or 15.0)
        self.stream_fps = float(_safe_float(_pick("stream_fps", "ASKI_OCR_STREAM_FPS", 10.0, advanced=True), 10.0) or 10.0)
        self.ocr_fps = float(_safe_float(_pick("ocr_fps", "ASKI_OCR_INFERENCE_FPS", 2.0, advanced=True), 2.0) or 2.0)
        self.draw_boxes = _to_bool(_pick("draw_boxes", "ASKI_OCR_DRAW_BOXES", True, advanced=True), True)
        self.draw_text = _to_bool(_pick("draw_text", "ASKI_OCR_DRAW_TEXT", True, advanced=True), True)
        self.max_words = max(20, int(_safe_int(config.get("max_words"), _safe_int(os.getenv("ASKI_OCR_MAX_WORDS"), 200)) or 200))
        self.max_lines = max(5, int(_safe_int(config.get("max_lines"), _safe_int(os.getenv("ASKI_OCR_MAX_LINES"), 50)) or 50))
        self.scale_factor = max(1.0, float(_safe_float(_pick("scale_factor", "ASKI_OCR_SCALE_FACTOR", 1.8, advanced=True), 1.8) or 1.8))
        self.max_text_chars = max(256, int(_safe_int(config.get("max_text_chars"), _safe_int(os.getenv("ASKI_OCR_MAX_TEXT_CHARS"), 4000)) or 4000))
        # Legacy config keys retained for compatibility with stored node configs.
        self.psm = _safe_int(_pick("psm", "ASKI_OCR_PSM", advanced=True), 6)
        self.oem = _safe_int(_pick("oem", "ASKI_OCR_OEM", advanced=True), 3)
        self.extra_tesseract_config = str(_pick("tesseract_config", "ASKI_OCR_TESSERACT_CONFIG", "", advanced=True) or "").strip()
        self._effective_lang: Optional[str] = None
        self._lang_warnings: List[str] = []

    def process(self):
        self._ensure_dependencies()
        input_raw = self.get_input_by_name("input_url", self.input_url, accept_object=True)
        input_ref = self._normalize_input_ref(unwrap_primary_input(input_raw))
        if not input_ref:
            raise ValueError("ocr-reader requires input_url")
        source_stream_id = extract_stream_id(input_ref)
        return self._process_stream(source_stream_id) if source_stream_id else self._process_file(input_ref)

    def _process_file(self, input_ref: str):
        result = self._run_ocr(self._load_image_from_ref(input_ref))
        payload = self._build_payload(mode="file", result=result, extra={"source_ref": input_ref, "live": False})
        return [self._payload_to_text_output(payload), input_ref]

    def _process_stream(self, source_stream_id: str):
        manager = get_stream_manager()
        manager.stop_streams_by_owner(self.name)
        interval = 1.0 / max(float(self.ocr_fps), 0.2)
        last_at = 0.0
        last_result: Optional[Dict[str, Any]] = None
        stream_meta: Dict[str, Optional[str]] = {"stream_id": None, "predictions_url": None}

        source_frame = manager.get_latest_frame(source_stream_id)
        if source_frame is not None:
            try:
                last_result = self._run_ocr(source_frame)
                last_at = time.monotonic()
            except Exception as e:
                last_result = self._build_error_result(str(e))

        def _payload_from_result(result_obj: Optional[Dict[str, Any]]):
            if not result_obj:
                return self._build_payload(mode="stream", result=None, status="warming_up", message="Waiting for source frames...", extra={"live": True, "stream_id": stream_meta["stream_id"], "predictions_url": stream_meta["predictions_url"]})
            if result_obj.get("status") == "error":
                return self._build_payload(mode="stream", result=None, status="error", message=result_obj.get("message") or "OCR failed", error=result_obj.get("message"), extra={"live": True, "stream_id": stream_meta["stream_id"], "predictions_url": stream_meta["predictions_url"]})
            return self._build_payload(mode="stream", result=result_obj, extra={"live": True, "stream_id": stream_meta["stream_id"], "predictions_url": stream_meta["predictions_url"]})

        def _transform(frame):
            nonlocal last_at, last_result
            now = time.monotonic()
            if (now - last_at) >= interval or last_result is None:
                try:
                    last_result = self._run_ocr(frame)
                except Exception as e:
                    last_result = self._build_error_result(str(e))
                last_at = now
            payload = _payload_from_result(last_result)
            return self._draw_overlay(frame, payload), payload

        out_stream_id = manager.create_transform_stream(source_stream_id, _transform, fps=max(1.0, float(self.stream_fps)), owner_name=self.name)
        stream_meta["stream_id"] = out_stream_id
        stream_meta["predictions_url"] = manager.build_predictions_url(out_stream_id)
        initial_payload = _payload_from_result(last_result)
        manager.set_predictions(out_stream_id, initial_payload)
        default_output = [self._payload_to_text_output(initial_payload), f"stream://{out_stream_id}"]
        try:
            current_output = self.get_output()
            if isinstance(current_output, list) and len(current_output) >= 2 and str(current_output[1] or "").strip() == f"stream://{out_stream_id}":
                return current_output
        except Exception:
            pass
        return default_output

    def _normalize_input_ref(self, value):
        if not isinstance(value, dict):
            return value
        for key in ("url", "input_url", "image_url", "stream_ref", "asset_url"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate
        return None

    def _load_image_from_ref(self, input_ref: str):
        if not isinstance(input_ref, str) or not input_ref.strip():
            raise ValueError("ocr-reader requires a valid image reference")
        ref = input_ref.strip()
        filename = self._extract_local_asset_like_filename(ref)
        if filename:
            return self._decode_image_bytes(self.get_storage().get_file(filename), source_desc=f"asset:{filename}")
        parsed = urlparse(ref)
        if parsed.scheme in ("http", "https"):
            return self._decode_image_bytes(self._download_http_bytes(ref), source_desc=ref)
        raise ValueError("ocr-reader expects an image URL (/asset, /image, http/https) or stream:// ref")

    def _extract_local_asset_like_filename(self, ref: str) -> Optional[str]:
        filename = extract_asset_filename(ref)
        if filename:
            return filename
        try:
            path = str(urlparse(ref).path or "")
        except Exception:
            path = str(ref or "")
        if "/image/" not in path:
            return None
        raw = path.split("/image/", 1)[1]
        safe = os.path.basename(raw).strip()
        return safe or None

    def _download_http_bytes(self, url: str) -> bytes:
        try:
            with urlopen(Request(url, headers={"User-Agent": "aski-flow-ocr/1.0"}), timeout=20) as response:
                return response.read()
        except HTTPError as e:
            raise RuntimeError(f"OCR could not download the image (HTTP {getattr(e, 'code', 'error')}). The file URL may be expired. Re-upload or run the File node again.") from e
        except URLError as e:
            raise RuntimeError(f"OCR could not download the image URL: {e.reason}") from e
        except Exception as e:
            raise RuntimeError(f"OCR could not download the image URL: {e}") from e

    def _decode_image_bytes(self, content: bytes, *, source_desc: str):
        if not content:
            raise RuntimeError("OCR input image is empty")
        image = cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError(f"Could not decode input image for OCR ({source_desc})")
        return image

    def _ensure_dependencies(self):
        if cv2 is None or np is None:
            raise RuntimeError("opencv-python and numpy are required for ocr-reader")
        if keras_ocr is None:
            raise RuntimeError("keras_ocr is required for ocr-reader. Install backend dependencies first.")

    def _resolve_lang(self) -> str:
        if self._effective_lang:
            return self._effective_lang
        requested = str(self.requested_lang or "").strip().lower()
        warnings: List[str] = []
        if requested:
            aliases = {"eng", "en", "english"}
            parts = [p.strip().lower() for p in requested.replace(",", "+").split("+") if p.strip()]
            if not any(p in aliases for p in parts):
                warnings.append("keras-ocr currently supports English recognizer only. Using: eng")
            else:
                unsupported = [p for p in parts if p not in aliases]
                if unsupported:
                    warnings.append("keras-ocr currently supports English recognizer only. Ignoring: " + ", ".join(unsupported))
        self._effective_lang = "eng"
        self._lang_warnings = warnings
        return self._effective_lang

    @classmethod
    def _get_pipeline(cls):
        if cls._cached_pipeline is not None:
            return cls._cached_pipeline
        with cls._pipeline_lock:
            if cls._cached_pipeline is None:
                try:
                    cls._cached_pipeline = keras_ocr.pipeline.Pipeline()
                except Exception as e:
                    raise RuntimeError(f"Failed to initialize keras-ocr pipeline: {e}") from e
        return cls._cached_pipeline

    def _prepare_for_ocr(self, frame: Any) -> Tuple[Any, Dict[str, Any]]:
        if frame is None:
            raise ValueError("OCR frame is empty")
        gray = frame if len(frame.shape) == 2 else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        mode = self.preprocess_mode if self.preprocess_mode in ("auto", "none", "gray", "threshold", "adaptive") else "auto"
        if mode in ("auto", "threshold"):
            blurred = cv2.GaussianBlur(gray, (3, 3), 0)
            _, ocr_img = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            applied_mode = "threshold"
        elif mode == "adaptive":
            ocr_img = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11)
            applied_mode = "adaptive"
        else:
            ocr_img = gray
            applied_mode = "gray"
        h, w = gray.shape[:2]
        sx = sy = 1.0
        if self.scale_factor > 1.0 and w > 0 and h > 0:
            nw, nh = max(1, int(round(w * self.scale_factor))), max(1, int(round(h * self.scale_factor)))
            if nw != w or nh != h:
                ocr_img = cv2.resize(ocr_img, (nw, nh), interpolation=cv2.INTER_CUBIC)
                sx, sy = float(nw) / float(w), float(nh) / float(h)
        return ocr_img, {"applied_preprocess": applied_mode, "scale_x": sx, "scale_y": sy, "orig_width": int(w), "orig_height": int(h)}

    def _to_pipeline_rgb(self, image: Any):
        arr = image
        if np is not None and getattr(arr, "dtype", None) != np.uint8:
            arr = np.clip(arr, 0, 255).astype(np.uint8)
        if getattr(arr, "ndim", 0) == 2:
            return cv2.cvtColor(arr, cv2.COLOR_GRAY2RGB)
        channels = int(arr.shape[2]) if getattr(arr, "ndim", 0) == 3 else 0
        if channels == 4:
            return cv2.cvtColor(arr, cv2.COLOR_BGRA2RGB)
        return cv2.cvtColor(arr, cv2.COLOR_BGR2RGB)

    def _box_to_bbox(self, box: Any, *, scale_x: float, scale_y: float, orig_w: int, orig_h: int) -> Optional[Dict[str, int]]:
        try:
            pts = np.asarray(box, dtype=np.float32)
        except Exception:
            return None
        if pts.ndim != 2 or pts.shape[0] < 4 or pts.shape[1] < 2:
            return None
        if scale_x <= 0:
            scale_x = 1.0
        if scale_y <= 0:
            scale_y = 1.0
        x1, y1 = float(pts[:, 0].min()) / scale_x, float(pts[:, 1].min()) / scale_y
        x2, y2 = float(pts[:, 0].max()) / scale_x, float(pts[:, 1].max()) / scale_y
        if orig_w > 0:
            x1, x2 = max(0.0, min(orig_w, x1)), max(0.0, min(orig_w, x2))
        if orig_h > 0:
            y1, y2 = max(0.0, min(orig_h, y1)), max(0.0, min(orig_h, y2))
        w, h = max(0.0, x2 - x1), max(0.0, y2 - y1)
        if w <= 0.0 or h <= 0.0:
            return None
        return {"x": int(round(x1)), "y": int(round(y1)), "w": int(round(w)), "h": int(round(h))}

    def _group_lines(self, words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not words:
            return []
        ordered = sorted(words, key=lambda w: ((w["bbox"]["y"] + (w["bbox"]["h"] * 0.5)), w["bbox"]["x"]))
        buckets: List[Dict[str, Any]] = []
        for word in ordered:
            cy, h = float(word["bbox"]["y"] + (word["bbox"]["h"] * 0.5)), float(max(1, word["bbox"]["h"]))
            chosen = None
            for bucket in buckets:
                tol = max(10.0, min(42.0, (bucket["avg_h"] + h) * 0.6))
                if abs(cy - bucket["cy"]) <= tol:
                    chosen = bucket
                    break
            if chosen is None:
                buckets.append({"cy": cy, "avg_h": h, "items": [word]})
            else:
                chosen["items"].append(word)
                n = len(chosen["items"])
                chosen["cy"] = ((chosen["cy"] * (n - 1)) + cy) / n
                chosen["avg_h"] = ((chosen["avg_h"] * (n - 1)) + h) / n
        lines: List[Dict[str, Any]] = []
        for bucket in sorted(buckets, key=lambda b: b["cy"]):
            items = sorted(bucket["items"], key=lambda w: w["bbox"]["x"])
            text = " ".join([str(w["text"]).strip() for w in items if str(w.get("text") or "").strip()]).strip()
            if not text:
                continue
            x1 = min(w["bbox"]["x"] for w in items)
            y1 = min(w["bbox"]["y"] for w in items)
            x2 = max(w["bbox"]["x"] + w["bbox"]["w"] for w in items)
            y2 = max(w["bbox"]["y"] + w["bbox"]["h"] for w in items)
            lines.append({"text": text, "confidence": None, "bbox": {"x": int(max(0, x1)), "y": int(max(0, y1)), "w": int(max(0, x2 - x1)), "h": int(max(0, y2 - y1))}})
        return lines

    def _parse_predictions(self, predictions: List[Any], prep_meta: Dict[str, Any]) -> Dict[str, Any]:
        sx, sy = float(prep_meta.get("scale_x") or 1.0), float(prep_meta.get("scale_y") or 1.0)
        ow, oh = int(prep_meta.get("orig_width") or 0), int(prep_meta.get("orig_height") or 0)
        words: List[Dict[str, Any]] = []
        for item in predictions or []:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            text = str(item[0] or "").strip()
            if not text:
                continue
            bbox = self._box_to_bbox(item[1], scale_x=sx, scale_y=sy, orig_w=ow, orig_h=oh)
            if bbox:
                words.append({"text": text, "confidence": None, "bbox": bbox})
        lines = self._group_lines(words)
        full_text = "\n".join([line["text"] for line in lines if line.get("text")]).strip()
        wt = lt = tt = False
        if len(words) > self.max_words:
            words, wt = words[: self.max_words], True
        if len(lines) > self.max_lines:
            lines, lt = lines[: self.max_lines], True
        if len(full_text) > self.max_text_chars:
            full_text, tt = full_text[: self.max_text_chars].rstrip() + "...", True
        return {"status": "ok", "text": full_text, "lines": lines, "words": words, "summary": {"line_count": len(lines), "word_count": len(words), "avg_confidence": None, "truncated": {"text": tt, "lines": lt, "words": wt}}, "image_shape": {"width": ow, "height": oh}, "warnings": []}

    def _run_ocr(self, frame: Any) -> Dict[str, Any]:
        lang = self._resolve_lang()
        prepared, prep_meta = self._prepare_for_ocr(frame)
        started = time.perf_counter()
        predictions = self._get_pipeline().recognize([self._to_pipeline_rgb(prepared)])
        parsed = self._parse_predictions(predictions[0] if predictions else [], prep_meta)
        parsed["preprocess"] = prep_meta.get("applied_preprocess")
        parsed["timing_ms"] = round((time.perf_counter() - started) * 1000.0, 1)
        parsed["language"] = lang
        return parsed

    def _build_error_result(self, message: str) -> Dict[str, Any]:
        return {"status": "error", "message": str(message or "OCR failed")}

    def _build_payload(self, *, mode: str, result: Optional[Dict[str, Any]], status: Optional[str] = None, message: Optional[str] = None, error: Optional[str] = None, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        lang = self._resolve_lang()
        payload: Dict[str, Any] = {"mode": mode, "status": status or (result.get("status") if isinstance(result, dict) else "ok") or "ok", "engine": "keras-ocr", "profile": self.ocr_profile, "language": lang, "text": "", "lines": [], "words": [], "summary": {"line_count": 0, "word_count": 0, "avg_confidence": None, "truncated": {"text": False, "lines": False, "words": False}}, "image_shape": None, "preprocess": self.preprocess_mode, "timing_ms": None, "warnings": list(self._lang_warnings or [])}
        if result and result.get("status") == "ok":
            merged_warnings = list(self._lang_warnings or [])
            merged_warnings.extend([str(w) for w in (result.get("warnings") or []) if str(w).strip()])
            payload.update({"status": "ok", "text": result.get("text") or "", "lines": result.get("lines") or [], "words": result.get("words") or [], "summary": result.get("summary") or payload["summary"], "image_shape": result.get("image_shape"), "preprocess": result.get("preprocess") or payload["preprocess"], "timing_ms": result.get("timing_ms"), "language": result.get("language") or lang, "warnings": merged_warnings})
            if not (payload.get("text") or "").strip():
                payload["message"] = "No text detected."
        else:
            if message:
                payload["message"] = str(message)
            if error:
                payload["error"] = str(error)
        if extra:
            payload.update(extra)
        return payload

    def _payload_to_text_output(self, payload: Optional[Dict[str, Any]]) -> str:
        if not isinstance(payload, dict):
            return ""
        text = str(payload.get("text") or "").strip()
        if text:
            return text
        status = str(payload.get("status") or "").strip().lower()
        if status == "warming_up":
            return str(payload.get("message") or "Waiting for source frames...")
        if status == "error":
            return str(payload.get("error") or payload.get("message") or "OCR failed")
        return str(payload.get("message") or "")

    def _draw_overlay(self, frame: Any, payload: Dict[str, Any]) -> Any:
        if cv2 is None or frame is None or (not self.draw_boxes and not self.draw_text):
            return frame
        overlay = frame.copy()
        for word in payload.get("words") or []:
            bbox = word.get("bbox") or {}
            x, y = int(_safe_int(bbox.get("x"), 0) or 0), int(_safe_int(bbox.get("y"), 0) or 0)
            w, h = int(_safe_int(bbox.get("w"), 0) or 0), int(_safe_int(bbox.get("h"), 0) or 0)
            if w <= 0 or h <= 0:
                continue
            if self.draw_boxes:
                cv2.rectangle(overlay, (x, y), (x + w, y + h), (40, 220, 80), 2)
            if self.draw_text:
                label = str(word.get("text") or "").strip()
                if label:
                    cv2.putText(overlay, label[:80], (x, max(14, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (30, 220, 255), 1, cv2.LINE_AA)
        status = str(payload.get("status") or "ok")
        word_count = (payload.get("summary") or {}).get("word_count", 0)
        header = f"OCR {status} | words={word_count}"
        cv2.putText(overlay, header[:100], (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(overlay, header[:100], (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (20, 20, 20), 1, cv2.LINE_AA)
        return overlay

    def cancel(self):
        try:
            get_stream_manager().stop_streams_by_owner(self.name)
        except Exception:
            pass
