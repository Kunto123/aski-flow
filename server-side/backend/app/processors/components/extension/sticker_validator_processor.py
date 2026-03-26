"""
Sticker Validator Processor  (processor_type = "sticker-validator")

Accepts output from main-vision-model and an inspection recipe, then determines
ACCEPT / REJECT for each configured sticker target.

Input contract (from main-vision-model outputData):
    {
      "detections": [
        {
          "label": str,
          "confidence": float,       # ROI/object confidence  → data1
          "position": {"x1", "y1", "x2", "y2"},
          # "class_confidence": float  (optional; absent if model only yields one score)
          # "rotation_deg": float      (optional; absent from current YOLO output)
        }
      ]
    }

Runtime metadata (auto-resolved):
  - mp_check:        taken from the logged-in user's username (g.username in Flask context).
                     Falls back to config field "mp_check" for backward compatibility.
  - operator_user_id: taken from the logged-in user's ID (g.user_id).
                     Falls back to None if runtime context is unavailable.

Fallback rules (documented):
  - angle_deg / delta_angle_deg: stored as None when rotation_deg absent;
    if angle check is required (max_angle_deg set) and value is None → ANGLE_UNAVAILABLE.
  - data2 (class_confidence): stored as None when model only yields one confidence score.
    If min_class_confidence is None (field blank), the check is skipped entirely.
    If min_class_confidence is set and data2 is None → reject with LOW_CLASS_CONF.

Reject reason codes:
    NOT_FOUND, WRONG_TYPE, LOW_ROI_CONF, LOW_CLASS_CONF,
    OUT_OF_POSITION, OUT_OF_ANGLE, ANGLE_UNAVAILABLE
"""

from __future__ import annotations

import json
import math
from typing import Any, Dict, List, Optional

from ..processor import ContextAwareProcessor
from ..core.processor_type_name_utils import ProcessorType
from ...context.processor_context import ProcessorContext


def _as_float(v: Any) -> Optional[float]:
    """Return float(v) or None if v is None/unparseable."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


class StickerValidatorProcessor(ContextAwareProcessor):
    processor_type = ProcessorType.STICKER_VALIDATOR

    def __init__(self, config: Dict[str, Any], context: ProcessorContext = None):
        super().__init__(config, context)

        # ── Operator / metadata fields (backward-compat config fallbacks) ──
        self._line: str = str(config.get("line") or "").strip()
        # mp_check config fallback — used if runtime auth context is unavailable
        self._mp_check_fallback: Optional[str] = (
            str(config.get("mp_check") or "").strip() or None
        )
        self._template_version_id: Optional[int] = (
            int(config["template_version_id"])
            if config.get("template_version_id") is not None
            else None
        )
        # Recipe is built at process() time so roi_dimensions can be read
        # from a connected ROI node's runtime output.

    # ── Runtime auth context ─────────────────────────────────────────────
    def _get_runtime_user(self) -> tuple[Optional[int], Optional[str]]:
        """Return (user_id: int|None, username: str|None) from runtime auth context.

        The Flask g object is stored in ProcessorContextFlaskRequest.g_context.
        At socket event time, sockets.py sets g.user_id and g.username from JWT.
        Returns (None, None) safely if context is unavailable.
        """
        try:
            ctx = self.get_context()
            if ctx is None:
                return None, None
            g_ctx = ctx.get_context()
            if g_ctx is None:
                return None, None
            username = getattr(g_ctx, "username", None) or None
            user_id_str = str(getattr(g_ctx, "user_id", None) or "").strip()
            user_id = int(user_id_str) if user_id_str else None
            return user_id, username
        except Exception:
            return None, None

    def _build_recipe(
        self,
        roi_w: Optional[float],
        roi_h: Optional[float],
    ) -> Dict[str, Any]:
        """Build inspection recipe from config.

        Priority:
          1. Advanced JSON textarea — used when it contains a "targets" list.
             (backward compatibility for old templates with inspection_recipe field)
          2. Individual form fields — used otherwise (single-target quick config).

        roi_w / roi_h come from the connected ROI node's output[1] when wired,
        otherwise from the manual roi_output_width / roi_output_height fields.
        expected_cx = roi_w / 2, expected_cy = roi_h / 2.
        """
        config = self._config
        raw_recipe = config.get("inspection_recipe") or {}
        if isinstance(raw_recipe, str):
            try:
                raw_recipe = json.loads(raw_recipe)
            except Exception:
                raw_recipe = {}
        recipe_json: Dict[str, Any] = raw_recipe if isinstance(raw_recipe, dict) else {}

        # Advanced JSON path (backward compat): if targets list present, use as-is.
        if recipe_json.get("targets"):
            return recipe_json

        exp_cx: Optional[float] = (roi_w / 2.0) if roi_w is not None else None
        exp_cy: Optional[float] = (roi_h / 2.0) if roi_h is not None else None

        # Quick config path.
        # min_roi_confidence: read from config for backward compat with old templates
        # that still have the field. Not a UI field in the new simplified node.
        # Default 0.0 → check effectively disabled when field absent.
        min_roi_conf = _as_float(config.get("min_roi_confidence"))
        if min_roi_conf is None:
            min_roi_conf = 0.0

        return {
            "part_name": str(
                config.get("part_name") or recipe_json.get("part_name") or ""
            ).strip() or None,
            "targets": [
                {
                    # target_id is internal — not a UI field; default "target-1"
                    "target_id": str(config.get("target_id") or "target-1").strip(),
                    "expected_class": str(config.get("expected_class") or "").strip() or None,
                    "min_roi_confidence": min_roi_conf,
                    # New UI fields — None means check is skipped
                    "min_class_confidence": _as_float(config.get("min_class_confidence")),
                    "max_offset_x": _as_float(config.get("max_offset_x")),
                    "max_offset_y": _as_float(config.get("max_offset_y")),
                    "max_angle_deg": _as_float(config.get("max_angle_deg")),
                    "expected_angle_deg": _as_float(config.get("expected_angle_deg")) or 0.0,
                    "expected_cx": exp_cx,
                    "expected_cy": exp_cy,
                }
            ],
        }

    # ── Public entry point ──────────────────────────────────────────────────
    def process(self) -> Any:
        # ── Resolve runtime user (mp_check / operator_user_id) ───────────
        runtime_user_id, runtime_username = self._get_runtime_user()
        mp_check = runtime_username or self._mp_check_fallback
        operator_user_id = runtime_user_id  # None if context unavailable

        # ── Resolve ROI dimensions ────────────────────────────────────────
        # Priority: connected ROI node's output[1] > manual roi_output_width/height fields.
        roi_w: Optional[float] = None
        roi_h: Optional[float] = None
        roi_dim_raw = self.get_input_by_name("roi_dimensions", accept_object=True)
        if roi_dim_raw:
            try:
                dim = json.loads(roi_dim_raw) if isinstance(roi_dim_raw, str) else roi_dim_raw
                if isinstance(dim, dict):
                    roi_w = _as_float(dim.get("width"))
                    roi_h = _as_float(dim.get("height"))
            except Exception:
                pass
        if roi_w is None:
            roi_w = _as_float(self._config.get("roi_output_width"))
        if roi_h is None:
            roi_h = _as_float(self._config.get("roi_output_height"))

        self._recipe = self._build_recipe(roi_w, roi_h)

        vision_output = self._get_input("detections_payload")
        if not vision_output:
            return self._error_payload("No vision model output connected.")

        # main-vision-model returns output[0] as a JSON string; parse it here.
        if isinstance(vision_output, str):
            try:
                vision_output = json.loads(vision_output)
            except Exception:
                pass

        detections: List[Dict[str, Any]] = []
        if isinstance(vision_output, dict):
            # In stream mode, main-vision-model returns an empty detections list at
            # startup because the model warms up in a background thread.  The live
            # predictions accumulate in the stream manager instead.  Fetch them here.
            stream_id = vision_output.get("stream_id")
            if stream_id:
                try:
                    from ....streaming import get_stream_manager
                    manager = get_stream_manager()
                    # Access latest_predictions without acquiring state.lock.
                    # dict-reference assignment is GIL-atomic in CPython so we
                    # will never read a torn value — worst case we read a frame
                    # that is one inference cycle stale.  This avoids blocking
                    # the eventlet hub (main OS thread) on a real threading.Lock
                    # that is held by the YOLO transform thread.
                    state = manager.get_stream(stream_id)
                    if state is not None:
                        live_preds = state.latest_predictions
                        if live_preds and isinstance(live_preds, dict):
                            detections = self._boxes_to_detections(
                                live_preds.get("boxes") or []
                            )
                except Exception:
                    pass
            if not detections:
                detections = vision_output.get("detections") or []
        elif isinstance(vision_output, list):
            detections = vision_output

        targets_config: List[Dict[str, Any]] = (
            self._recipe.get("targets") or []
            if isinstance(self._recipe, dict)
            else []
        )

        if not targets_config:
            return self._error_payload("No inspection targets configured in recipe.")

        target_results: List[Dict[str, Any]] = []
        overall_decision = "ACCEPT"
        first_reject_reason: Optional[str] = None

        for target_cfg in targets_config:
            result = self._validate_target(target_cfg, detections)
            target_results.append(result)
            if result["decision"] == "REJECT" and overall_decision == "ACCEPT":
                overall_decision = "REJECT"
                first_reject_reason = result.get("reject_reason_code")

        # Pick aggregate data1/data2 from first accepted target or overall best
        agg_data1, agg_data2 = self._aggregate_data(target_results)

        return [json.dumps({
            "decision": overall_decision,
            "decision_code": overall_decision,
            "reject_reason_code": first_reject_reason,
            "part_name": self._recipe.get("part_name") if isinstance(self._recipe, dict) else None,
            "data1": agg_data1,
            "data2": agg_data2,
            "line": self._line or None,
            "mp_check": mp_check,
            "template_version_id": self._template_version_id,
            "operator_user_id": operator_user_id,
            "targets": target_results,
        })]

    # ── Target validation ───────────────────────────────────────────────────
    def _validate_target(
        self,
        cfg: Dict[str, Any],
        detections: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        target_id = str(cfg.get("target_id") or "")
        part_name = str(cfg.get("part_name") or self._recipe.get("part_name") or "")
        expected_class = str(cfg.get("expected_class") or "").strip().lower()

        min_roi_conf: float = float(cfg.get("min_roi_confidence") or cfg.get("min_roi_conf") or 0.0)
        min_class_conf: Optional[float] = (
            float(cfg["min_class_confidence"])
            if cfg.get("min_class_confidence") is not None
            else None
        )
        max_offset_x: Optional[float] = (
            float(cfg["max_offset_x"]) if cfg.get("max_offset_x") is not None else None
        )
        max_offset_y: Optional[float] = (
            float(cfg["max_offset_y"]) if cfg.get("max_offset_y") is not None else None
        )
        max_angle_deg: Optional[float] = (
            float(cfg["max_angle_deg"]) if cfg.get("max_angle_deg") is not None else None
        )

        # Find best matching detection
        candidate = self._find_best_candidate(expected_class, detections)

        base = {
            "target_id": target_id,
            "part_name": part_name,
            "expected_class": expected_class or None,
            "detected_class": None,
            "data1": None,
            "data2": None,
            "position": None,
            "offset": None,
            "angle_deg": None,
            "delta_angle_deg": None,
        }

        # ── NOT FOUND ────────────────────────────────────────────────────
        if candidate is None:
            return {**base, "decision": "REJECT", "decision_code": "REJECT",
                    "reject_reason_code": "NOT_FOUND"}

        detected_class = str(candidate.get("label") or "").strip().lower()
        data1: Optional[float] = candidate.get("confidence")   # ROI/object confidence
        data2: Optional[float] = candidate.get("class_confidence")  # None for single-conf models
        pos = candidate.get("position") or {}
        cx = (float(pos.get("x1", 0)) + float(pos.get("x2", 0))) / 2
        cy = (float(pos.get("y1", 0)) + float(pos.get("y2", 0))) / 2
        rotation_deg: Optional[float] = candidate.get("rotation_deg")  # None from current YOLO

        # Expected center from recipe (optional; 0,0 if not configured)
        exp_cx = float(cfg.get("expected_cx") or cfg.get("roi_center_x") or 0)
        exp_cy = float(cfg.get("expected_cy") or cfg.get("roi_center_y") or 0)
        exp_angle = float(cfg.get("expected_angle_deg") or 0)
        offset_x = cx - exp_cx if (exp_cx or exp_cy) else None
        offset_y = cy - exp_cy if (exp_cx or exp_cy) else None
        delta_angle = (
            rotation_deg - exp_angle if rotation_deg is not None else None
        )

        base.update({
            "detected_class": detected_class,
            "data1": round(data1, 6) if data1 is not None else None,
            "data2": round(data2, 6) if data2 is not None else None,
            "position": {"x": round(cx, 2), "y": round(cy, 2)},
            "offset": (
                {"x": round(offset_x, 2), "y": round(offset_y, 2)}
                if offset_x is not None else None
            ),
            "angle_deg": round(rotation_deg, 4) if rotation_deg is not None else None,
            "delta_angle_deg": round(delta_angle, 4) if delta_angle is not None else None,
        })

        # ── WRONG_TYPE ───────────────────────────────────────────────────
        if expected_class and detected_class != expected_class:
            return {**base, "decision": "REJECT", "decision_code": "REJECT",
                    "reject_reason_code": "WRONG_TYPE"}

        # ── LOW_ROI_CONF ─────────────────────────────────────────────────
        if data1 is not None and data1 < min_roi_conf:
            return {**base, "decision": "REJECT", "decision_code": "REJECT",
                    "reject_reason_code": "LOW_ROI_CONF"}

        # ── LOW_CLASS_CONF ───────────────────────────────────────────────
        if min_class_conf is not None:
            if data2 is None:
                # Model does not provide class_confidence; must reject per contract
                return {**base, "decision": "REJECT", "decision_code": "REJECT",
                        "reject_reason_code": "LOW_CLASS_CONF"}
            if data2 < min_class_conf:
                return {**base, "decision": "REJECT", "decision_code": "REJECT",
                        "reject_reason_code": "LOW_CLASS_CONF"}

        # ── OUT_OF_POSITION ──────────────────────────────────────────────
        if max_offset_x is not None and offset_x is not None:
            if abs(offset_x) > max_offset_x:
                return {**base, "decision": "REJECT", "decision_code": "REJECT",
                        "reject_reason_code": "OUT_OF_POSITION"}
        if max_offset_y is not None and offset_y is not None:
            if abs(offset_y) > max_offset_y:
                return {**base, "decision": "REJECT", "decision_code": "REJECT",
                        "reject_reason_code": "OUT_OF_POSITION"}

        # ── OUT_OF_ANGLE / ANGLE_UNAVAILABLE ────────────────────────────
        if max_angle_deg is not None:
            if delta_angle is None:
                return {**base, "decision": "REJECT", "decision_code": "REJECT",
                        "reject_reason_code": "ANGLE_UNAVAILABLE"}
            if abs(delta_angle) > max_angle_deg:
                return {**base, "decision": "REJECT", "decision_code": "REJECT",
                        "reject_reason_code": "OUT_OF_ANGLE"}

        return {**base, "decision": "ACCEPT", "decision_code": "ACCEPT",
                "reject_reason_code": None}

    # ── Helpers ─────────────────────────────────────────────────────────────
    @staticmethod
    def _boxes_to_detections(boxes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Convert raw model boxes (runtime format) to the detections format expected by validators."""
        result = []
        for idx, box in enumerate(boxes):
            xyxy = box.get("xyxy") or [0, 0, 0, 0]
            try:
                x1, y1, x2, y2 = [float(v) for v in xyxy[:4]]
            except Exception:
                x1, y1, x2, y2 = 0.0, 0.0, 0.0, 0.0
            result.append({
                "index": idx,
                "label": str(box.get("label", "unknown")),
                "class_id": box.get("class_id"),
                "confidence": float(box.get("conf", 0.0)),
                "position": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
            })
        return result

    def _find_best_candidate(
        self,
        expected_class: str,
        detections: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """Return highest-confidence detection matching expected_class (or any if class empty)."""
        if not detections:
            return None
        candidates = detections
        if expected_class:
            candidates = [
                d for d in detections
                if str(d.get("label") or "").strip().lower() == expected_class
            ]
        if not candidates:
            return None
        return max(candidates, key=lambda d: float(d.get("confidence") or 0))

    def _aggregate_data(
        self, target_results: List[Dict[str, Any]]
    ) -> tuple[Optional[float], Optional[float]]:
        """Average data1/data2 across accepted targets; fall back to all targets."""
        accepted = [t for t in target_results if t.get("decision") == "ACCEPT"]
        pool = accepted or target_results
        d1_vals = [t["data1"] for t in pool if t.get("data1") is not None]
        d2_vals = [t["data2"] for t in pool if t.get("data2") is not None]
        data1 = round(sum(d1_vals) / len(d1_vals), 6) if d1_vals else None
        data2 = round(sum(d2_vals) / len(d2_vals), 6) if d2_vals else None
        return data1, data2

    def _get_input(self, field_name: str) -> Any:
        """Retrieve input from config or connected node output."""
        return self.get_input_by_name(field_name, accept_object=True)

    def cancel(self) -> None:
        pass

    @staticmethod
    def _error_payload(message: str) -> List[str]:
        return [json.dumps({
            "decision": "REJECT",
            "decision_code": "ERROR",
            "reject_reason_code": "ERROR",
            "error": message,
            "targets": [],
        })]
