from ..node_config_builder import FieldBuilder, NodeConfigBuilder
from .extension_processor import BasicExtensionProcessor
from ..core.processor_type_name_utils import ProcessorType


class UppercaseTextProcessor(BasicExtensionProcessor):
    """Offline-safe text utility: uppercase transform.

    Intended for Week-1 validation:
      Input Text -> Uppercase -> Display
    """

    processor_type = ProcessorType.UPPERCASE_TEXT

    def __init__(self, config):
        super().__init__(config)

    def get_node_config(self):
        input_text_field = (
            FieldBuilder()
            .set_name('input_text')
            .set_label('Input Text')
            .set_type('textarea')
            .set_required(True)
            .set_placeholder('Type something...')
            .set_has_handle(True)
            .build()
        )

        return (
            NodeConfigBuilder()
            .set_node_name('Uppercase')
            .set_processor_type(self.processor_type.value)
            .set_section('tools')
            .set_help_message('Transforms input text to UPPERCASE.')
            .set_show_handles(True)
            .set_output_type('text')
            .set_default_hide_output(False)
            .add_field(input_text_field)
            .set_icon('AiOutlineEdit')
            .build()
        )

    def process(self):
        text = self.get_input_by_name('input_text')
        if text is None:
            return ['']
        return [str(text).upper()]
