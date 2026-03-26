"""
Inspection DB Writer Processor  (processor_type = "inspection-db-writer")

Consumes the structured output from StickerValidatorProcessor and writes one
row to aski_inspection_results.  push_status is set to 'pending' on insert so
that a downstream push worker can read via list_push_pending().

Validator payload → aski_inspection_results column mapping:
  validator["part_name"]          → PartName
  validator["mp_check"]           → MPCheck   (resolved at validator from auth context)
  validator["data1"]              → Data1  (avg ROI confidence of accepted targets)
  validator["data2"]              → Data2  (avg class confidence; None for single-conf models)
  validator["line"]               → Line
  validator["decision"]           → decision
  validator["decision_code"]      → decision_code
  validator["reject_reason_code"] → reject_reason_code
  validator["targets"]            → targets_json  (serialised JSON)
  validator["template_version_id"]→ template_version_id
  validator["operator_user_id"]   → operator_user_id  (primary — resolved from auth context)
  runtime context (g.user_id)     → operator_user_id  (secondary fallback)
  config["operator_id"]           → operator_user_id  (tertiary fallback — manual override)

Design note: this is intentionally a separate node so users can build flows
without persistence (validator only) or with persistence (validator → db-writer).
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from ..processor import ContextAwareProcessor
from ..core.processor_type_name_utils import ProcessorType
from ...context.processor_context import ProcessorContext


class InspectionDbWriterProcessor(ContextAwareProcessor):
    processor_type = ProcessorType.INSPECTION_DB_WRITER

    def __init__(self, config: Dict[str, Any], context: ProcessorContext = None):
        super().__init__(config, context)
        # Manual override — kept for backward compatibility with old flows that
        # configured operator_id directly on this node.  Superseded by the
        # operator_user_id now emitted by StickerValidatorProcessor.
        self._operator_user_id_fallback: Optional[int] = (
            int(config["operator_id"]) if config.get("operator_id") is not None else None
        )

    def cancel(self) -> None:
        pass

    def _get_runtime_user_id(self) -> Optional[int]:
        """Retrieve operator_user_id from runtime auth context (Flask g.user_id)."""
        try:
            ctx = self.get_context()
            if ctx is None:
                return None
            g_ctx = ctx.get_context()
            if g_ctx is None:
                return None
            user_id_str = str(getattr(g_ctx, "user_id", None) or "").strip()
            return int(user_id_str) if user_id_str else None
        except Exception:
            return None

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

        decision             = str(validator_output.get("decision") or "REJECT")
        decision_code        = str(validator_output.get("decision_code") or decision)
        reject_reason_code   = validator_output.get("reject_reason_code")
        part_name            = validator_output.get("part_name")
        line_id              = validator_output.get("line")
        mp_check             = validator_output.get("mp_check")
        template_version_id  = validator_output.get("template_version_id")
        data1                = validator_output.get("data1")
        data2                = validator_output.get("data2")
        targets: list        = validator_output.get("targets") or []

        # Resolve operator_user_id:
        #   1. From validator output (StickerValidator resolves from auth context)
        #   2. From this processor's own runtime context (secondary fallback)
        #   3. From config field operator_id (backward-compat manual override)
        operator_user_id = (
            validator_output.get("operator_user_id")
            or self._get_runtime_user_id()
            or self._operator_user_id_fallback
        )
        if operator_user_id is not None:
            try:
                operator_user_id = int(operator_user_id)
            except (TypeError, ValueError):
                operator_user_id = None

        try:
            from app.qc.inspection_repository import write_inspection_result
            result_id = write_inspection_result(
                template_version_id=template_version_id,
                line_id=line_id,
                part_name=part_name,
                decision=decision,
                decision_code=decision_code,
                reject_reason_code=reject_reason_code,
                mp_check=mp_check,
                operator_user_id=operator_user_id,
                targets=targets,
                data1=data1,
                data2=data2,
            )
        except Exception as exc:
            return [json.dumps({"written": False, "error": str(exc)})]

        return [json.dumps({
            "written":            True,
            "result_id":          result_id,
            "decision":           decision,
            "decision_code":      decision_code,
            "reject_reason_code": reject_reason_code,
            "part_name":          part_name,
            "line":               line_id,
            "data1":              data1,
            "data2":              data2,
        })]
