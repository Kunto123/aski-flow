from .processor_type_name_utils import ProcessorType
from ..processor import BasicProcessor


class DisplayProcessor(BasicProcessor):
    processor_type = "display"

    def __init__(self, config):
        super().__init__(config)

    def process(self):
        input_processor = self.get_input_processor()
        if input_processor is None:
            return ""

        requested_key = self.get_input_node_output_key()
        input_data = input_processor.get_output(requested_key)

        # Edge handles can become stale when upstream output arity changes.
        # Fallback to the first available output instead of returning blank.
        if input_data is None and requested_key not in (None, 0):
            input_data = input_processor.get_output(0)

        if input_data is None:
            outputs = input_processor.get_output()
            if isinstance(outputs, list):
                for item in outputs:
                    if item is None:
                        continue
                    if isinstance(item, str) and item.strip() == "":
                        continue
                    return item
            return ""

        return input_data
