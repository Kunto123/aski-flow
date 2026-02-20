import json
import time

from ..processor import BasicProcessor


class LampControlProcessor(BasicProcessor):
    """Device control dummy (Week 5).

    Placeholder for local device integration. For now it just echoes the desired
    state and returns an acknowledgement.
    """

    processor_type = "lamp-control"

    def __init__(self, config):
        super().__init__(config)
        self.state = config.get("state", "off")

    def process(self):
        desired = self.get_input_by_name("state", self.state)
        payload = {
            "device": "lamp",
            "desired_state": desired,
            "status": "dummy",
            "applied": False,
            "timestamp": time.time(),
        }
        return [json.dumps(payload)]

    def cancel(self):
        pass
