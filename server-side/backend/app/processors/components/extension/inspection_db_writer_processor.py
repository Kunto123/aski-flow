"""
Inspection DB Writer Processor  (processor_type = "inspection-db-writer")

Consumes the structured output from StickerValidatorProcessor and:
  1. Writes an inspection_events row + target_results rows.
  2. Enqueues an integration_outbox row (status='pending').
  3. Updates the counter bucket for dashboard aggregation.

Returns a summary payload confirming the write.

Design note: this is intentionally a separate node so the user can build flows
without persistence (validator only), or with persistence (validator → db-writer).
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from ..processor import BasicProcessor
from ..core.processor_type_name_utils import ProcessorType


class InspectionDbWriterProcessor(BasicProcessor):
    processor_type = ProcessorType.INSPECTION_DB_WRITER

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self._deployment_id: Optional[int] = (
            int(config["deployment_id"]) if config.get("deployment_id") is not None else None
        )
        self._operator_id: Optional[int] = (
            int(config["operator_id"]) if config.get("operator_id") is not None else None
        )
        # Fallback bucket granularity; defaults to 'hour'
        self._bucket_granularity: str = str(config.get("bucket_granularity") or "hour")

    def process(self) -> Any:
        validator_raw = self.get_input_by_name("validator_result", accept_object=True)
        # StickerValidator returns output[0] as a JSON string; parse it here.
        if isinstance(validator_raw, str):
            try:
                validator_output = json.loads(validator_raw)
            except Exception:
                validator_output = None
        else:
            validator_output = validator_raw

        if not validator_output or not isinstance(validator_output, dict):
            return [json.dumps({"written": False, "error": "No validator result connected."})]

        decision = str(validator_output.get("decision") or "REJECT")
        decision_code = str(validator_output.get("decision_code") or decision)
        reject_reason_code = validator_output.get("reject_reason_code")
        part_name = validator_output.get("part_name")
        line_id = validator_output.get("line")
        mp_check = validator_output.get("mp_check")
        template_version_id = validator_output.get("template_version_id")
        data1 = validator_output.get("data1")
        data2 = validator_output.get("data2")
        targets: list = validator_output.get("targets") or []

        # Infer station_id from deployment if available
        station_id: Optional[str] = None
        if self._deployment_id:
            try:
                from app.qc.deployment_repository import get_deployment
                dep = get_deployment(self._deployment_id)
                if dep:
                    station_id = dep.get("station_id")
                    if not line_id:
                        line_id = dep.get("line_id")
            except Exception:
                pass

        try:
            from app.qc.inspection_repository import write_inspection_result
            event_id = write_inspection_result(
                deployment_id=self._deployment_id,
                template_version_id=template_version_id,
                line_id=line_id,
                station_id=station_id,
                part_name=part_name,
                decision=decision,
                decision_code=decision_code,
                reject_reason_code=reject_reason_code,
                mp_check=mp_check,
                operator_id=self._operator_id,
                targets=targets,
                data1=data1,
                data2=data2,
            )
        except Exception as exc:
            return [json.dumps({"written": False, "error": str(exc)})]

        # Update counter bucket (best-effort; never block main result)
        try:
            from app.qc.aggregate_repository import update_counter_bucket
            update_counter_bucket(
                line_id=line_id or "unknown",
                template_version_id=template_version_id,
                part_name=part_name,
                decision=decision,
                reject_reason_code=reject_reason_code,
                granularity=self._bucket_granularity,
            )
        except Exception:
            pass

        return [json.dumps({
            "written": True,
            "event_id": event_id,
            "decision": decision,
            "decision_code": decision_code,
            "reject_reason_code": reject_reason_code,
            "part_name": part_name,
            "line": line_id,
            "data1": data1,
            "data2": data2,
        })]
