import json
from typing import Any, Optional

from ..core.processor_type_name_utils import ProcessorType
from ..processor import BasicProcessor


def _get_by_path(obj: Any, path: str) -> Any:
    """Very small JSON-path helper: dot-separated, supports integer list indexes."""

    if obj is None or not path:
        return obj
    current: Any = obj
    for part in path.split("."):
        if current is None:
            return None
        if isinstance(current, list):
            try:
                idx = int(part)
                current = current[idx]
                continue
            except Exception:
                return None
        if isinstance(current, dict):
            current = current.get(part)
            continue
        return None
    return current


class ConditionalStateProcessor(BasicProcessor):
    """Routing node v1.

    Inputs:
      - value: any (string/json)

    Config:
      - json_path: optional (if value is json)
      - operator: one of equals, not_equals, contains, gt, lt, exists
      - compare_value: string

    Output:
      - index 0: pass-through value if condition true, else None
      - index 1: pass-through value if condition false, else None
    """

    processor_type = ProcessorType.CONDITIONAL_STATE

    def __init__(self, config):
        super().__init__(config)
        self.value = config.get("value")
        self.json_path = (config.get("json_path") or "").strip()
        self.operator = (config.get("operator") or "exists").strip()
        self.compare_value = config.get("compare_value")

    def process(self):
        raw = self.get_input_by_name("value", self.value)
        extracted = raw

        parsed: Optional[Any] = None
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = None

        if parsed is not None and self.json_path:
            extracted = _get_by_path(parsed, self.json_path)

        ok = self._eval(extracted)
        if ok:
            return [raw, None]
        return [None, raw]

    def _eval(self, extracted: Any) -> bool:
        op = self.operator
        if op == "exists":
            return extracted is not None and extracted != ""

        if op in ("equals", "not_equals"):
            left = extracted
            right: Any = self.compare_value
            # Try numeric compare if possible
            try:
                left_num = float(left)
                right_num = float(right)
                left = left_num
                right = right_num
            except Exception:
                pass
            if op == "equals":
                return left == right
            return left != right

        if op == "contains":
            if extracted is None:
                return False
            return str(self.compare_value or "") in str(extracted)

        if op in ("gt", "lt"):
            try:
                left = float(extracted)
                right = float(self.compare_value)
            except Exception:
                return False
            return left > right if op == "gt" else left < right

        # Unknown operator -> be safe (false)
        return False
