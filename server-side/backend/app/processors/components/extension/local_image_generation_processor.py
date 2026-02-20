from ...context.processor_context import ProcessorContext
from ..processor import ContextAwareProcessor
from ..core.processor_type_name_utils import ProcessorType
from ....utils.local_inference_utils import (
    coerce_float,
    coerce_int,
    extract_base64,
    post_json,
    sanitize_payload,
    save_base64_to_storage,
)


class LocalImageGenerationProcessor(ContextAwareProcessor):
    processor_type = ProcessorType.LOCAL_IMAGE_GENERATION

    def __init__(self, config, context: ProcessorContext):
        super().__init__(config, context)
        self.model = config.get("model")
        self.prompt = config.get("prompt")
        self.negative_prompt = config.get("negative_prompt")
        self.width = config.get("width")
        self.height = config.get("height")
        self.steps = config.get("steps")
        self.guidance = config.get("guidance")
        self.seed = config.get("seed")
        self.endpoint_url = config.get("endpoint_url")

    def process(self):
        prompt = self.get_input_by_name("prompt", self.prompt)

        if not prompt:
            raise Exception("No prompt provided")

        payload = sanitize_payload(
            {
                "model": self.model,
                "prompt": prompt,
                "negative_prompt": self.negative_prompt,
                "width": coerce_int(self.width),
                "height": coerce_int(self.height),
                "steps": coerce_int(self.steps),
                "guidance": coerce_float(self.guidance),
                "seed": coerce_int(self.seed),
            }
        )

        data = post_json("/image", payload, self.endpoint_url)

        if data.get("image_url"):
            return data["image_url"]

        base64_str = extract_base64(data, "image_base64", "image")
        if not base64_str:
            raise Exception("Local inference response missing image")

        storage = self.get_storage()
        return save_base64_to_storage(
            storage,
            base64_str,
            self.name,
            data.get("mime_type"),
            "png",
        )

    def cancel(self):
        pass
