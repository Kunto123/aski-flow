from ...context.processor_context import ProcessorContext
from ..processor import ContextAwareProcessor
from .processor_type_name_utils import ProcessorType
from ....streaming import get_stream_manager


class CameraInputProcessor(ContextAwareProcessor):
    processor_type = ProcessorType.CAMERA_INPUT

    def __init__(self, config, context: ProcessorContext = None):
        super().__init__(config, context)
        self.camera_index = int(config.get("camera_index", 0))
        self.width = config.get("width")
        self.height = config.get("height")
        self.fps = config.get("fps")
        self.stream_id = None

    def process(self):
        manager = get_stream_manager()
        # IMPORTANT:
        # Do NOT stop streams by owner here.
        #
        # Why:
        # - The UI can re-run nodes during refresh / hot reload / "Run Node".
        # - Stopping by owner causes the camera stream to be killed and recreated,
        #   producing a new stream_id. Downstream nodes that already captured the
        #   previous stream_id can then fail with "Source stream not found".
        #
        # StreamManager.create_camera_stream() already implements:
        # - reuse by camera_index when possible
        # - deduplication of duplicates bound to the same device
        # So we rely on that logic for correctness and to avoid camera "mati/nyala" loops.
        self.stream_id = manager.create_camera_stream(
            camera_index=self.camera_index,
            width=int(self.width) if self.width else None,
            height=int(self.height) if self.height else None,
            fps=float(self.fps) if self.fps else None,
            owner_name=self.name,
        )

        # Single canonical output: downstream and UI can render from stream ref directly.
        return [f"stream://{self.stream_id}"]

    def cancel(self):
        if self.stream_id:
            get_stream_manager().stop_stream(self.stream_id)
