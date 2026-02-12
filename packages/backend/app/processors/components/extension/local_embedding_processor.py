import json

from ...context.processor_context import ProcessorContext
from ..processor import ContextAwareProcessor
from ..core.processor_type_name_utils import ProcessorType
from ....utils.local_inference_utils import (
    extract_embedding,
    post_json,
    sanitize_payload,
)


class LocalEmbeddingProcessor(ContextAwareProcessor):
    processor_type = ProcessorType.LOCAL_EMBEDDING

    def __init__(self, config, context: ProcessorContext):
        super().__init__(config, context)
        self.model = config.get("model")
        self.text = config.get("text")
        self.endpoint_url = config.get("endpoint_url")

    def process(self):
        text = self.get_input_by_name("text", self.text)

        if not text:
            raise Exception("No text provided")

        payload = sanitize_payload({"model": self.model, "text": text})
        data = post_json("/embedding", payload, self.endpoint_url)
        embedding = extract_embedding(data)
        return json.dumps(embedding)

    def cancel(self):
        pass
