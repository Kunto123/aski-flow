import json
import time

from ..processor import BasicProcessor


class TriggerProcessor(BasicProcessor):
    """Simple trigger node.

    Produces a timestamped payload to kick-off a chain.
    This is intentionally minimal for Week 5.
    """

    processor_type = "trigger"

    def __init__(self, config):
        super().__init__(config)
        self.payload = config.get("payload", "")

    def process(self):
        return [
            json.dumps(
                {
                    "triggered_at": time.time(),
                    "payload": self.payload,
                    "node": self.name,
                }
            )
        ]

    def cancel(self):
        pass
