from ...context.processor_context import ProcessorContext
from ..processor import ContextAwareProcessor
from ..core.processor_type_name_utils import ProcessorType
from ....utils.local_inference_utils import (
    extract_text_output,
    post_json,
    sanitize_payload,
)
from .media_ref_utils import unwrap_primary_input


class LocalASRProcessor(ContextAwareProcessor):
    processor_type = ProcessorType.LOCAL_ASR

    def __init__(self, config, context: ProcessorContext):
        super().__init__(config, context)
        self.model = config.get("model")
        self.audio_url = config.get("audio_url")
        self.language = config.get("language")
        self.endpoint_url = config.get("endpoint_url")

    def process(self):
        audio_raw = self.get_input_by_name(
            "audio_url",
            self.audio_url,
            accept_object=True,
        )
        audio_url = unwrap_primary_input(audio_raw)

        if not audio_url:
            raise Exception("No audio provided")

        payload = sanitize_payload(
            {
                "model": self.model,
                "audio": audio_url,
                "language": self.language,
            }
        )

        data = post_json("/asr", payload, self.endpoint_url)
        return extract_text_output(data)

    def cancel(self):
        pass
