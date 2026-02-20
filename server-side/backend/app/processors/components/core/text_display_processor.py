from ..processor import BasicProcessor


class TextDisplayProcessor(BasicProcessor):
    """Alias of DisplayProcessor for Text/JSON display node."""

    processor_type = "text-display"

    def __init__(self, config):
        super().__init__(config)

    def process(self):
        input_processor = self.get_input_processor()
        if input_processor is None:
            return ""

        requested_key = self.get_input_node_output_key()
        value = input_processor.get_output(requested_key)

        if value is None and requested_key not in (None, 0):
            value = input_processor.get_output(0)

        if value is None:
            outputs = input_processor.get_output()
            if isinstance(outputs, list):
                for item in outputs:
                    if item is None:
                        continue
                    if isinstance(item, str) and item.strip() == "":
                        continue
                    return item
            return ""

        return value

    def cancel(self):
        pass
