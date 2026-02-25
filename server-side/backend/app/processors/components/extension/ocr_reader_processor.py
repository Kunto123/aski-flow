import os
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
    import pytesseract
    from pytesseract import Output as TesseractOutput
    from pytesseract.pytesseract import TesseractError, TesseractNotFoundError
except Exception:
    pytesseract = None
    TesseractOutput = None
    TesseractError = RuntimeError
    TesseractNotFoundError = RuntimeError

from ..processor import BasicProcessor
from ....streaming import get_stream_manager
from .media_ref_utils import extract_asset_filename, extract_stream_id, unwrap_primary_input


def _safe_float(value: Any, default: Optional[float] = None) -> Optional[float]:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def _safe_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    try:
        if value is None or value == "":
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
    # General-purpose defaults with a slightly lower confidence threshold so
    # small UI fonts are less likely to disappear entirely.
    "general": {
        "psm": 6,
        "oem": 3,
        "preprocess": "auto",
        "min_confidence": 15.0,
        "scale_factor": 1.8,
        "stream_fps": 10.0,
        "ocr_fps": 2.0,
        "draw_boxes": True,
        "draw_text": True,
    },
    # Better defaults for desktop screenshots (Explorer, app UIs, tables).
    "ui-screenshot": {
        "psm": 11,
        "oem": 3,
        "preprocess": "adaptive",
        "min_confidence": 8.0,
        "scale_factor": 2.5,
        "stream_fps": 10.0,
        "ocr_fps": 1.5,
        "draw_boxes": True,
        "draw_text": True,
    },
    "document": {
        "psm": 6,
        "oem": 3,
        "preprocess": "auto",
        "min_confidence": 20.0,
        "scale_factor": 2.0,
        "stream_fps": 10.0,
        "ocr_fps": 2.0,
        "draw_boxes": True,
        "draw_text": True,
    },
    "single-line": {
        "psm": 7,
        "oem": 3,
        "preprocess": "auto",
        "min_confidence": 5.0,
        "scale_factor": 2.2,
        "stream_fps": 10.0,
        "ocr_fps": 2.0,
        "draw_boxes": True,
        "draw_text": True,
    },
}


class OcrReaderProcessor(BasicProcessor):
    """OCR Reader using OpenCV preprocessing + pytesseract."""

    processor_type = "ocr-reader"

    _cached_languages: Optional[List[str]] = None

    def __init__(self, config):
        super().__init__(config)
        self.input_url = config.get("input_url")
        self.show_advanced = _to_bool(config.get("show_advanced"), False)
        self.ocr_profile = str(
            config.get("ocr_profile") or os.getenv("ASKI_OCR_PROFILE", "general")
        ).strip().lower() or "general"
        if self.ocr_profile not in OCR_PROFILE_DEFAULTS:
            self.ocr_profile = "general"
        profile_defaults = OCR_PROFILE_DEFAULTS.get(self.ocr_profile, OCR_PROFILE_DEFAULTS["general"])

        def _pick(
            name: str,
            env_key: str,
            fallback: Any = None,
            *,
            advanced: bool = False,
        ):
            # UX rule: when "Advanced Settings" is OFF, ignore any previously
            # saved advanced overrides in the node data and rely on the selected
            # preset (ocr_profile) or env defaults.
            if (not advanced) or self.show_advanced:
                if config.get(name) not in (None, ""):
                    return config.get(name)
            if advanced and not self.show_advanced:
                # Intentionally skip env-level advanced overrides too when user
                # chooses a preset-driven simple mode, unless the field is not
                # covered by a preset.
                if name in profile_defaults:
                    return profile_defaults.get(name)
                return fallback

            if config.get(name) not in (None, ""):
                return config.get(name)
            env_value = os.getenv(env_key)
            if env_value not in (None, ""):
                return env_value
            if name in profile_defaults:
                return profile_defaults.get(name)
            return fallback

        self.requested_lang = str(
            config.get("lang") or os.getenv("ASKI_OCR_LANG", "")
        ).strip()
        self.psm = _safe_int(_pick("psm", "ASKI_OCR_PSM", advanced=True), 6)
        self.oem = _safe_int(_pick("oem", "ASKI_OCR_OEM", advanced=True), 3)
        self.preprocess_mode = str(
            _pick("preprocess", "ASKI_OCR_PREPROCESS", "auto", advanced=True)
        ).strip().lower() or "auto"
        self.min_confidence = float(
            _safe_float(
                _pick("min_confidence", "ASKI_OCR_MIN_CONFIDENCE", 15.0, advanced=True),
                15.0,
            )
            or 15.0
        )
        self.stream_fps = float(
            _safe_float(_pick("stream_fps", "ASKI_OCR_STREAM_FPS", 10.0, advanced=True), 10.0)
            or 10.0
        )
        self.ocr_fps = float(
            _safe_float(_pick("ocr_fps", "ASKI_OCR_INFERENCE_FPS", 2.0, advanced=True), 2.0)
            or 2.0
        )
        self.draw_boxes = _to_bool(
            _pick("draw_boxes", "ASKI_OCR_DRAW_BOXES", True, advanced=True),
            True,
        )
        self.draw_text = _to_bool(
            _pick("draw_text", "ASKI_OCR_DRAW_TEXT", True, advanced=True),
            True,
        )
        self.max_words = max(
            20,
            int(
                _safe_int(config.get("max_words"), _safe_int(os.getenv("ASKI_OCR_MAX_WORDS"), 200))
                or 200
            ),
        )
        self.max_lines = max(
            5,
            int(
                _safe_int(config.get("max_lines"), _safe_int(os.getenv("ASKI_OCR_MAX_LINES"), 50))
                or 50
            ),
        )
        self.scale_factor = max(
            1.0,
            float(
                _safe_float(_pick("scale_factor", "ASKI_OCR_SCALE_FACTOR", 1.8, advanced=True), 1.8)
                or 1.8
            ),
        )
        self.max_text_chars = max(
            256,
            int(
                _safe_int(config.get("max_text_chars"), _safe_int(os.getenv("ASKI_OCR_MAX_TEXT_CHARS"), 4000))
                or 4000
            ),
        )
        self.extra_tesseract_config = str(
            _pick("tesseract_config", "ASKI_OCR_TESSERACT_CONFIG", "", advanced=True) or ""
        ).strip()
        self._effective_lang: Optional[str] = None
        self._lang_warnings: List[str] = []

    def process(self):
        self._ensure_dependencies()

        input_raw = self.get_input_by_name(
            "input_url",
            self.input_url,
            accept_object=True,
        )
        input_ref = self._normalize_input_ref(unwrap_primary_input(input_raw))
        if not input_ref:
            raise ValueError("ocr-reader requires input_url")

        stream_id = extract_stream_id(input_ref)
        if stream_id:
            return self._process_stream(stream_id)
        return self._process_file(input_ref)

    def _process_file(self, input_ref: str):
        image = self._load_image_from_ref(input_ref)

        result = self._run_ocr(image)
        payload = self._build_payload(
            mode="file",
            result=result,
            extra={
                "source_ref": input_ref,
                "live": False,
            },
        )
        # OCR should behave text-first for general users. Keep the original media ref
        # as the secondary output so advanced chains can still use it.
        return [self._payload_to_text_output(payload), input_ref]

    def _load_image_from_ref(self, input_ref: str):
        if not isinstance(input_ref, str) or not input_ref.strip():
            raise ValueError("ocr-reader requires a valid image reference")

        ref = input_ref.strip()
        filename = self._extract_local_asset_like_filename(ref)
        if filename:
            storage = self.get_storage()
            content = storage.get_file(filename)
            return self._decode_image_bytes(
                content,
                source_desc=f"asset:{filename}",
            )

        parsed = urlparse(ref)
        if parsed.scheme in ("http", "https"):
            content = self._download_http_bytes(ref)
            return self._decode_image_bytes(content, source_desc=ref)

        raise ValueError(
            "ocr-reader expects an image URL (/asset, /image, http/https) or stream:// ref"
        )

    def _extract_local_asset_like_filename(self, ref: str) -> Optional[str]:
        filename = extract_asset_filename(ref)
        if filename:
            return filename

        try:
            parsed = urlparse(ref)
            path = str(parsed.path or "")
        except Exception:
            path = str(ref or "")

        for marker in ("/image/",):
            if marker in path:
                raw = path.split(marker, 1)[1]
                safe = os.path.basename(raw).strip()
                return safe or None
        return None

    def _download_http_bytes(self, url: str) -> bytes:
        try:
            req = Request(
                url,
                headers={
                    "User-Agent": "aski-flow-ocr/1.0",
                },
            )
            with urlopen(req, timeout=20) as response:
                return response.read()
        except HTTPError as e:
            raise RuntimeError(
                f"OCR could not download the image (HTTP {getattr(e, 'code', 'error')}). "
                "The file URL may be expired. Re-upload or run the File node again."
            ) from e
        except URLError as e:
            raise RuntimeError(
                f"OCR could not download the image URL: {e.reason}"
            ) from e
        except Exception as e:
            raise RuntimeError(f"OCR could not download the image URL: {e}") from e

    def _decode_image_bytes(self, content: bytes, *, source_desc: str):
        if not content:
            raise RuntimeError("OCR input image is empty")
        image = cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError(f"Could not decode input image for OCR ({source_desc})")
        return image

    def _process_stream(self, source_stream_id: str):
        manager = get_stream_manager()
        manager.stop_streams_by_owner(self.name)

        inference_interval = 1.0 / max(float(self.ocr_fps), 0.2)
        last_inference_at = 0.0
        last_result: Optional[Dict[str, Any]] = None
        stream_meta: Dict[str, Optional[str]] = {
            "stream_id": None,
            "predictions_url": None,
        }

        source_frame = manager.get_latest_frame(source_stream_id)
        if source_frame is not None:
            try:
                last_result = self._run_ocr(source_frame)
                last_inference_at = time.monotonic()
            except Exception as e:
                last_result = self._build_error_result(str(e))
                last_inference_at = 0.0

        def _payload_from_result(result_obj: Optional[Dict[str, Any]]):
            if not result_obj:
                return self._build_payload(
                    mode="stream",
                    result=None,
                    status="warming_up",
                    message="Waiting for source frames...",
                    extra={
                        "live": True,
                        "stream_id": stream_meta.get("stream_id"),
                        "predictions_url": stream_meta.get("predictions_url"),
                    },
                )

            if result_obj.get("status") == "error":
                return self._build_payload(
                    mode="stream",
                    result=None,
                    status="error",
                    message=result_obj.get("message") or "OCR failed",
                    error=result_obj.get("message"),
                    extra={
                        "live": True,
                        "stream_id": stream_meta.get("stream_id"),
                        "predictions_url": stream_meta.get("predictions_url"),
                    },
                )

            return self._build_payload(
                mode="stream",
                result=result_obj,
                extra={
                    "live": True,
                    "stream_id": stream_meta.get("stream_id"),
                    "predictions_url": stream_meta.get("predictions_url"),
                },
            )

        def _transform(frame):
            nonlocal last_inference_at, last_result
            now = time.monotonic()
            should_infer = (now - last_inference_at) >= inference_interval or last_result is None

            if should_infer:
                try:
                    last_result = self._run_ocr(frame)
                except Exception as e:
                    # Keep stream alive even if OCR fails on a frame.
                    last_result = self._build_error_result(str(e))
                last_inference_at = now

            payload = _payload_from_result(last_result)
            overlay_frame = self._draw_overlay(frame, payload)
            return overlay_frame, payload

        out_stream_id = manager.create_transform_stream(
            source_stream_id,
            _transform,
            fps=max(1.0, float(self.stream_fps)),
            owner_name=self.name,
        )
        stream_meta["stream_id"] = out_stream_id
        stream_meta["predictions_url"] = manager.build_predictions_url(out_stream_id)

        initial_payload = _payload_from_result(last_result)
        manager.set_predictions(out_stream_id, initial_payload)

        return [
            self._payload_to_text_output(initial_payload),
            f"stream://{out_stream_id}",
        ]

    def _ensure_dependencies(self):
        if cv2 is None or np is None:
            raise RuntimeError("opencv-python and numpy are required for ocr-reader")
        if pytesseract is None or TesseractOutput is None:
            raise RuntimeError(
                "pytesseract is required for ocr-reader. Install backend dependencies first."
            )

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

    def _normalize_input_ref(self, value):
        if isinstance(value, dict):
            for key in ("url", "input_url", "image_url", "stream_ref", "asset_url"):
                candidate = value.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    return candidate
            return None
        return value

    def _get_installed_languages(self) -> List[str]:
        if self.__class__._cached_languages is not None:
            return list(self.__class__._cached_languages)

        try:
            self._ensure_dependencies()
            langs = pytesseract.get_languages(config="") or []
            normalized = sorted(
                {
                    str(lang).strip()
                    for lang in langs
                    if isinstance(lang, str) and str(lang).strip()
                }
            )
            self.__class__._cached_languages = normalized
            return list(normalized)
        except Exception:
            # Do not fail processor creation because language discovery is unavailable.
            self.__class__._cached_languages = []
            return []

    def _resolve_lang(self) -> str:
        if self._effective_lang:
            return self._effective_lang

        installed = set(self._get_installed_languages())
        warnings: List[str] = []

        def _default_lang() -> str:
            if "eng" in installed and "ind" in installed:
                return "eng+ind"
            if "ind" in installed:
                return "ind"
            if "eng" in installed:
                return "eng"
            preferred = [lang for lang in sorted(installed) if lang != "osd"]
            return preferred[0] if preferred else "eng"

        requested = self.requested_lang
        if requested:
            requested_parts = [
                part.strip()
                for part in requested.replace(",", "+").split("+")
                if part.strip()
            ]
            if installed and requested_parts:
                available_parts = [part for part in requested_parts if part in installed]
                missing_parts = [part for part in requested_parts if part not in installed]
                if available_parts:
                    lang = "+".join(available_parts)
                    if missing_parts:
                        warnings.append(
                            "Missing Tesseract language(s): "
                            + ", ".join(missing_parts)
                            + ". Using: "
                            + lang
                        )
                else:
                    lang = _default_lang()
                    warnings.append(
                        "Requested OCR language(s) not installed. Using: " + lang
                    )
            else:
                lang = requested
        else:
            lang = _default_lang()

        self._effective_lang = lang
        self._lang_warnings = warnings
        return lang

    def _build_tesseract_config(self) -> str:
        parts: List[str] = []
        if self.oem is not None:
            parts.extend(["--oem", str(int(self.oem))])
        if self.psm is not None:
            parts.extend(["--psm", str(int(self.psm))])
        if self.extra_tesseract_config:
            parts.append(self.extra_tesseract_config)
        return " ".join(parts).strip()

    def _prepare_for_ocr(self, frame: Any) -> Tuple[Any, Dict[str, Any]]:
        if frame is None:
            raise ValueError("OCR frame is empty")

        if len(frame.shape) == 2:
            gray = frame
        else:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        mode = self.preprocess_mode
        if mode not in ("auto", "none", "gray", "threshold", "adaptive"):
            mode = "auto"

        ocr_img = gray
        applied_mode = mode
        if mode in ("auto", "threshold"):
            blurred = cv2.GaussianBlur(gray, (3, 3), 0)
            _, ocr_img = cv2.threshold(
                blurred,
                0,
                255,
                cv2.THRESH_BINARY + cv2.THRESH_OTSU,
            )
            applied_mode = "threshold"
        elif mode == "adaptive":
            ocr_img = cv2.adaptiveThreshold(
                gray,
                255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY,
                31,
                11,
            )
        elif mode == "none":
            # pytesseract accepts BGR arrays, but grayscale is safer/consistent here.
            ocr_img = gray
            applied_mode = "gray"
        else:
            ocr_img = gray
            applied_mode = "gray"

        scale_factor = float(self.scale_factor or 1.0)
        scale_factor = max(1.0, scale_factor)
        h, w = gray.shape[:2]
        scale_x = 1.0
        scale_y = 1.0
        if scale_factor > 1.0 and w > 0 and h > 0:
            new_w = max(1, int(round(w * scale_factor)))
            new_h = max(1, int(round(h * scale_factor)))
            if new_w != w or new_h != h:
                ocr_img = cv2.resize(ocr_img, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
                scale_x = float(new_w) / float(w)
                scale_y = float(new_h) / float(h)

        return ocr_img, {
            "applied_preprocess": applied_mode,
            "scale_x": scale_x,
            "scale_y": scale_y,
            "orig_width": int(w),
            "orig_height": int(h),
        }

    def _call_tesseract_data(self, image: Any, *, lang: str, tesseract_config: str):
        try:
            return pytesseract.image_to_data(
                image,
                lang=lang,
                config=tesseract_config,
                output_type=TesseractOutput.DICT,
            )
        except TesseractNotFoundError as e:
            raise RuntimeError(
                "Tesseract executable not found. Ensure tesseract.exe is installed and available in PATH."
            ) from e
        except TesseractError as e:
            raise RuntimeError(f"Tesseract OCR failed: {e}") from e

    def _score_ocr_result(self, result: Dict[str, Any]) -> Tuple[int, float, int]:
        summary = result.get("summary") or {}
        word_count = int(summary.get("word_count") or 0)
        avg_conf = float(summary.get("avg_confidence") or 0.0)
        text_len = len(str(result.get("text") or "").strip())
        return (word_count, avg_conf, text_len)

    def _run_ocr(self, frame: Any) -> Dict[str, Any]:
        lang = self._resolve_lang()
        tesseract_config = self._build_tesseract_config()
        prepared, prep_meta = self._prepare_for_ocr(frame)
        started = time.perf_counter()
        candidates: List[Dict[str, Any]] = []

        base_data = self._call_tesseract_data(
            prepared,
            lang=lang,
            tesseract_config=tesseract_config,
        )
        parsed_base = self._parse_ocr_data(
            base_data,
            prep_meta,
            min_confidence=self.min_confidence,
        )
        parsed_base["preprocess"] = prep_meta.get("applied_preprocess")
        candidates.append(parsed_base)

        # If all words were filtered by confidence, retry with zero threshold so users
        # still get something useful instead of "No text detected."
        if (
            int((parsed_base.get("summary") or {}).get("word_count") or 0) == 0
            and float(self.min_confidence) > 0
        ):
            parsed_low_conf = self._parse_ocr_data(
                base_data,
                prep_meta,
                min_confidence=0.0,
            )
            if int((parsed_low_conf.get("summary") or {}).get("word_count") or 0) > 0:
                warnings = list(parsed_low_conf.get("warnings") or [])
                warnings.append(
                    "Low-confidence fallback used because no words met the minimum confidence threshold."
                )
                parsed_low_conf["warnings"] = warnings
                parsed_low_conf["preprocess"] = prep_meta.get("applied_preprocess")
                candidates.append(parsed_low_conf)

        # Common screenshot failure mode (dark UI / white text): retry inverted image.
        can_try_invert = getattr(prepared, "ndim", 0) == 2
        if can_try_invert and max(self._score_ocr_result(candidates[0])) == 0:
            inverted = cv2.bitwise_not(prepared)
            inv_data = self._call_tesseract_data(
                inverted,
                lang=lang,
                tesseract_config=tesseract_config,
            )

            parsed_inv = self._parse_ocr_data(
                inv_data,
                prep_meta,
                min_confidence=self.min_confidence,
            )
            if int((parsed_inv.get("summary") or {}).get("word_count") or 0) > 0:
                warnings = list(parsed_inv.get("warnings") or [])
                warnings.append(
                    "Auto-invert fallback used (useful for dark UI screenshots)."
                )
                parsed_inv["warnings"] = warnings
            parsed_inv["preprocess"] = f"{prep_meta.get('applied_preprocess')}-invert"
            candidates.append(parsed_inv)

            if (
                int((parsed_inv.get("summary") or {}).get("word_count") or 0) == 0
                and float(self.min_confidence) > 0
            ):
                parsed_inv_low_conf = self._parse_ocr_data(
                    inv_data,
                    prep_meta,
                    min_confidence=0.0,
                )
                if int((parsed_inv_low_conf.get("summary") or {}).get("word_count") or 0) > 0:
                    warnings = list(parsed_inv_low_conf.get("warnings") or [])
                    warnings.append(
                        "Auto-invert + low-confidence fallback used."
                    )
                    parsed_inv_low_conf["warnings"] = warnings
                    parsed_inv_low_conf["preprocess"] = f"{prep_meta.get('applied_preprocess')}-invert"
                    candidates.append(parsed_inv_low_conf)

        best = max(candidates, key=self._score_ocr_result) if candidates else {
            "status": "ok",
            "text": "",
            "lines": [],
            "words": [],
            "summary": {"line_count": 0, "word_count": 0, "avg_confidence": None},
        }
        elapsed_ms = round((time.perf_counter() - started) * 1000.0, 1)
        best["timing_ms"] = elapsed_ms
        best["language"] = lang
        if not best.get("preprocess"):
            best["preprocess"] = prep_meta.get("applied_preprocess")
        return best

    def _parse_ocr_data(
        self,
        data: Dict[str, Any],
        prep_meta: Dict[str, Any],
        *,
        min_confidence: Optional[float] = None,
    ) -> Dict[str, Any]:
        texts = data.get("text") or []
        count = len(texts)
        scale_x = float(prep_meta.get("scale_x") or 1.0)
        scale_y = float(prep_meta.get("scale_y") or 1.0)
        orig_w = int(prep_meta.get("orig_width") or 0)
        orig_h = int(prep_meta.get("orig_height") or 0)
        effective_min_conf = (
            float(self.min_confidence)
            if min_confidence is None
            else float(min_confidence)
        )

        words: List[Dict[str, Any]] = []
        line_map: Dict[Tuple[int, int, int, int], Dict[str, Any]] = {}
        confidences: List[float] = []

        def _scaled_int(raw_value: Any, divisor: float) -> int:
            value = _safe_int(raw_value, 0) or 0
            if divisor <= 0:
                divisor = 1.0
            return int(round(float(value) / divisor))

        for i in range(count):
            text = str(texts[i] or "").strip()
            if not text:
                continue

            conf = _safe_float((data.get("conf") or [None])[i], None)
            if conf is not None and conf < 0:
                conf = None
            if conf is not None and conf < effective_min_conf:
                continue

            x = _scaled_int((data.get("left") or [0])[i], scale_x)
            y = _scaled_int((data.get("top") or [0])[i], scale_y)
            w = _scaled_int((data.get("width") or [0])[i], scale_x)
            h = _scaled_int((data.get("height") or [0])[i], scale_y)
            w = max(0, w)
            h = max(0, h)

            word = {
                "text": text,
                "confidence": None if conf is None else round(float(conf), 2),
                "bbox": {
                    "x": int(max(0, x)),
                    "y": int(max(0, y)),
                    "w": int(w),
                    "h": int(h),
                },
            }
            words.append(word)
            if conf is not None:
                confidences.append(float(conf))

            key = (
                _safe_int((data.get("page_num") or [1])[i], 1) or 1,
                _safe_int((data.get("block_num") or [0])[i], 0) or 0,
                _safe_int((data.get("par_num") or [0])[i], 0) or 0,
                _safe_int((data.get("line_num") or [0])[i], 0) or 0,
            )
            line = line_map.get(key)
            if line is None:
                line = {
                    "words": [],
                    "confidences": [],
                    "bbox": {
                        "x1": word["bbox"]["x"],
                        "y1": word["bbox"]["y"],
                        "x2": word["bbox"]["x"] + word["bbox"]["w"],
                        "y2": word["bbox"]["y"] + word["bbox"]["h"],
                    },
                }
                line_map[key] = line

            line["words"].append(text)
            if conf is not None:
                line["confidences"].append(float(conf))
            bbox = line["bbox"]
            bbox["x1"] = min(int(bbox["x1"]), int(word["bbox"]["x"]))
            bbox["y1"] = min(int(bbox["y1"]), int(word["bbox"]["y"]))
            bbox["x2"] = max(
                int(bbox["x2"]),
                int(word["bbox"]["x"]) + int(word["bbox"]["w"]),
            )
            bbox["y2"] = max(
                int(bbox["y2"]),
                int(word["bbox"]["y"]) + int(word["bbox"]["h"]),
            )

        lines: List[Dict[str, Any]] = []
        for _, line in line_map.items():
            line_text = " ".join([part for part in line["words"] if part]).strip()
            if not line_text:
                continue
            bbox = line["bbox"]
            line_conf = None
            if line["confidences"]:
                line_conf = round(sum(line["confidences"]) / len(line["confidences"]), 2)
            lines.append(
                {
                    "text": line_text,
                    "confidence": line_conf,
                    "bbox": {
                        "x": int(max(0, bbox["x1"])),
                        "y": int(max(0, bbox["y1"])),
                        "w": int(max(0, bbox["x2"] - bbox["x1"])),
                        "h": int(max(0, bbox["y2"] - bbox["y1"])),
                    },
                }
            )

        avg_conf = round(sum(confidences) / len(confidences), 2) if confidences else None
        full_text = "\n".join([line["text"] for line in lines]).strip()

        words_truncated = False
        if len(words) > self.max_words:
            words = words[: self.max_words]
            words_truncated = True

        lines_truncated = False
        if len(lines) > self.max_lines:
            lines = lines[: self.max_lines]
            lines_truncated = True

        text_truncated = False
        if len(full_text) > self.max_text_chars:
            full_text = full_text[: self.max_text_chars].rstrip() + "..."
            text_truncated = True

        return {
            "status": "ok",
            "text": full_text,
            "lines": lines,
            "words": words,
            "summary": {
                "line_count": len(lines),
                "word_count": len(words),
                "avg_confidence": avg_conf,
                "truncated": {
                    "text": text_truncated,
                    "lines": lines_truncated,
                    "words": words_truncated,
                },
            },
            "image_shape": {
                "width": int(orig_w),
                "height": int(orig_h),
            },
            "warnings": [],
        }

    def _build_error_result(self, message: str) -> Dict[str, Any]:
        return {
            "status": "error",
            "message": str(message or "OCR failed"),
        }

    def _build_payload(
        self,
        *,
        mode: str,
        result: Optional[Dict[str, Any]],
        status: Optional[str] = None,
        message: Optional[str] = None,
        error: Optional[str] = None,
        extra: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        lang = self._resolve_lang()
        payload: Dict[str, Any] = {
            "mode": mode,
            "status": status or (result.get("status") if isinstance(result, dict) else "ok") or "ok",
            "engine": "tesseract",
            "profile": self.ocr_profile,
            "language": lang,
            "text": "",
            "lines": [],
            "words": [],
            "summary": {
                "line_count": 0,
                "word_count": 0,
                "avg_confidence": None,
                "truncated": {
                    "text": False,
                    "lines": False,
                    "words": False,
                },
            },
            "image_shape": None,
            "preprocess": self.preprocess_mode,
            "timing_ms": None,
            "warnings": list(self._lang_warnings or []),
        }

        if result and result.get("status") == "ok":
            merged_warnings = list(self._lang_warnings or [])
            merged_warnings.extend([str(w) for w in (result.get("warnings") or []) if str(w).strip()])
            payload.update(
                {
                    "status": "ok",
                    "text": result.get("text") or "",
                    "lines": result.get("lines") or [],
                    "words": result.get("words") or [],
                    "summary": result.get("summary") or payload["summary"],
                    "image_shape": result.get("image_shape"),
                    "preprocess": result.get("preprocess") or payload.get("preprocess"),
                    "timing_ms": result.get("timing_ms"),
                    "language": result.get("language") or lang,
                    "warnings": merged_warnings,
                }
            )
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
        if cv2 is None:
            return frame
        if frame is None:
            return frame

        if not self.draw_boxes and not self.draw_text:
            return frame

        overlay = frame.copy()
        words = payload.get("words") or []
        for word in words:
            bbox = word.get("bbox") or {}
            x = int(_safe_int(bbox.get("x"), 0) or 0)
            y = int(_safe_int(bbox.get("y"), 0) or 0)
            w = int(_safe_int(bbox.get("w"), 0) or 0)
            h = int(_safe_int(bbox.get("h"), 0) or 0)
            if w <= 0 or h <= 0:
                continue

            if self.draw_boxes:
                cv2.rectangle(overlay, (x, y), (x + w, y + h), (40, 220, 80), 2)

            if self.draw_text:
                label = str(word.get("text") or "").strip()
                conf = word.get("confidence")
                if conf is not None:
                    label = f"{label} ({conf:.0f}%)"
                if label:
                    cv2.putText(
                        overlay,
                        label[:80],
                        (x, max(14, y - 4)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.45,
                        (30, 220, 255),
                        1,
                        cv2.LINE_AA,
                    )

        summary = payload.get("summary") or {}
        status = str(payload.get("status") or "ok")
        text_header = f"OCR {status} | words={summary.get('word_count', 0)}"
        cv2.putText(
            overlay,
            text_header[:100],
            (10, 22),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            overlay,
            text_header[:100],
            (10, 22),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (20, 20, 20),
            1,
            cv2.LINE_AA,
        )
        return overlay

    def cancel(self):
        try:
            get_stream_manager().stop_streams_by_owner(self.name)
        except Exception:
            pass
