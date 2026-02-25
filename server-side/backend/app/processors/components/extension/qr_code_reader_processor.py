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

from ..processor import BasicProcessor
from ...launcher.event_type import EventType
from ...launcher.processor_event import ProcessorEvent
from ....streaming import get_stream_manager
from .media_ref_utils import (
    extract_asset_filename,
    extract_stream_id,
    unwrap_primary_input,
)


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


class QrCodeReaderProcessor(BasicProcessor):
    """QR Code Reader using OpenCV QRCodeDetector."""

    processor_type = "qr-code-reader"

    def __init__(self, config):
        super().__init__(config)
        self.input_url = config.get("input_url")
        self.stream_fps = max(
            1.0,
            float(
                _safe_float(
                    config.get("stream_fps"),
                    _safe_float(os.getenv("ASKI_QR_STREAM_FPS"), 10.0),
                )
                or 10.0
            ),
        )
        self.qr_fps = max(
            0.5,
            float(
                _safe_float(
                    config.get("qr_fps"),
                    _safe_float(
                        os.getenv("ASKI_QR_INFERENCE_FPS")
                        or os.getenv("ASKI_QR_DECODE_FPS"),
                        4.0,
                    ),
                )
                or 4.0
            ),
        )
        self.draw_boxes = _to_bool(
            config.get("draw_boxes"),
            _to_bool(os.getenv("ASKI_QR_DRAW_BOXES"), True),
        )
        self.draw_text = _to_bool(
            config.get("draw_text"),
            _to_bool(os.getenv("ASKI_QR_DRAW_TEXT"), True),
        )
        self.max_codes = max(
            1,
            int(
                _safe_int(
                    config.get("max_codes"),
                    _safe_int(os.getenv("ASKI_QR_MAX_CODES"), 20),
                )
                or 20
            ),
        )
        self.max_text_chars = max(
            128,
            int(
                _safe_int(
                    config.get("max_text_chars"),
                    _safe_int(os.getenv("ASKI_QR_MAX_TEXT_CHARS"), 4000),
                )
                or 4000
            ),
        )
        self._detector = None

    def process(self):
        self._ensure_dependencies()

        input_raw = self.get_input_by_name(
            "input_url",
            self.input_url,
            accept_object=True,
        )
        input_ref = self._normalize_input_ref(unwrap_primary_input(input_raw))
        if not input_ref:
            raise ValueError("qr-code-reader requires input_url")

        stream_id = extract_stream_id(input_ref)
        if stream_id:
            return self._process_stream(stream_id)
        return self._process_file(input_ref)

    def _process_file(self, input_ref: str):
        image = self._load_image_from_ref(input_ref)
        result = self._run_qr(image)
        payload = self._build_payload(
            mode="file",
            result=result,
            extra={
                "source_ref": input_ref,
                "live": False,
            },
        )
        # Text-first for user-facing Display nodes; keep original media ref as
        # the second output for downstream visualization/processing if needed.
        return [self._payload_to_text_output(payload), input_ref]

    def _process_stream(self, source_stream_id: str):
        manager = get_stream_manager()
        manager.stop_streams_by_owner(self.name)

        inference_interval = 1.0 / max(float(self.qr_fps), 0.5)
        last_inference_at = 0.0
        last_result: Optional[Dict[str, Any]] = None
        stream_meta: Dict[str, Optional[str]] = {
            "stream_id": None,
            "predictions_url": None,
        }
        last_emitted_text = {"value": None}

        source_frame = manager.get_latest_frame(source_stream_id)
        if source_frame is not None:
            try:
                last_result = self._run_qr(source_frame)
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
                    message=result_obj.get("message") or "QR decoding failed",
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
                    last_result = self._run_qr(frame)
                except Exception as e:
                    last_result = self._build_error_result(str(e))
                last_inference_at = now

            payload = _payload_from_result(last_result)
            overlay_frame = self._draw_overlay(frame, payload)
            self._maybe_emit_stream_text_update(payload, stream_meta, last_emitted_text)
            return overlay_frame, payload

        out_stream_id = manager.create_transform_stream(
            source_stream_id,
            _transform,
            fps=max(1.0, float(self.stream_fps)),
            owner_name=self.name,
        )
        stream_meta["stream_id"] = out_stream_id
        try:
            stream_meta["predictions_url"] = manager.build_predictions_url(out_stream_id)
        except Exception:
            stream_meta["predictions_url"] = None

        initial_payload = _payload_from_result(last_result)
        try:
            manager.set_predictions(out_stream_id, initial_payload)
        except Exception:
            pass

        return [
            self._payload_to_text_output(initial_payload),
            f"stream://{out_stream_id}",
        ]

    def _maybe_emit_stream_text_update(
        self,
        payload: Dict[str, Any],
        stream_meta: Dict[str, Optional[str]],
        last_emitted_text: Dict[str, Optional[str]],
    ) -> None:
        stream_id = str(stream_meta.get("stream_id") or "").strip()
        if not stream_id:
            return

        text_output = self._payload_to_text_output(payload)
        if not isinstance(text_output, str):
            text_output = str(text_output or "")

        if last_emitted_text.get("value") == text_output:
            return

        stream_ref = f"stream://{stream_id}"
        output = [text_output, stream_ref]

        try:
            self.set_output(output)
        except Exception:
            pass

        try:
            self.notify(
                EventType.STREAMING,
                ProcessorEvent(source=self, output=output),
            )
        except Exception:
            return

        last_emitted_text["value"] = text_output

    def _ensure_dependencies(self):
        if cv2 is None or np is None:
            raise RuntimeError("opencv-python and numpy are required for qr-code-reader")
        if not hasattr(cv2, "QRCodeDetector"):
            raise RuntimeError("OpenCV QRCodeDetector is not available in this build")

    def _normalize_input_ref(self, value):
        if isinstance(value, dict):
            for key in ("url", "input_url", "image_url", "stream_ref", "asset_url"):
                candidate = value.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    return candidate
            return None
        return value

    def _load_image_from_ref(self, input_ref: str):
        if not isinstance(input_ref, str) or not input_ref.strip():
            raise ValueError("qr-code-reader requires a valid image reference")

        ref = input_ref.strip()
        filename = self._extract_local_asset_like_filename(ref)
        if filename:
            storage = self.get_storage()
            content = storage.get_file(filename)
            return self._decode_image_bytes(content, source_desc=f"asset:{filename}")

        parsed = urlparse(ref)
        if parsed.scheme in ("http", "https"):
            content = self._download_http_bytes(ref)
            return self._decode_image_bytes(content, source_desc=ref)

        raise ValueError(
            "qr-code-reader expects an image URL (/asset, /image, http/https) or stream:// ref"
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
                headers={"User-Agent": "aski-flow-qr/1.0"},
            )
            with urlopen(req, timeout=20) as response:
                return response.read()
        except HTTPError as e:
            raise RuntimeError(
                f"QR reader could not download the image (HTTP {getattr(e, 'code', 'error')}). "
                "The file URL may be expired. Re-upload or run the File node again."
            ) from e
        except URLError as e:
            raise RuntimeError(f"QR reader could not download the image URL: {e.reason}") from e
        except Exception as e:
            raise RuntimeError(f"QR reader could not download the image URL: {e}") from e

    def _decode_image_bytes(self, content: bytes, *, source_desc: str):
        if not content:
            raise RuntimeError("QR input image is empty")
        image = cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError(f"Could not decode input image for QR reader ({source_desc})")
        return image

    def _get_detector(self):
        if self._detector is None:
            self._detector = cv2.QRCodeDetector()
        return self._detector

    def _run_qr(self, frame: Any) -> Dict[str, Any]:
        if frame is None:
            raise ValueError("QR frame is empty")

        started = time.perf_counter()
        h = int(getattr(frame, "shape", [0, 0])[0] or 0)
        w = int(getattr(frame, "shape", [0, 0])[1] or 0)
        variants = self._build_variants(frame)

        attempts: List[Dict[str, Any]] = []
        for variant_name, variant_frame, scale_x, scale_y in variants:
            attempt = self._decode_variant(
                variant_frame,
                variant_name=variant_name,
                scale_x=scale_x,
                scale_y=scale_y,
            )
            attempts.append(attempt)
            if int(attempt.get("summary", {}).get("count") or 0) > 0:
                break

        best = (
            max(attempts, key=self._score_result)
            if attempts
            else {
                "status": "ok",
                "qr_text": "",
                "texts": [],
                "codes": [],
                "summary": {"count": 0},
                "variant": "original",
                "warnings": [],
            }
        )

        elapsed_ms = round((time.perf_counter() - started) * 1000.0, 1)
        best["timing_ms"] = elapsed_ms
        best["image_shape"] = {
            "width": w,
            "height": h,
        }
        if attempts and best is attempts[-1] and best.get("variant") != "original":
            warnings = list(best.get("warnings") or [])
            warnings.append(f"Fallback decode variant used: {best.get('variant')}")
            best["warnings"] = warnings
        return best

    def _build_variants(self, frame: Any) -> List[Tuple[str, Any, float, float]]:
        variants: List[Tuple[str, Any, float, float]] = [("original", frame, 1.0, 1.0)]

        gray = frame
        if getattr(frame, "ndim", 0) == 3:
            try:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                variants.append(("gray", gray, 1.0, 1.0))
            except Exception:
                gray = frame

        # Threshold fallback can help with screenshots/printed codes.
        if getattr(gray, "ndim", 0) == 2:
            try:
                blurred = cv2.GaussianBlur(gray, (3, 3), 0)
                _, thresh = cv2.threshold(
                    blurred,
                    0,
                    255,
                    cv2.THRESH_BINARY + cv2.THRESH_OTSU,
                )
                variants.append(("threshold", thresh, 1.0, 1.0))
            except Exception:
                pass
            try:
                adaptive = cv2.adaptiveThreshold(
                    gray,
                    255,
                    cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                    cv2.THRESH_BINARY,
                    31,
                    11,
                )
                variants.append(("adaptive", adaptive, 1.0, 1.0))
            except Exception:
                pass

            # Upscale small QR images to improve decode reliability.
            h, w = gray.shape[:2]
            if h > 0 and w > 0 and min(h, w) < 1200:
                scale = 2.0
                new_w = max(1, int(round(w * scale)))
                new_h = max(1, int(round(h * scale)))
                try:
                    up_gray = cv2.resize(gray, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
                    variants.append(("gray-x2", up_gray, scale, scale))
                except Exception:
                    pass
                try:
                    _, up_thresh = cv2.threshold(
                        cv2.GaussianBlur(up_gray, (3, 3), 0),
                        0,
                        255,
                        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
                    )
                    variants.append(("threshold-x2", up_thresh, scale, scale))
                except Exception:
                    pass
                try:
                    up_adaptive = cv2.adaptiveThreshold(
                        up_gray,
                        255,
                        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                        cv2.THRESH_BINARY,
                        31,
                        11,
                    )
                    variants.append(("adaptive-x2", up_adaptive, scale, scale))
                except Exception:
                    pass

        return variants

    def _decode_variant(
        self,
        frame: Any,
        *,
        variant_name: str,
        scale_x: float,
        scale_y: float,
    ) -> Dict[str, Any]:
        detector = self._get_detector()
        codes: List[Dict[str, Any]] = []

        # Try multi-code decode first (OpenCV version dependent), then single-code.
        multi_points = None
        decoded_info = None
        multi_success = False
        if hasattr(detector, "detectAndDecodeMulti"):
            try:
                multi_result = detector.detectAndDecodeMulti(frame)
                if isinstance(multi_result, tuple):
                    if len(multi_result) >= 4 and isinstance(multi_result[0], (bool, int)):
                        multi_success = bool(multi_result[0])
                        decoded_info = multi_result[1]
                        multi_points = multi_result[2]
                    elif len(multi_result) >= 3:
                        decoded_info = multi_result[0]
                        multi_points = multi_result[1]
                        multi_success = bool(decoded_info)
            except Exception:
                multi_success = False
                decoded_info = None
                multi_points = None

        if multi_success and decoded_info is not None:
            point_sets = self._normalize_point_sets(multi_points)
            decoded_list = list(decoded_info) if isinstance(decoded_info, (list, tuple)) else [decoded_info]
            for i, raw_text in enumerate(decoded_list):
                text = str(raw_text or "").strip()
                if not text:
                    continue
                pts = point_sets[i] if i < len(point_sets) else None
                codes.append(self._build_code_entry(text, pts, scale_x=scale_x, scale_y=scale_y))

        if not codes:
            try:
                text, points, _ = detector.detectAndDecode(frame)
            except Exception:
                text, points = "", None
            text = str(text or "").strip()
            if text:
                codes.append(self._build_code_entry(text, points, scale_x=scale_x, scale_y=scale_y))

        # Deduplicate by text+bbox and cap payload size.
        deduped: List[Dict[str, Any]] = []
        seen = set()
        for code in codes:
            bbox = code.get("bbox") or {}
            key = (
                str(code.get("text") or ""),
                int(bbox.get("x") or 0),
                int(bbox.get("y") or 0),
                int(bbox.get("w") or 0),
                int(bbox.get("h") or 0),
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(code)
            if len(deduped) >= self.max_codes:
                break

        texts = [str(item.get("text") or "").strip() for item in deduped if str(item.get("text") or "").strip()]
        qr_text = "\n".join(texts).strip()
        if len(qr_text) > self.max_text_chars:
            qr_text = qr_text[: self.max_text_chars].rstrip() + "..."

        return {
            "status": "ok",
            "qr_text": qr_text,
            "texts": texts,
            "codes": deduped,
            "summary": {
                "count": len(deduped),
            },
            "variant": variant_name,
            "warnings": [],
        }

    def _score_result(self, result: Dict[str, Any]) -> Tuple[int, int]:
        summary = result.get("summary") or {}
        count = int(summary.get("count") or 0)
        text_len = len(str(result.get("qr_text") or "").strip())
        return (count, text_len)

    def _normalize_point_sets(self, points) -> List[Any]:
        if points is None:
            return []
        try:
            arr = np.array(points, dtype=np.float32)
        except Exception:
            return []
        if arr.size == 0:
            return []

        if arr.ndim == 2 and arr.shape[-1] == 2 and arr.shape[0] == 4:
            return [arr]

        try:
            reshaped = arr.reshape((-1, 4, 2))
            return [reshaped[i] for i in range(reshaped.shape[0])]
        except Exception:
            return []

    def _build_code_entry(self, text: str, points, *, scale_x: float, scale_y: float) -> Dict[str, Any]:
        point_sets = self._normalize_point_sets(points)
        pts = point_sets[0] if point_sets else None

        corners: List[Dict[str, int]] = []
        bbox = {"x": 0, "y": 0, "w": 0, "h": 0}
        if pts is not None:
            safe_scale_x = float(scale_x or 1.0) if float(scale_x or 1.0) > 0 else 1.0
            safe_scale_y = float(scale_y or 1.0) if float(scale_y or 1.0) > 0 else 1.0
            xs: List[int] = []
            ys: List[int] = []
            for p in pts:
                x = int(round(float(p[0]) / safe_scale_x))
                y = int(round(float(p[1]) / safe_scale_y))
                corners.append({"x": x, "y": y})
                xs.append(x)
                ys.append(y)
            if xs and ys:
                x1, x2 = min(xs), max(xs)
                y1, y2 = min(ys), max(ys)
                bbox = {
                    "x": int(max(0, x1)),
                    "y": int(max(0, y1)),
                    "w": int(max(0, x2 - x1)),
                    "h": int(max(0, y2 - y1)),
                }

        return {
            "text": text,
            "bbox": bbox,
            "corners": corners,
        }

    def _build_error_result(self, message: str) -> Dict[str, Any]:
        return {
            "status": "error",
            "message": str(message or "QR decoding failed"),
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
        payload: Dict[str, Any] = {
            "mode": mode,
            "status": status or (result.get("status") if isinstance(result, dict) else "ok") or "ok",
            "engine": "opencv-qrcode",
            "qr_text": "",
            "texts": [],
            "codes": [],
            "summary": {"count": 0},
            "variant": None,
            "timing_ms": None,
            "image_shape": None,
            "warnings": [],
        }

        if result and result.get("status") == "ok":
            payload.update(
                {
                    "status": "ok",
                    "qr_text": str(result.get("qr_text") or "").strip(),
                    "texts": result.get("texts") or [],
                    "codes": result.get("codes") or [],
                    "summary": result.get("summary") or payload["summary"],
                    "variant": result.get("variant"),
                    "timing_ms": result.get("timing_ms"),
                    "image_shape": result.get("image_shape"),
                    "warnings": result.get("warnings") or [],
                }
            )
            if not payload["qr_text"]:
                payload["message"] = "No QR code detected."
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

        qr_text = str(payload.get("qr_text") or "").strip()
        if qr_text:
            return qr_text

        status = str(payload.get("status") or "").strip().lower()
        if status == "warming_up":
            return str(payload.get("message") or "Waiting for source frames...")

        if status == "error":
            return str(payload.get("error") or payload.get("message") or "QR decoding failed")

        return str(payload.get("message") or "")

    def _draw_overlay(self, frame: Any, payload: Dict[str, Any]) -> Any:
        if cv2 is None:
            return frame
        if frame is None:
            return frame
        if not self.draw_boxes and not self.draw_text:
            return frame

        overlay = frame.copy()
        codes = payload.get("codes") or []
        for code in codes:
            corners = code.get("corners") or []
            pts = []
            for corner in corners:
                x = int(_safe_int(corner.get("x"), 0) or 0)
                y = int(_safe_int(corner.get("y"), 0) or 0)
                pts.append([x, y])

            if self.draw_boxes and len(pts) >= 4:
                try:
                    pts_np = np.array([pts], dtype=np.int32)
                    cv2.polylines(overlay, [pts_np[0]], True, (40, 220, 80), 2)
                except Exception:
                    pass

            if self.draw_text:
                label = str(code.get("text") or "").strip()
                bbox = code.get("bbox") or {}
                x = int(_safe_int(bbox.get("x"), 0) or 0)
                y = int(_safe_int(bbox.get("y"), 0) or 0)
                if label:
                    cv2.putText(
                        overlay,
                        label[:80],
                        (x, max(16, y - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.5,
                        (30, 220, 255),
                        1,
                        cv2.LINE_AA,
                    )

        summary = payload.get("summary") or {}
        status = str(payload.get("status") or "ok")
        header = f"QR {status} | count={summary.get('count', 0)}"
        cv2.putText(
            overlay,
            header[:100],
            (10, 22),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            overlay,
            header[:100],
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
