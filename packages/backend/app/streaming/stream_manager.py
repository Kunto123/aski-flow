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

try:
    import eventlet
except Exception:
    eventlet = None


TransformFn = Callable[[Any], Any]


@dataclass
class StreamState:
    stream_id: str
    source_type: str
    stream_tag: Optional[str] = None
    source_stream_id: Optional[str] = None
    # Last/primary owner (for debug/UI). A stream can have multiple owners over time
    # (e.g., browser refresh regenerates node IDs), so we also keep owner_names.
    owner_name: Optional[str] = None
    owner_names: set[str] = field(default_factory=set)
    active: bool = True
    created_at: float = field(default_factory=time.time)
    last_access_at: float = field(default_factory=time.time)
    idle_timeout_sec: Optional[float] = None
    capture: Optional[Any] = None
    # Camera configuration. For reliability on Windows, the VideoCapture is opened
    # inside the capture thread (see _camera_loop), so we keep the desired settings
    # here rather than opening the device in create_camera_stream().
    camera_index: Optional[int] = None
    camera_width: Optional[int] = None
    camera_height: Optional[int] = None
    camera_fps: Optional[float] = None
    camera_backend: Optional[str] = None
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
    # Per-stream mutable runtime parameters (e.g. live ROI box coordinates).
    runtime_params: Dict[str, Any] = field(default_factory=dict)


class StreamManager:
    """In-memory local stream runtime for camera and transform streams."""

    def __init__(self) -> None:
        self._streams: Dict[str, StreamState] = {}
        self._registry_lock = threading.Lock()
        self._debug_enabled = (
            str(os.getenv("ASKI_STREAM_DEBUG", "0")).strip().lower()
            in ("1", "true", "yes", "on")
        )
        try:
            self._jpeg_quality = int(os.getenv("ASKI_STREAM_JPEG_QUALITY", "80"))
        except Exception:
            self._jpeg_quality = 80
        self._jpeg_quality = max(30, min(95, self._jpeg_quality))
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
                        "stream_tag": state.stream_tag,
                        "source_stream_id": state.source_stream_id,
                        "owner_name": state.owner_name,
                        "owner_names": sorted(list(getattr(state, "owner_names", set()))),
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
                        "runtime_param_keys": sorted(list((state.runtime_params or {}).keys())),
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

    def _cooperative_sleep(self, seconds: float) -> None:
        """Yield cooperatively when running under eventlet; fallback to blocking sleep."""
        if eventlet is not None:
            try:
                eventlet.sleep(seconds)
                return
            except Exception:
                pass
        time.sleep(seconds)

    def _encode_jpeg(self, frame: Any):
        if cv2 is None:
            return False, None
        try:
            return cv2.imencode(
                ".jpg",
                frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), int(self._jpeg_quality)],
            )
        except Exception:
            return cv2.imencode(".jpg", frame)


    def _camera_config_matches(
        self,
        state: StreamState,
        width: Optional[int],
        height: Optional[int],
        fps: Optional[float],
        backend: str,
    ) -> bool:
        """Return True if we can safely reuse an existing camera stream for the requested config."""
        if state.source_type != "camera" or state.camera_index is None:
            return False

        req_w = int(width) if width is not None else None
        req_h = int(height) if height is not None else None
        req_fps = float(fps) if fps is not None else None

        # If a concrete value is requested, it must match the existing stream config.
        if req_w is not None and state.camera_width not in (None, req_w):
            return False
        if req_h is not None and state.camera_height not in (None, req_h):
            return False
        if req_fps is not None and state.camera_fps not in (None, req_fps):
            return False

        st_backend = (state.camera_backend or "default").strip().lower()
        req_backend = (backend or "default").strip().lower()
        if st_backend and req_backend and st_backend not in ("default", "any") and req_backend not in ("default", "any"):
            if st_backend != req_backend:
                return False

        return True

    def _find_camera_streams_by_index(self, camera_index: int) -> List[StreamState]:
        with self._registry_lock:
            states = [
                st
                for st in self._streams.values()
                if st.source_type == "camera" and st.camera_index == int(camera_index)
            ]
        states.sort(key=lambda s: s.created_at, reverse=True)
        return states

    def _has_dependents(self, stream_id: str) -> bool:
        with self._registry_lock:
            return any(st.source_stream_id == stream_id and st.active for st in self._streams.values())

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

        # Camera backend selection (helps on Windows where some backends can hang on release).
        # Supported values: dshow | msmf | v4l2 | avfoundation | gstreamer | any
        backend_name = (os.getenv("ASKI_CAMERA_BACKEND") or "").strip().lower()
        if not backend_name and os.name == "nt":
            backend_name = "dshow"

        # IMPORTANT:
        # UI refresh (or hot reload) can regenerate node IDs, which makes owner_name change.
        # That previously caused old camera streams to stay alive (and keep the device locked)
        # until idle timeouts kicked in. To avoid camera "mati/nyala" loops, we reuse the
        # existing active camera stream for the same camera_index whenever possible.
        candidates = self._find_camera_streams_by_index(int(camera_index))

        reusable: Optional[StreamState] = None
        for st in candidates:
            if not st.active or st.stop_event.is_set():
                continue
            th = st.thread
            if th is None or not th.is_alive():
                continue
            if self._camera_config_matches(st, width, height, fps, backend_name or "default"):
                reusable = st
                break

        if reusable is not None:
            # Stop other duplicates for this device (defensive cleanup).
            for st in candidates:
                if st.stream_id == reusable.stream_id:
                    continue
                try:
                    self.stop_stream(st.stream_id, reason="dedupe_camera_index")
                except Exception:
                    pass

            with reusable.lock:
                if owner_name:
                    # IMPORTANT:
                    # Do NOT accumulate owner_names on camera streams.
                    #
                    # On the frontend, a browser refresh / hot reload can regenerate node IDs.
                    # If we keep adding owners, the old (now-unreachable) owner IDs will remain
                    # and stop_streams_by_owner() won't stop the stream, leaving the webcam
                    # locked even after the node is deleted.
                    #
                    # For camera devices, we treat the "current" owner as authoritative.
                    reusable.owner_name = owner_name
                    reusable.owner_names = set([owner_name])
                reusable.last_access_at = time.time()

            self._debug_event(
                "reuse_camera_stream",
                stream_id=reusable.stream_id,
                owner_name=owner_name,
                camera_index=camera_index,
                width=width,
                height=height,
                fps=fps,
                backend=backend_name or "default",
            )
            return reusable.stream_id

        # No reusable stream found: ensure exclusive access to the device by stopping any
        # existing camera streams bound to this camera_index (even if they belong to an
        # older owner_name).
        for st in candidates:
            try:
                self.stop_stream(st.stream_id, reason="replace_camera_index")
            except Exception:
                pass

        stream_id = self._new_stream_id("cam")

        state = StreamState(
            stream_id=stream_id,
            source_type="camera",
            owner_name=owner_name,
            owner_names=set([owner_name]) if owner_name else set(),
            camera_index=int(camera_index),
            camera_width=int(width) if width is not None else None,
            camera_height=int(height) if height is not None else None,
            camera_fps=float(fps) if fps is not None else None,
            camera_backend=backend_name or "default",
            # Stop camera if nobody is consuming frames anymore.
            # Default is intentionally NOT too aggressive because a browser refresh
            # briefly disconnects MJPEG clients and can otherwise cause visible
            # camera "mati/nyala" loops on Windows.
            idle_timeout_sec=float(os.getenv("ASKI_CAMERA_IDLE_TIMEOUT_SEC", "30")),
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
        stream_tag: Optional[str] = None,
        runtime_params: Optional[Dict[str, Any]] = None,
    ) -> str:
        source = self.get_stream(source_stream_id)
        if source is None:
            raise RuntimeError(f"Source stream not found: {source_stream_id}")
        with source.lock:
            source_active = bool(source.active and (not source.stop_event.is_set()))
        source_thread = source.thread
        source_thread_ok = True if source_thread is None else bool(source_thread.is_alive())
        if (not source_active) or (not source_thread_ok):
            self._debug_event(
                "create_transform_stream_rejected",
                source_stream_id=source_stream_id,
                owner_name=owner_name,
                reason="source_inactive",
            )
            raise RuntimeError(f"Source stream inactive: {source_stream_id}")

        stream_id = self._new_stream_id("xform")
        state = StreamState(
            stream_id=stream_id,
            source_type="transform",
            stream_tag=stream_tag,
            source_stream_id=source_stream_id,
            owner_name=owner_name,
            owner_names=set([owner_name]) if owner_name else set(),
            # Transform streams should also be reaped if nothing consumes them.
            idle_timeout_sec=float(os.getenv("ASKI_STREAM_IDLE_TIMEOUT_SEC", "20")),
            runtime_params=dict(runtime_params or {}),
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
            stream_tag=stream_tag,
            runtime_param_keys=sorted(list((runtime_params or {}).keys())),
        )
        thread.start()
        return stream_id

    def _camera_loop(self, state: StreamState) -> None:
        # IMPORTANT:
        # On Windows (especially with USB cameras), some OpenCV backends can keep
        # the device locked unless *open* and *release* happen on the same thread.
        # To make stop() reliable, we open the VideoCapture inside this thread.
        if state.camera_index is None:
            state.active = False
            state.stop_reason = state.stop_reason or "missing_camera_index"
            return

        if state.stop_event.is_set() or not state.active:
            state.active = False
            return

        backend_name = (state.camera_backend or "").strip().lower()
        backend_map = {
            "dshow": getattr(cv2, "CAP_DSHOW", 0),
            "msmf": getattr(cv2, "CAP_MSMF", 0),
            "v4l2": getattr(cv2, "CAP_V4L2", 0),
            "avfoundation": getattr(cv2, "CAP_AVFOUNDATION", 0),
            "gstreamer": getattr(cv2, "CAP_GSTREAMER", 0),
        }
        api_preference = backend_map.get(backend_name)

        try:
            if api_preference and backend_name != "any":
                capture = cv2.VideoCapture(int(state.camera_index), api_preference)
            else:
                capture = cv2.VideoCapture(int(state.camera_index))
        except Exception as e:
            state.last_error = str(e)
            state.active = False
            state.stop_event.set()
            state.stop_reason = "camera_open_exception"
            self._debug_event(
                "create_camera_stream_failed",
                camera_index=state.camera_index,
                owner_name=state.owner_name,
                backend=backend_name or "default",
                error=state.last_error,
            )
            return

        if not capture.isOpened():
            try:
                capture.release()
            except Exception:
                pass
            state.active = False
            state.stop_event.set()
            state.stop_reason = "camera_open_failed"
            self._debug_event(
                "create_camera_stream_failed",
                camera_index=state.camera_index,
                owner_name=state.owner_name,
                backend=backend_name or "default",
            )
            return

        # Reduce internal buffering so stopping streams doesn't keep the device busy.
        try:
            capture.set(getattr(cv2, "CAP_PROP_BUFFERSIZE", 38), 1)
        except Exception:
            pass

        if state.camera_width:
            try:
                capture.set(cv2.CAP_PROP_FRAME_WIDTH, float(state.camera_width))
            except Exception:
                pass
        if state.camera_height:
            try:
                capture.set(cv2.CAP_PROP_FRAME_HEIGHT, float(state.camera_height))
            except Exception:
                pass
        if state.camera_fps:
            try:
                capture.set(cv2.CAP_PROP_FPS, float(state.camera_fps))
            except Exception:
                pass

        with state.lock:
            state.capture = capture

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

                encoded_ok, encoded = self._encode_jpeg(frame)
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

            # Defensive: on some Windows + USB camera drivers, the handle can remain locked
            # until the capture object is garbage-collected.
            try:
                import gc
                del capture
                gc.collect()
            except Exception:
                pass
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
        consumer_grace_sec = float(os.getenv("ASKI_STREAM_CONSUMER_GRACE_SEC", "6"))
        no_consumer_idle_sec = float(os.getenv("ASKI_STREAM_NO_CONSUMERS_IDLE_SEC", "1"))
        while state.active and not state.stop_event.is_set():
            loop_started_at = time.perf_counter()
            now = time.time()
            if (now - state.created_at) >= consumer_grace_sec:
                try:
                    with state.lock:
                        mjpeg_clients = state.mjpeg_clients
                        last_access_at = state.last_access_at
                    if mjpeg_clients <= 0 and (not self._has_dependents(state.stream_id)) and (now - last_access_at) >= no_consumer_idle_sec:
                        state.stop_reason = "no_consumers"
                        state.active = False
                        state.stop_event.set()
                        break
                except Exception:
                    pass

            try:
                source = self.get_stream(source_stream_id)
                if source is None or not source.active:
                    state.stop_reason = "source_inactive"
                    state.active = False
                    break

                source_frame = self.get_latest_frame(source_stream_id)
                if source_frame is None:
                    self._cooperative_sleep(min(delay, 0.03))
                    continue

                # get_latest_frame() already returns a frame copy.
                transformed = transform_fn(source_frame)
                predictions: Dict[str, Any] = {}
                frame = transformed

                if isinstance(transformed, tuple) and len(transformed) == 2:
                    frame, predictions = transformed

                encoded_ok, encoded = self._encode_jpeg(frame)
                if not encoded_ok:
                    self._cooperative_sleep(min(delay, 0.01))
                    continue

                with state.lock:
                    state.latest_frame = frame
                    state.latest_jpeg = encoded.tobytes()
                    state.frames_produced += 1
                    state.last_frame_at = time.time()
                    if predictions:
                        state.latest_predictions = predictions

                # Keep realtime behavior: only sleep the remaining frame budget.
                elapsed = time.perf_counter() - loop_started_at
                sleep_for = delay - elapsed
                if sleep_for > 0:
                    self._cooperative_sleep(sleep_for)
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

    def update_stream_runtime_params(self, stream_id: str, params: Dict[str, Any]) -> bool:
        if not stream_id or not isinstance(params, dict):
            return False
        state = self.get_stream(stream_id)
        if state is None:
            return False

        with state.lock:
            state.runtime_params.update(params)
            state.last_access_at = time.time()

        self._debug_event(
            "update_stream_runtime_params",
            stream_id=stream_id,
            stream_tag=state.stream_tag,
            keys=sorted(list(params.keys())),
        )
        return True

    def get_stream_runtime_params(self, stream_id: str) -> Dict[str, Any]:
        state = self.get_stream(stream_id)
        if state is None:
            return {}
        with state.lock:
            state.last_access_at = time.time()
            return dict(state.runtime_params or {})

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

                # Also drop inactive streams whose worker thread has already exited.
                # This prevents registry growth if a stream stops itself (e.g., no_consumers)
                # or fails to start (e.g., camera_open_failed).
                dead_ids: List[str] = []
                with self._registry_lock:
                    for sid, st in list(self._streams.items()):
                        th = st.thread
                        if (not st.active) and (th is not None) and (not th.is_alive()):
                            dead_ids.append(sid)
                            self._streams.pop(sid, None)

                if dead_ids:
                    self._debug_event(
                        "reap_dead_streams",
                        target_ids=dead_ids,
                        stopped=len(dead_ids),
                    )
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
                if state.active
                and (
                    state.owner_name == owner_name
                    or (hasattr(state, "owner_names") and owner_name in state.owner_names)
                )
            ]

        stopped = 0
        for stream_id in target_ids:
            # Release ownership first. Only stop if there are no owners left.
            should_stop = False
            with self._registry_lock:
                state = self._streams.get(stream_id)
                if state is None:
                    continue
                try:
                    state.owner_names.discard(owner_name)
                except Exception:
                    pass
                if state.owner_name == owner_name:
                    state.owner_name = None
                    if state.owner_names:
                        state.owner_name = next(iter(state.owner_names))
                if (not state.owner_names) and (state.owner_name is None):
                    should_stop = True

            if should_stop and self.stop_stream(stream_id, reason=f"owner_stop:{owner_name}"):
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

    def stop_camera_streams_by_index(self, camera_index: int) -> int:
        camera_index = int(camera_index)
        with self._registry_lock:
            camera_stream_ids = [
                stream_id
                for stream_id, state in self._streams.items()
                if state.source_type == "camera" and state.camera_index == camera_index
            ]

        stopped = 0
        for stream_id in camera_stream_ids:
            if self.stop_stream(stream_id, reason=f"stop_camera_index:{camera_index}"):
                stopped += 1
        self._debug_event(
            "stop_camera_streams_by_index",
            camera_index=camera_index,
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
                    self._cooperative_sleep(0.03)
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
                self._cooperative_sleep(0.03)
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
