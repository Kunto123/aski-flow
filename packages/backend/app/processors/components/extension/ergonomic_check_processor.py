import json

from ..processor import BasicProcessor


class ErgonomicCheckProcessor(BasicProcessor):
    """Ergonomic Check (Week 6 target) - dummy skeleton for Week 5.

    Accepts any JSON-like string and returns a placeholder evaluation.
    """

    processor_type = "ergonomic-check"

    def __init__(self, config):
        super().__init__(config)
        self.input_json = config.get("input_json")

    def process(self):
        raw = self.get_input_by_name("input_json", self.input_json)
        payload_in = None
        if raw:
            try:
                payload_in = json.loads(raw)
            except Exception:
                payload_in = raw

        payload = {
            "status": "dummy",
            "message": "Ergonomic check will be implemented in Week 6.",
            "input": payload_in,
            "score": None,
            "issues": [],
        }
        return [json.dumps(payload)]

    def cancel(self):
        pass
