"""
Part Ready Validator Processor  (processor_type = "part-ready-validator")

Checks whether a physical part is present in a camera ROI by comparing the ROI's
color distribution against a reference color profile calibrated at the workstation.

Algorithm
---------
1. Acquire a frame from the ROI input (stream:// ref or /asset/ image URL).
2. Convert the frame to LAB colorspace (perceptual; fallback: RGB).
3. For each pixel compute Euclidean distance from the reference mean:
     dist = sqrt((L-L_ref)^2 + (a-a_ref)^2 + (b-b_ref)^2)
4. match_ratio  = fraction of pixels where dist <= distance_threshold
5. part_ready   = match_ratio >= min_match_ratio
6. data2        = match_ratio  (carries the score into inspection-db-writer)

Color profile schema (stored in node config field "color_profile"):
  {
    "schema_version":   1,
    "method":           "color_profile_match",
    "colorspace":       "LAB",          # "LAB" | "RGB"
    "reference_source": "snippet",
    "reference_color":  {"hex": "#101010", "rgb": {"r":16,"g":16,"b":16}},
    "reference_stats":  {"mean": {"l":10.2,"a":0.4,"b":-0.3},
                          "std":  {"l":2.1, "a":0.7,"b":0.6}},
    "tolerance":        {"distance_threshold": 8.0},
    "min_match_ratio":  0.85,
    "sampling_meta":    {"width": 32, "height": 32}
  }

Output contract:
  {
    "part_ready":            bool,
    "part_ready_confidence": float,   # = match_ratio
    "data2":                 float,   # = match_ratio (db-writer compat)
    "match_ratio":           float,
    "decision":              "ACCEPT" | "REJECT",
    "decision_code":         str,
    "reject_reason_code":    str | None,
    "color_profile_method":  str,
  }

Inputs:
  - roi_input: ROI node output[0]  (stream:// ref or /asset/ image URL)

Config fields:
  - color_profile:     JSON — reference color profile (set via workstation calibration)
  - min_match_ratio:   float override (optional; falls back to profile value, default 0.75)

Frame acquisition notes (stream mode):
  Uses StreamManager.get_latest_frame() — the official API that reads
  StreamState.latest_frame under lock and can fall back to decoding
  StreamState.latest_jpeg.  A short retry loop (up to ~2 s) handles the
  first-frame race condition when the ROI transform thread has not yet
  produced its first frame at the moment this processor is first called.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from ..processor import BasicProcessor
from ..core.processor_type_name_utils import ProcessorType

try:
    import cv2
    import numpy as np
except Exception:
    cv2 = None
    np = None


def _as_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


class PartReadyValidatorProcessor(BasicProcessor):
    processor_type = ProcessorType.PART_READY_VALIDATOR

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self._config = config

        # Inline raw JSON profile (backward compat — set when pasting JSON directly)
        raw_profile = config.get("color_profile")
        if isinstance(raw_profile, str):
            try:
                raw_profile = json.loads(raw_profile)
            except Exception:
                raw_profile = None
        self._color_profile_inline: Optional[Dict[str, Any]] = (
            raw_profile if isinstance(raw_profile, dict) else None
        )

        # Node-level override (takes precedence over profile value when set)
        self._min_match_ratio_override: Optional[float] = _as_float(
            config.get("min_match_ratio")
        )

    # ── Profile resolution ─────────────────────────────────────────────────
    def _resolve_color_profile(self) -> Optional[Dict[str, Any]]:
        """
        Return the active color profile, trying in order:
        1. Inline raw JSON (color_profile field — backward compat)
        2. Registry lookup by color_profile_id (int) from SQLite
        """
        if self._color_profile_inline:
            return self._color_profile_inline

        profile_id = self._config.get("color_profile_id")
        if not profile_id:
            return None
        try:
            from app.storage.db import connect as db_connect
            with db_connect() as conn:
                row = conn.execute(
                    "SELECT profile_json FROM color_profiles WHERE id = ?",
                    (int(profile_id),),
                ).fetchone()
                if row:
                    return json.loads(row["profile_json"])
        except Exception:
            pass
        return None

    # ── Public entry point ─────────────────────────────────────────────────
    def process(self) -> Any:
        if cv2 is None or np is None:
            return self._make_output(
                False, 0.0, "opencv-python is required", "NO_CV2"
            )

        profile = self._resolve_color_profile()
        if not profile:
            return self._make_output(
                False, 0.0, "No color_profile configured. Run workstation calibration first.", "NO_PROFILE"
            )

        min_match_ratio: float = (
            self._min_match_ratio_override
            if self._min_match_ratio_override is not None
            else float(profile.get("min_match_ratio") or 0.75)
        )

        # ── Resolve ROI input ──────────────────────────────────────────────
        roi_raw = self.get_input_by_name("roi_input", accept_object=True)
        roi_ref: Optional[str] = None
        if isinstance(roi_raw, list):
            roi_ref = str(roi_raw[0]) if roi_raw else None
        elif isinstance(roi_raw, str):
            s = roi_raw.strip()
            if s.startswith("[") and s.endswith("]"):
                try:
                    parsed = json.loads(s)
                    roi_ref = str(parsed[0]) if isinstance(parsed, list) and parsed else s
                except Exception:
                    roi_ref = s
            else:
                roi_ref = s

        if not roi_ref:
            return self._make_output(False, 0.0, "No ROI input connected.", "NO_INPUT")

        # ── Acquire frame ──────────────────────────────────────────────────
        frame = self._acquire_frame(roi_ref)
        if frame is None:
            return self._make_output(
                False, 0.0, "Could not acquire frame from ROI input.", "NO_FRAME"
            )

        # ── Compute match ratio ────────────────────────────────────────────
        match_ratio = self._compute_match_ratio(frame, profile)
        part_ready = match_ratio >= min_match_ratio
        decision = "ACCEPT" if part_ready else "REJECT"
        reject_reason = None if part_ready else "PART_NOT_READY"

        return self._make_output(part_ready, match_ratio, None, reject_reason, decision=decision)

    # ── Frame acquisition ──────────────────────────────────────────────────
    def _acquire_frame(self, ref: str):
        """Return a BGR numpy frame from a stream ref or /asset/ URL."""
        ref = ref.strip()
        if ref.startswith("stream://"):
            return self._frame_from_stream(ref[len("stream://"):])
        if "/stream/" in ref and (".mjpg" in ref or ".mjpeg" in ref):
            sid = ref.split("/stream/")[1].split(".")[0]
            return self._frame_from_stream(sid)
        if "/asset/" in ref:
            return self._frame_from_asset(ref)
        return None

    def _frame_from_stream(self, stream_id: str):
        """Get latest frame from the running stream manager.

        Uses the official get_latest_frame() API so that both camera streams
        and transform (ROI) streams are handled correctly.  The previous
        implementation accessed state.last_frame which does NOT exist on
        StreamState (the real attribute is latest_frame) — it always returned
        None, causing Part Ready Validator to report NO_FRAME on every live run.

        A short retry loop handles the first-frame race condition: the ROI
        transform thread may not yet have produced a frame by the time this
        processor executes immediately after the ROI node runs.
        """
        try:
            from ....streaming import get_stream_manager
            manager = get_stream_manager()

            # Verify the stream exists before spinning.
            state = manager.get_stream(stream_id)
            if state is None:
                return None

            # Retry up to ~2 s (10 × 200 ms) waiting for the first frame.
            # This is especially important when the ROI transform stream was
            # just created (e.g., first run) and its background thread hasn't
            # yet produced frame #1.
            _MAX_RETRIES = 10
            _SLEEP_SEC = 0.2

            for attempt in range(_MAX_RETRIES):
                frame = manager.get_latest_frame(stream_id)
                if frame is not None and isinstance(frame, np.ndarray):
                    # get_latest_frame() already returns a copy; safe to use directly.
                    return frame

                if attempt < _MAX_RETRIES - 1:
                    self._cooperative_sleep(_SLEEP_SEC)

            return None
        except Exception:
            return None

    @staticmethod
    def _cooperative_sleep(seconds: float) -> None:
        """Yield cooperatively when running under eventlet; fallback to time.sleep."""
        try:
            import eventlet as _ev
            _ev.sleep(seconds)
        except Exception:
            import time as _time
            _time.sleep(seconds)

    def _frame_from_asset(self, url: str):
        """Load an image from the asset storage (file mode)."""
        try:
            parsed = urlparse(url)
            marker = "/asset/"
            if marker not in parsed.path:
                return None
            from werkzeug.utils import secure_filename
            filename = secure_filename(parsed.path.split(marker, 1)[1])
            content = self.get_storage().get_file(filename)
            arr = np.frombuffer(content, np.uint8)
            return cv2.imdecode(arr, cv2.IMREAD_COLOR)
        except Exception:
            return None

    # ── Color matching ─────────────────────────────────────────────────────
    def _compute_match_ratio(self, frame, profile: Dict[str, Any]) -> float:
        """Compute the fraction of pixels within distance_threshold of the reference color."""
        colorspace = str(profile.get("colorspace") or "LAB").upper()
        ref_stats = profile.get("reference_stats") or {}
        mean_vals = ref_stats.get("mean") or {}
        threshold = float(
            (profile.get("tolerance") or {}).get("distance_threshold") or 12.0
        )

        h, w = frame.shape[:2]
        if h == 0 or w == 0:
            return 0.0

        if colorspace == "LAB":
            # OpenCV LAB: L=[0,255], a=[0,255], b=[0,255]
            # Normalize back to perceptual range: L→[0,100], a/b→[-128,127]
            converted = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB).astype(np.float32)
            converted[:, :, 0] *= (100.0 / 255.0)
            converted[:, :, 1] -= 128.0
            converted[:, :, 2] -= 128.0
            pixels = converted.reshape(-1, 3)
            ref = np.array([
                float(mean_vals.get("l") or 0),
                float(mean_vals.get("a") or 0),
                float(mean_vals.get("b") or 0),
            ], dtype=np.float32)
        else:
            # RGB fallback — use reference_color.rgb when reference_stats unavailable
            ref_rgb = (profile.get("reference_color") or {}).get("rgb") or {}
            pixels = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB).reshape(-1, 3).astype(np.float32)
            ref = np.array([
                float(ref_rgb.get("r") or 0),
                float(ref_rgb.get("g") or 0),
                float(ref_rgb.get("b") or 0),
            ], dtype=np.float32)

        distances = np.sqrt(np.sum((pixels - ref) ** 2, axis=1))
        match_ratio = float(np.mean(distances <= threshold))
        return round(match_ratio, 6)

    # ── Output builder ─────────────────────────────────────────────────────
    def _make_output(
        self,
        part_ready: bool,
        match_ratio: float,
        error: Optional[str] = None,
        reject_reason_code: Optional[str] = None,
        decision: str = "REJECT",
    ) -> List[str]:
        method = (self._resolve_color_profile() or {}).get("method") or "color_profile_match"
        payload: Dict[str, Any] = {
            "part_ready": part_ready,
            "part_ready_confidence": round(match_ratio, 6),
            "data2": round(match_ratio, 6),   # passes match score to inspection-db-writer
            "match_ratio": round(match_ratio, 6),
            "decision": decision,
            "decision_code": decision,
            "reject_reason_code": reject_reason_code,
            "color_profile_method": method,
        }
        if error:
            payload["error"] = error
        return [json.dumps(payload)]
