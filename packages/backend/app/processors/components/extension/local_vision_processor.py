from ...context.processor_context import ProcessorContext
from ..processor import ContextAwareProcessor
from ..core.processor_type_name_utils import ProcessorType
from ....utils.local_inference_utils import (
    coerce_float,
    coerce_int,
    extract_text_output,
    post_json,
    sanitize_payload,
)


class LocalVisionProcessor(ContextAwareProcessor):
    processor_type = ProcessorType.LOCAL_VISION

    def __init__(self, config, context: ProcessorContext):
        super().__init__(config, context)
        self.model = config.get("model")
        self.prompt = config.get("prompt")
        self.image_url = config.get("image_url")
        self.temperature = config.get("temperature")
        self.max_tokens = config.get("max_tokens")
        self.top_p = config.get("top_p")
        self.seed = config.get("seed")
        self.endpoint_url = config.get("endpoint_url")

    def process(self):
        prompt = self.get_input_by_name("prompt", self.prompt)
        image_url = self.get_input_by_name("image_url", self.image_url)

        if not prompt:
            raise Exception("No prompt provided")
        if not image_url:
            raise Exception("No image provided")

        payload = sanitize_payload(
            {
                "model": self.model,
                "prompt": prompt,
                "image": image_url,
                "temperature": coerce_float(self.temperature),
                "max_tokens": coerce_int(self.max_tokens),
                "top_p": coerce_float(self.top_p),
                "seed": coerce_int(self.seed),
            }
        )

        data = post_json("/vision", payload, self.endpoint_url)
        return extract_text_output(data)

    def cancel(self):
        pass
