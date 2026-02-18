import os
import threading
import time
import uuid
import logging
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Deque, Dict, Generator, List, Optional

try:
    import cv2
except Exception:
    cv2 = None


TransformFn = Callable[[Any], Any]


@dataclass
class StreamState:
    stream_id: str
    source_type: str
    source_stream_id: Optional[str] = None
    owner_name: Optional[str] = None
    active: bool = True
    created_at: float = field(default_factory=time.time)
    last_access_at: float = field(default_factory=time.time)
    idle_timeout_sec: Optional[float] = None
    capture: Optional[Any] = None
    latest_frame: Optional[Any] = None
    latest_jpeg: Optional[bytes] = None
    latest_predictions: Dict[str, Any] = field(default_factory=dict)
    thread: Optional[threading.Thread] = None
    lock: threading.Lock = field(default_factory=threading.Lock)
    stop_event: threading.Event = field(default_factory=threading.Event)
    frames_produced: int = 0
    last_frame_at: Optional[float] = None
    mjpeg_clients: int = 0
    mjpeg_total_clients: int = 0
    last_error: Optional[str] = None
    stop_reason: Optional[str] = None


class StreamManager:
    """In-memory local stream runtime for camera and transform streams."""

    def __init__(self) -> None:
        self._streams: Dict[str, StreamState] = {}
        self._registry_lock = threading.Lock()
        self._debug_enabled = (
            str(os.getenv("ASKI_STREAM_DEBUG", "0")).strip().lower()
            in ("1", "true", "yes", "on")
        )
        self._debug_events_max = int(os.getenv("ASKI_STREAM_DEBUG_MAX_EVENTS", "800"))
        self._debug_events: Deque[Dict[str, Any]] = deque(maxlen=self._debug_events_max)

        # Safety net: auto-reap idle camera streams so we don't leave webcams
        # running if the UI forgets to call stop (e.g., node removed via keyboard,
        # browser crash, hot reload, etc.).
        self._reaper_thread = threading.Thread(
            target=self._reap_idle_streams_loop,
            daemon=True,
            name="stream-idle-reaper",
        )
        self._reaper_thread.start()

    def _debug_event(self, event: str, **payload: Any) -> None:
        entry = {
            "timestamp": time.time(),
            "event": event,
            **payload,
        }
        self._debug_events.append(entry)
        if self._debug_enabled:
            logging.info("[StreamDebug] %s", entry)

    def clear_debug_events(self) -> None:
        self._debug_events.clear()

    def get_debug_snapshot(self, events_limit: int = 200) -> Dict[str, Any]:
        now = time.time()
        with self._registry_lock:
            states = list(self._streams.values())

        streams: List[Dict[str, Any]] = []
        for state in states:
            with state.lock:
                streams.append(
                    {
                        "stream_id": state.stream_id,
                        "source_type": state.source_type,
                        "source_stream_id": state.source_stream_id,
                        "owner_name": state.owner_name,
                        "active": state.active,
                        "thread_name": state.thread.name if state.thread else None,
                        "thread_alive": bool(state.thread and state.thread.is_alive()),
                        "stop_event_set": state.stop_event.is_set(),
                        "stop_reason": state.stop_reason,
                        "created_at": state.created_at,
                        "last_access_at": state.last_access_at,
                        "idle_timeout_sec": state.idle_timeout_sec,
                        "idle_for_sec": max(0.0, now - state.last_access_at),
                        "frames_produced": state.frames_produced,
                        "last_frame_at": state.last_frame_at,
                        "mjpeg_clients": state.mjpeg_clients,
                        "mjpeg_total_clients": state.mjpeg_total_clients,
                        "has_capture": state.capture is not None,
                        "has_latest_frame": state.latest_frame is not None,
                        "has_latest_jpeg": state.latest_jpeg is not None,
                        "last_error": state.last_error,
                    }
                )

        if events_limit <= 0:
            events = []
        else:
            events = list(self._debug_events)[-events_limit:]

        return {
            "now": now,
            "debug_enabled": self._debug_enabled,
            "active_stream_count": len(streams),
            "streams": streams,
            "events": events,
        }

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

        # Camera backend selection (helps on Windows where some backends can hang on release).
        # Supported values: dshow | msmf | v4l2 | avfoundation | gstreamer | any
        backend_name = (os.getenv("ASKI_CAMERA_BACKEND") or "").strip().lower()
        if not backend_name and os.name == "nt":
            backend_name = "dshow"
        backend_map = {
            "dshow": getattr(cv2, "CAP_DSHOW", 0),
            "msmf": getattr(cv2, "CAP_MSMF", 0),
            "v4l2": getattr(cv2, "CAP_V4L2", 0),
            "avfoundation": getattr(cv2, "CAP_AVFOUNDATION", 0),
            "gstreamer": getattr(cv2, "CAP_GSTREAMER", 0),
        }
        api_preference = backend_map.get(backend_name)

        if api_preference and backend_name != "any":
            capture = cv2.VideoCapture(camera_index, api_preference)
        else:
            capture = cv2.VideoCapture(camera_index)
        if not capture.isOpened():
            self._debug_event(
                "create_camera_stream_failed",
                camera_index=camera_index,
                owner_name=owner_name,
                backend=backend_name or "default",
            )
            capture.release()
            raise RuntimeError(f"Cannot open camera index {camera_index}")

        # Reduce internal buffering so stopping streams doesn't keep the device busy.
        try:
            capture.set(getattr(cv2, "CAP_PROP_BUFFERSIZE", 38), 1)
        except Exception:
            pass

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
            # Stop camera quickly if nobody is consuming frames anymore.
            idle_timeout_sec=float(os.getenv("ASKI_CAMERA_IDLE_TIMEOUT_SEC", "4")),
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

        self._debug_event(
            "create_camera_stream",
            stream_id=stream_id,
            owner_name=owner_name,
            camera_index=camera_index,
            width=width,
            height=height,
            fps=fps,
            backend=backend_name or "default",
        )
        thread.start()
        return stream_id

    def create_transform_stream(
        self,
        source_stream_id: str,
        transform_fn: TransformFn,
        fps: float = 20.0,
        owner_name: Optional[str] = None,
    ) -> str:
        source = self.get_stream(source_stream_id)
        if source is None:
            raise RuntimeError(f"Source stream not found: {source_stream_id}")

        stream_id = self._new_stream_id("xform")
        state = StreamState(
            stream_id=stream_id,
            source_type="transform",
            source_stream_id=source_stream_id,
            owner_name=owner_name,
            # Transform streams should also be reaped if nothing consumes them.
            idle_timeout_sec=float(os.getenv("ASKI_STREAM_IDLE_TIMEOUT_SEC", "20")),
        )
        thread = threading.Thread(
            target=self._transform_loop,
            args=(state, source_stream_id, transform_fn, fps),
            daemon=True,
            name=f"stream-transform-{stream_id}",
        )
        state.thread = thread

        with self._registry_lock:
            self._streams[stream_id] = state

        self._debug_event(
            "create_transform_stream",
            stream_id=stream_id,
            source_stream_id=source_stream_id,
            owner_name=owner_name,
            fps=fps,
        )
        thread.start()
        return stream_id

    def _camera_loop(self, state: StreamState) -> None:
        capture = state.capture
        if capture is None:
            state.active = False
            return

        self._debug_event(
            "camera_loop_started",
            stream_id=state.stream_id,
            owner_name=state.owner_name,
        )
        try:
            while state.active and not state.stop_event.is_set():
                # grab/retrieve tends to be more cooperative on some backends than read()
                try:
                    ok = capture.grab()
                except Exception:
                    ok = False
                if not ok:
                    time.sleep(0.03)
                    continue

                ok, frame = capture.retrieve()
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
                    state.frames_produced += 1
                    state.last_frame_at = time.time()
        finally:
            # IMPORTANT (Windows): release inside the capture thread to avoid driver locks.
            try:
                capture.release()
            except Exception:
                pass
            with state.lock:
                state.capture = None
            self._debug_event(
                "camera_loop_stopped",
                stream_id=state.stream_id,
                owner_name=state.owner_name,
                frames_produced=state.frames_produced,
                stop_reason=state.stop_reason,
            )


    def _transform_loop(
        self,
        state: StreamState,
        source_stream_id: str,
        transform_fn: TransformFn,
        fps: float,
    ) -> None:
        delay = 1.0 / max(float(fps), 1.0)
        self._debug_event(
            "transform_loop_started",
            stream_id=state.stream_id,
            owner_name=state.owner_name,
            source_stream_id=source_stream_id,
            fps=fps,
        )
        while state.active and not state.stop_event.is_set():
            try:
                source = self.get_stream(source_stream_id)
                if source is None or not source.active:
                    state.stop_reason = "source_inactive"
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
                    state.frames_produced += 1
                    state.last_frame_at = time.time()
                    if predictions:
                        state.latest_predictions = predictions

                time.sleep(delay)
            except Exception as e:
                state.last_error = str(e)
                logging.exception(
                    "Transform stream loop failed (stream_id=%s, source_stream_id=%s)",
                    state.stream_id,
                    source_stream_id,
                )
                state.active = False
                state.stop_event.set()
                state.stop_reason = "transform_exception"
                self._debug_event(
                    "transform_loop_error",
                    stream_id=state.stream_id,
                    owner_name=state.owner_name,
                    source_stream_id=source_stream_id,
                    error=state.last_error,
                )
                break
        self._debug_event(
            "transform_loop_stopped",
            stream_id=state.stream_id,
            owner_name=state.owner_name,
            source_stream_id=source_stream_id,
            frames_produced=state.frames_produced,
            stop_reason=state.stop_reason,
            last_error=state.last_error,
        )

    def get_stream(self, stream_id: str) -> Optional[StreamState]:
        with self._registry_lock:
            return self._streams.get(stream_id)

    def get_latest_frame(self, stream_id: str) -> Optional[Any]:
        state = self.get_stream(stream_id)
        if state is None:
            return None
        with state.lock:
            state.last_access_at = time.time()
            return None if state.latest_frame is None else state.latest_frame.copy()

    def get_latest_jpeg(self, stream_id: str) -> Optional[bytes]:
        state = self.get_stream(stream_id)
        if state is None:
            return None
        with state.lock:
            state.last_access_at = time.time()
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
            state.last_access_at = time.time()
            return dict(state.latest_predictions)

    def stop_stream(self, stream_id: str, reason: str = "manual") -> bool:
        """Stop a stream deterministically.

        On Windows (especially with USB cameras), OpenCV backends can keep the device
        locked if VideoCapture.release() is called from a different thread than the
        capture loop. To avoid that, we only signal the capture thread to stop, then
        join it, and let the capture thread release the device in its own finally.
        """
        # 1) Snapshot state + dependents under lock
        with self._registry_lock:
            state = self._streams.get(stream_id)
            if state is None:
                self._debug_event(
                    "stop_stream_not_found",
                    stream_id=stream_id,
                    reason=reason,
                )
                return False

            dependent_ids = [
                sid for sid, st in self._streams.items() if st.source_stream_id == stream_id
            ]

            # Mark inactive first so loops can terminate quickly.
            state.active = False
            state.stop_event.set()
            state.stop_reason = reason

        self._debug_event(
            "stop_stream_requested",
            stream_id=stream_id,
            reason=reason,
            source_type=state.source_type,
            owner_name=state.owner_name,
            dependent_ids=dependent_ids,
        )

        # 2) Stop dependents first (outside lock) so they don't keep touching the source
        for dep_id in dependent_ids:
            try:
                self.stop_stream(dep_id, reason=f"parent_stopped:{stream_id}")
            except Exception:
                pass

        # 3) Join this stream thread (best-effort). For camera streams, this should
        # release the OS device handle in the capture thread finally block.
        try:
            thread = state.thread
            if thread is not None and thread.is_alive():
                thread.join(timeout=5.0)
        except Exception:
            pass

        # 4) If the thread is still alive, attempt a last-resort release to unblock.
        # This is not ideal but is better than leaving the device locked forever.
        try:
            thread = state.thread
            if thread is not None and thread.is_alive():
                cap = state.capture
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass
                    with state.lock:
                        state.capture = None
                # Give it a moment to unwind.
                try:
                    thread.join(timeout=1.0)
                except Exception:
                    pass
        except Exception:
            pass

        # 5) Remove from registry after stop/join to ensure generators and lookups stop.
        with self._registry_lock:
            self._streams.pop(stream_id, None)

        self._debug_event(
            "stop_stream_completed",
            stream_id=stream_id,
            reason=reason,
            source_type=state.source_type,
            owner_name=state.owner_name,
            thread_alive=bool(state.thread and state.thread.is_alive()),
            capture_released=state.capture is None,
            frames_produced=state.frames_produced,
        )
        return True


    def _reap_idle_streams_loop(self) -> None:
        while True:
            try:
                now = time.time()
                with self._registry_lock:
                    stale_ids = [
                        stream_id
                        for stream_id, state in self._streams.items()
                        if state.active
                        and state.idle_timeout_sec is not None
                        and (now - state.last_access_at) > float(state.idle_timeout_sec)
                    ]

                for stream_id in stale_ids:
                    self.stop_stream(stream_id, reason="idle_timeout")
            except Exception:
                # Never crash the backend because of a reaper failure.
                pass

            time.sleep(1.0)

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
            if self.stop_stream(stream_id, reason=f"owner_stop:{owner_name}"):
                stopped += 1
        self._debug_event(
            "stop_streams_by_owner",
            owner_name=owner_name,
            target_ids=target_ids,
            stopped=stopped,
        )
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
            if self.stop_stream(stream_id, reason="stop_all_camera_streams"):
                stopped += 1
        self._debug_event(
            "stop_camera_streams",
            target_ids=camera_stream_ids,
            stopped=stopped,
        )
        return stopped

    def mjpeg_generator(self, stream_id: str) -> Generator[bytes, None, None]:
        boundary = b"--frame\r\n"
        opened = False
        try:
            while True:
                state = self.get_stream(stream_id)
                if state is None or not state.active:
                    break

                if not opened:
                    with state.lock:
                        state.mjpeg_clients += 1
                        state.mjpeg_total_clients += 1
                    self._debug_event(
                        "mjpeg_client_connected",
                        stream_id=stream_id,
                        owner_name=state.owner_name,
                        source_type=state.source_type,
                        active_clients=state.mjpeg_clients,
                        total_clients=state.mjpeg_total_clients,
                    )
                    opened = True

                frame = self.get_latest_jpeg(stream_id)
                if frame is None:
                    time.sleep(0.03)
                    continue

                # Mark as accessed to prevent idle reaper stopping an active viewer.
                try:
                    with state.lock:
                        state.last_access_at = time.time()
                except Exception:
                    pass

                yield (
                    boundary
                    + b"Content-Type: image/jpeg\r\n"
                    + f"Content-Length: {len(frame)}\r\n\r\n".encode("utf-8")
                    + frame
                    + b"\r\n"
                )
                time.sleep(0.03)
        finally:
            state = self.get_stream(stream_id)
            if state is not None and opened:
                with state.lock:
                    state.mjpeg_clients = max(0, state.mjpeg_clients - 1)
                    active_clients = state.mjpeg_clients
                    total_clients = state.mjpeg_total_clients
                self._debug_event(
                    "mjpeg_client_disconnected",
                    stream_id=stream_id,
                    owner_name=state.owner_name,
                    source_type=state.source_type,
                    active_clients=active_clients,
                    total_clients=total_clients,
                )


_STREAM_MANAGER = StreamManager()


def get_stream_manager() -> StreamManager:
    return _STREAM_MANAGER
