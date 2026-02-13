import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Generator, Optional

try:
    import cv2
except Exception:
    cv2 = None


TransformFn = Callable[[Any], Any]


@dataclass
class StreamState:
    stream_id: str
    source_type: str
    owner_name: Optional[str] = None
    active: bool = True
    created_at: float = field(default_factory=time.time)
    capture: Optional[Any] = None
    latest_frame: Optional[Any] = None
    latest_jpeg: Optional[bytes] = None
    latest_predictions: Dict[str, Any] = field(default_factory=dict)
    thread: Optional[threading.Thread] = None
    lock: threading.Lock = field(default_factory=threading.Lock)


class StreamManager:
    """In-memory local stream runtime for camera and transform streams."""

    def __init__(self) -> None:
        self._streams: Dict[str, StreamState] = {}
        self._registry_lock = threading.Lock()

    def _new_stream_id(self, prefix: str) -> str:
        return f"{prefix}-{uuid.uuid4().hex[:12]}"

    def _get_port(self) -> str:
        return os.getenv("BACKEND_PORT") or os.getenv("PORT") or "8000"

    def build_mjpeg_url(self, stream_id: str) -> str:
        return f"http://localhost:{self._get_port()}/stream/{stream_id}.mjpg"

    def build_predictions_url(self, stream_id: str) -> str:
        return f"http://localhost:{self._get_port()}/stream/{stream_id}/predictions.json"

    def create_camera_stream(
        self,
        camera_index: int = 0,
        width: Optional[int] = None,
        height: Optional[int] = None,
        fps: Optional[float] = None,
        owner_name: Optional[str] = None,
    ) -> str:
        if cv2 is None:
            raise RuntimeError(
                "opencv-python is required for camera streaming. Install backend dependencies first."
            )
        stream_id = self._new_stream_id("cam")
        capture = cv2.VideoCapture(camera_index)
        if not capture.isOpened():
            capture.release()
            raise RuntimeError(f"Cannot open camera index {camera_index}")

        if width:
            capture.set(cv2.CAP_PROP_FRAME_WIDTH, float(width))
        if height:
            capture.set(cv2.CAP_PROP_FRAME_HEIGHT, float(height))
        if fps:
            capture.set(cv2.CAP_PROP_FPS, float(fps))

        state = StreamState(
            stream_id=stream_id,
            source_type="camera",
            capture=capture,
            owner_name=owner_name,
        )

        thread = threading.Thread(
            target=self._camera_loop,
            args=(state,),
            daemon=True,
            name=f"stream-camera-{stream_id}",
        )
        state.thread = thread

        with self._registry_lock:
            self._streams[stream_id] = state

        thread.start()
        return stream_id

    def create_transform_stream(
        self,
        source_stream_id: str,
        transform_fn: TransformFn,
        fps: float = 20.0,
    ) -> str:
        source = self.get_stream(source_stream_id)
        if source is None:
            raise RuntimeError(f"Source stream not found: {source_stream_id}")

        stream_id = self._new_stream_id("xform")
        state = StreamState(stream_id=stream_id, source_type="transform")
        thread = threading.Thread(
            target=self._transform_loop,
            args=(state, source_stream_id, transform_fn, fps),
            daemon=True,
            name=f"stream-transform-{stream_id}",
        )
        state.thread = thread

        with self._registry_lock:
            self._streams[stream_id] = state

        thread.start()
        return stream_id

    def _camera_loop(self, state: StreamState) -> None:
        capture = state.capture
        if capture is None:
            state.active = False
            return

        while state.active:
            ok, frame = capture.read()
            if not ok or frame is None:
                time.sleep(0.05)
                continue

            encoded_ok, encoded = cv2.imencode(".jpg", frame)
            if not encoded_ok:
                time.sleep(0.01)
                continue

            with state.lock:
                state.latest_frame = frame
                state.latest_jpeg = encoded.tobytes()

        capture.release()

    def _transform_loop(
        self,
        state: StreamState,
        source_stream_id: str,
        transform_fn: TransformFn,
        fps: float,
    ) -> None:
        delay = 1.0 / max(float(fps), 1.0)
        while state.active:
            source = self.get_stream(source_stream_id)
            if source is None or not source.active:
                state.active = False
                break

            source_frame = self.get_latest_frame(source_stream_id)
            if source_frame is None:
                time.sleep(delay)
                continue

            transformed = transform_fn(source_frame.copy())
            predictions: Dict[str, Any] = {}
            frame = transformed

            if isinstance(transformed, tuple) and len(transformed) == 2:
                frame, predictions = transformed

            encoded_ok, encoded = cv2.imencode(".jpg", frame)
            if not encoded_ok:
                time.sleep(delay)
                continue

            with state.lock:
                state.latest_frame = frame
                state.latest_jpeg = encoded.tobytes()
                if predictions:
                    state.latest_predictions = predictions

            time.sleep(delay)

    def get_stream(self, stream_id: str) -> Optional[StreamState]:
        with self._registry_lock:
            return self._streams.get(stream_id)

    def get_latest_frame(self, stream_id: str) -> Optional[Any]:
        state = self.get_stream(stream_id)
        if state is None:
            return None
        with state.lock:
            return None if state.latest_frame is None else state.latest_frame.copy()

    def get_latest_jpeg(self, stream_id: str) -> Optional[bytes]:
        state = self.get_stream(stream_id)
        if state is None:
            return None
        with state.lock:
            return state.latest_jpeg

    def set_predictions(self, stream_id: str, predictions: Dict[str, Any]) -> None:
        state = self.get_stream(stream_id)
        if state is None:
            return
        with state.lock:
            state.latest_predictions = predictions

    def get_predictions(self, stream_id: str) -> Dict[str, Any]:
        state = self.get_stream(stream_id)
        if state is None:
            return {}
        with state.lock:
            return dict(state.latest_predictions)

    def stop_stream(self, stream_id: str) -> bool:
        with self._registry_lock:
            state = self._streams.get(stream_id)
            if state is None:
                return False
            state.active = False
            capture = state.capture
            if capture is not None:
                capture.release()
            self._streams.pop(stream_id, None)
        return True

    def stop_streams_by_owner(self, owner_name: str) -> int:
        if not owner_name:
            return 0

        with self._registry_lock:
            target_ids = [
                stream_id
                for stream_id, state in self._streams.items()
                if state.owner_name == owner_name
            ]

        stopped = 0
        for stream_id in target_ids:
            if self.stop_stream(stream_id):
                stopped += 1
        return stopped

    def stop_camera_streams(self) -> int:
        with self._registry_lock:
            camera_stream_ids = [
                stream_id
                for stream_id, state in self._streams.items()
                if state.source_type == "camera"
            ]

        stopped = 0
        for stream_id in camera_stream_ids:
            if self.stop_stream(stream_id):
                stopped += 1
        return stopped

    def mjpeg_generator(self, stream_id: str) -> Generator[bytes, None, None]:
        boundary = b"--frame\r\n"
        while True:
            state = self.get_stream(stream_id)
            if state is None or not state.active:
                break

            frame = self.get_latest_jpeg(stream_id)
            if frame is None:
                time.sleep(0.03)
                continue

            yield (
                boundary
                + b"Content-Type: image/jpeg\r\n"
                + f"Content-Length: {len(frame)}\r\n\r\n".encode("utf-8")
                + frame
                + b"\r\n"
            )
            time.sleep(0.03)


_STREAM_MANAGER = StreamManager()


def get_stream_manager() -> StreamManager:
    return _STREAM_MANAGER
