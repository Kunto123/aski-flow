from ..processor import BasicProcessor


class VideoProcessor(BasicProcessor):
    """Video input node.

    For Week 5 this behaves like the File input: it returns the provided asset URL.
    """

    processor_type = "video"

    def __init__(self, config):
        super().__init__(config)
        self.url = config.get("fileUrl") or config.get("videoUrl")

    def process(self):
        if not self.url:
            raise ValueError("video node requires fileUrl")
        return self.url

    def cancel(self):
        pass
