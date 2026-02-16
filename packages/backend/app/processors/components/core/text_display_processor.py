from ..processor import BasicProcessor


class TextDisplayProcessor(BasicProcessor):
    """Alias of DisplayProcessor for Text/JSON display node."""

    processor_type = "text-display"

    def __init__(self, config):
        super().__init__(config)

    def process(self):
        if self.get_input_processor() is None:
            return ""
        return self.get_input_processor().get_output(self.get_input_node_output_key())

    def cancel(self):
        pass
