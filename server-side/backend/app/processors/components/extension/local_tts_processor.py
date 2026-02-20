from ...context.processor_context import ProcessorContext
from ..processor import ContextAwareProcessor
from ..core.processor_type_name_utils import ProcessorType
from ....utils.local_inference_utils import (
    coerce_float,
    extract_base64,
    post_json,
    sanitize_payload,
    save_base64_to_storage,
)


class LocalTTSProcessor(ContextAwareProcessor):
    processor_type = ProcessorType.LOCAL_TTS

    def __init__(self, config, context: ProcessorContext):
        super().__init__(config, context)
        self.model = config.get("model")
        self.text = config.get("text")
        self.voice = config.get("voice")
        self.speed = config.get("speed")
        self.endpoint_url = config.get("endpoint_url")

    def process(self):
        text = self.get_input_by_name("text", self.text)

        if not text:
            raise Exception("No text provided")

        payload = sanitize_payload(
            {
                "model": self.model,
                "text": text,
                "voice": self.voice,
                "speed": coerce_float(self.speed),
            }
        )

        data = post_json("/tts", payload, self.endpoint_url)

        if data.get("audio_url"):
            return data["audio_url"]

        base64_str = extract_base64(data, "audio_base64", "audio")
        if not base64_str:
            raise Exception("Local inference response missing audio")

        storage = self.get_storage()
        return save_base64_to_storage(
            storage,
            base64_str,
            self.name,
            data.get("mime_type"),
            "mp3",
        )

    def cancel(self):
        pass
