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

Fallback rules (documented):
  - angle_deg / delta_angle_deg: stored as None when rotation_deg absent;
    if angle check is required (max_angle_deg set) and value is None → ANGLE_UNAVAILABLE.
  - data2 (class_confidence): stored as None when model only yields one confidence score.
    Validators using min_class_confidence will REJECT with LOW_CLASS_CONF if data2 is None.

Reject reason codes:
    NOT_FOUND, WRONG_TYPE, LOW_ROI_CONF, LOW_CLASS_CONF,
    OUT_OF_POSITION, OUT_OF_ANGLE, ANGLE_UNAVAILABLE
"""

from __future__ import annotations

import json
import math
from typing import Any, Dict, List, Optional

from ..processor import BasicProcessor
from ..core.processor_type_name_utils import ProcessorType


class StickerValidatorProcessor(BasicProcessor):
    processor_type = ProcessorType.STICKER_VALIDATOR

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        # Inline recipe — may arrive as JSON string (textarea) or dict (programmatic)
        raw_recipe = config.get("inspection_recipe") or {}
        if isinstance(raw_recipe, str):
            try:
                import json as _json
                raw_recipe = _json.loads(raw_recipe)
            except Exception:
                raw_recipe = {}
        self._recipe: Dict[str, Any] = raw_recipe if isinstance(raw_recipe, dict) else {}
        # Per-field overrides the operator can change (editableFields)
        self._line: str = str(config.get("line") or "").strip()
        self._mp_check: str = str(config.get("mp_check") or "").strip() or None
        self._template_version_id: Optional[int] = (
            int(config["template_version_id"])
            if config.get("template_version_id") is not None
            else None
        )

    # ── Public entry point ──────────────────────────────────────────────────
    def process(self) -> Any:
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
            "mp_check": self._mp_check,
            "template_version_id": self._template_version_id,
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

    @staticmethod
    def _error_payload(message: str) -> List[str]:
        return [json.dumps({
            "decision": "REJECT",
            "decision_code": "ERROR",
            "reject_reason_code": "ERROR",
            "error": message,
            "targets": [],
        })]
