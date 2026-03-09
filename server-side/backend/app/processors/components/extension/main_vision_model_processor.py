import json
import os
import tempfile
import threading
import time
import uuid
from typing import Any, Dict, List, Optional, Union
from urllib.parse import urlparse

try:
    import cv2
    import numpy as np
except Exception:
    cv2 = None
    np = None
from werkzeug.utils import secure_filename

from ..core.processor_type_name_utils import ProcessorType
from ..processor import BasicProcessor
from ....streaming import get_stream_manager
from ....vision import (
    assess_ergonomic_risk,
    draw_boxes_overlay,
    draw_skeleton_overlay,
    get_ultralytics_runtime,
)


def _extract_stream_id(ref: str):
    if not ref:
        return None
    if ref.startswith("stream://"):
        return ref.replace("stream://", "", 1)
    if "/stream/" in ref and ".mjpg" in ref:
        return ref.split("/stream/")[1].split(".mjpg")[0]
    if "/stream/" in ref and ".mjpeg" in ref:
        return ref.split("/stream/")[1].split(".mjpeg")[0]
    return None


def _extract_asset_filename(url: str):
    parsed = urlparse(url)
    path = parsed.path
    marker = "/asset/"
    if marker not in path:
        return None
    raw = path.split(marker, 1)[1]
    return secure_filename(raw)


def _is_video_filename(filename: str):
    lower = filename.lower()
    return lower.endswith(".mp4") or lower.endswith(".mov") or lower.endswith(".avi")


def _to_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in ("1", "true", "yes", "on")


class MainVisionModelProcessor(BasicProcessor):
    processor_type = ProcessorType.MAIN_VISION_MODEL

    def __init__(self, config):
        super().__init__(config)
        self.model_path = config.get("model_path", "models/yolov5mu.pt")
        self.conf_threshold = float(config.get("conf_threshold", 0.25))
        self.stream_fps = float(
            config.get(
                "stream_fps",
                os.getenv("ASKI_MAIN_VISION_STREAM_FPS", "30"),
            )
        )
        if self.stream_fps <= 0:
            self.stream_fps = 30.0
        inference_fps_raw = config.get(
            "inference_fps",
            os.getenv("ASKI_MAIN_VISION_INFERENCE_FPS", None),
        )
        parsed_inference_fps = (
            float(inference_fps_raw)
            if inference_fps_raw not in (None, "")
            else float(self.stream_fps)
        )
        self.inference_fps = (
            0.0
            if parsed_inference_fps <= 0
            else max(float(parsed_inference_fps), float(self.stream_fps))
        )
        imgsz_raw = config.get(
            "imgsz",
            os.getenv("ASKI_MAIN_VISION_IMGSZ", "0"),
        )
        self.imgsz = int(imgsz_raw) if imgsz_raw not in (None, "") else 0
        self.input_url = config.get("input_url")
        self.classes = config.get("classes")
        self.enable_ergonomic_check = _to_bool(
            config.get(
                "enable_ergonomic_check",
                os.getenv("ASKI_MAIN_VISION_ENABLE_ERGONOMIC_CHECK", "0"),
            )
        )
        self.ergonomic_pose_model_path = str(
            config.get(
                "ergonomic_pose_model_path",
                os.getenv("ASKI_MAIN_VISION_POSE_MODEL_PATH", "models/yolov8n-pose.pt"),
            )
        )
        self.ergonomic_min_keypoint_conf = float(
            config.get(
                "ergonomic_min_keypoint_conf",
                os.getenv("ASKI_MAIN_VISION_ERGONOMIC_KP_CONF", "0.35"),
            )
        )
        self._ergonomic_error_cache: Optional[str] = None

    def _build_detection_payload(
        self,
        predictions: Optional[Dict[str, Any]],
        mode: str,
        extra: Optional[Dict[str, Any]] = None,
        ergonomic: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        predictions = predictions or {}
        boxes = predictions.get("boxes") or []
        counts_by_label: Dict[str, int] = {}
        detections: List[Dict[str, Any]] = []

        for idx, box in enumerate(boxes):
            label = str(box.get("label", "unknown"))
            counts_by_label[label] = counts_by_label.get(label, 0) + 1

            xyxy = box.get("xyxy") or [0, 0, 0, 0]
            try:
                x1, y1, x2, y2 = [float(v) for v in xyxy[:4]]
            except Exception:
                x1, y1, x2, y2 = 0.0, 0.0, 0.0, 0.0

            detections.append(
                {
                    "index": idx,
                    "label": label,
                    "class_id": box.get("class_id"),
                    "confidence": float(box.get("conf", 0.0)),
                    "position": {
                        "x1": x1,
                        "y1": y1,
                        "x2": x2,
                        "y2": y2,
                    },
                }
            )

        summary = {
            "total_detections": len(detections),
            "counts_by_label": counts_by_label,
            "labels_detected": sorted(list(counts_by_label.keys())),
        }

        payload: Dict[str, Any] = {
            "mode": mode,
            "detection_summary": summary,
            "detections": detections,
            "shape": predictions.get("shape"),
            "ergonomic": ergonomic or {"enabled": False},
        }
        if extra:
            payload.update(extra)
        return payload

    def _run_ergonomic_inference(self, frame: Any, runtime) -> Dict[str, Any]:
        if not self.enable_ergonomic_check:
            return {"enabled": False}

        if self._ergonomic_error_cache:
            return {
                "enabled": True,
                "available": False,
                "status": "error",
                "pose_model_path": self.ergonomic_pose_model_path,
                "person_count": 0,
                "risk_summary": {
                    "overall_risk_level": "unknown",
                    "counts_by_level": {"low": 0, "medium": 0, "high": 0},
                    "average_risk_score": 0,
                },
                "people": [],
                "error": self._ergonomic_error_cache,
            }

        try:
            pose_predictions = runtime.predict_pose(
                frame,
                model_path=self.ergonomic_pose_model_path,
                conf=self.conf_threshold,
                imgsz=self.imgsz,
            ) or {}
        except Exception as e:
            self._ergonomic_error_cache = str(e)
            return {
                "enabled": True,
                "available": False,
                "status": "error",
                "pose_model_path": self.ergonomic_pose_model_path,
                "person_count": 0,
                "risk_summary": {
                    "overall_risk_level": "unknown",
                    "counts_by_level": {"low": 0, "medium": 0, "high": 0},
                    "average_risk_score": 0,
                },
                "people": [],
                "error": self._ergonomic_error_cache,
            }

        raw_people = pose_predictions.get("people") or []
        analyzed_people: List[Dict[str, Any]] = []
        counts_by_level = {"low": 0, "medium": 0, "high": 0}
        total_score = 0.0

        for person in raw_people:
            keypoints = person.get("keypoints") or []
            assessment = assess_ergonomic_risk(
                keypoints,
                min_conf=self.ergonomic_min_keypoint_conf,
            )
            level = str(assessment.get("risk_level", "low"))
            if level not in counts_by_level:
                level = "low"
            counts_by_level[level] += 1
            total_score += float(assessment.get("risk_score", 0) or 0)
            analyzed_people.append(
                {
                    **person,
                    "assessment": assessment,
                }
            )

        person_count = len(analyzed_people)
        average_score = round(total_score / person_count, 1) if person_count > 0 else 0.0
        overall_level = "low"
        if counts_by_level["high"] > 0:
            overall_level = "high"
        elif counts_by_level["medium"] > 0:
            overall_level = "medium"

        return {
            "enabled": True,
            "available": True,
            "status": "ok",
            "pose_model_path": self.ergonomic_pose_model_path,
            "person_count": person_count,
            "risk_summary": {
                "overall_risk_level": overall_level,
                "counts_by_level": counts_by_level,
                "average_risk_score": average_score,
            },
            "people": analyzed_people,
        }

    def _compose_overlay(
        self,
        frame: Any,
        predictions: Dict[str, Any],
        ergonomic_payload: Dict[str, Any],
    ) -> Any:
        overlay = draw_boxes_overlay(frame, predictions)
        if not self.enable_ergonomic_check:
            return overlay

        people = ergonomic_payload.get("people") or []
        if not people:
            return overlay

        return draw_skeleton_overlay(
            overlay,
            people,
            min_conf=self.ergonomic_min_keypoint_conf,
        )

    def _resolve_class_indices(self, runtime) -> Optional[List[int]]:
        """Resolve the optional `classes` filter into a list of class indices.

        Accepts:
          - list[int]
          - list[str] (label or numeric)
          - comma-separated string ("0,2,person")
        """

        raw = self.get_input_by_name("classes", self.classes)
        if raw is None:
            return None

        items: List[Union[str, int]]
        if isinstance(raw, str):
            s = raw.strip()
            if not s:
                return None
            items = [x.strip() for x in s.replace(";", ",").split(",") if x.strip()]
        elif isinstance(raw, list):
            items = [x for x in raw if x is not None and str(x).strip()]
        else:
            items = [raw]

        if not items:
            return None

        model = runtime.get_model(self.model_path)
        names_obj = getattr(model, "names", None)
        idx_to_name: Dict[int, str] = {}
        if isinstance(names_obj, dict):
            idx_to_name = {int(k): str(v) for k, v in names_obj.items()}
        elif isinstance(names_obj, list):
            idx_to_name = {i: str(v) for i, v in enumerate(names_obj)}

        name_to_idx = {v.lower(): k for k, v in idx_to_name.items()}

        resolved: List[int] = []
        unknown: List[str] = []
        for it in items:
            if isinstance(it, (int, float)):
                resolved.append(int(it))
                continue

            part = str(it).strip()
            if not part:
                continue
            if part.isdigit():
                resolved.append(int(part))
                continue

            key = part.lower()
            if key in name_to_idx:
                resolved.append(int(name_to_idx[key]))
            else:
                unknown.append(part)

        if unknown:
            raise ValueError(
                "Unknown class label(s): "
                + ", ".join(unknown)
                + ". Provide valid class names for the selected model, or numeric class IDs."
            )

        # Deduplicate while preserving order
        uniq: List[int] = []
        seen = set()
        for x in resolved:
            if x in seen:
                continue
            uniq.append(x)
            seen.add(x)
        return uniq if uniq else None

    def process(self):
        if cv2 is None or np is None:
            raise RuntimeError(
                "opencv-python and numpy are required for main-vision-model processor."
            )

        input_raw = self.get_input_by_name(
            "input_url",
            self.input_url,
            accept_object=True,
        )

        input_ref = None
        if isinstance(input_raw, list):
            input_ref = input_raw[0] if len(input_raw) > 0 else None
        elif isinstance(input_raw, str):
            s = input_raw.strip()
            if s.startswith("[") and s.endswith("]"):
                try:
                    parsed = json.loads(s)
                    if isinstance(parsed, list) and len(parsed) > 0:
                        input_ref = parsed[0]
                    else:
                        input_ref = input_raw
                except Exception:
                    input_ref = input_raw
            else:
                input_ref = input_raw
        else:
            input_ref = input_raw

        if not input_ref:
            raise ValueError("main-vision-model requires input_url")

        stream_id = _extract_stream_id(input_ref)
        if stream_id:
            return self._process_stream(stream_id)
        return self._process_file(input_ref)

    def _process_stream(self, source_stream_id: str):
        manager = get_stream_manager()
        manager.stop_streams_by_owner(self.name)
        runtime = get_ultralytics_runtime()

        source_stream_fps = None
        source_state = manager.get_stream(source_stream_id)
        if source_state is not None:
            try:
                with source_state.lock:
                    raw_source_fps = source_state.camera_fps
                if raw_source_fps is not None:
                    parsed_source_fps = float(raw_source_fps)
                    if parsed_source_fps > 0:
                        source_stream_fps = parsed_source_fps
            except Exception:
                source_stream_fps = None

        effective_stream_fps = float(self.stream_fps)
        if source_stream_fps is not None:
            effective_stream_fps = max(effective_stream_fps, source_stream_fps)

        # Fail fast in local-first mode if the model weights are missing.
        # Without this, the transform thread can silently loop without frames.
        _ = runtime._normalize_key(self.model_path)
        inference_fps = float(self.inference_fps)
        if inference_fps > 0:
            inference_fps = max(inference_fps, effective_stream_fps)
        inference_interval = (
            0.0 if inference_fps <= 0 else 1.0 / max(float(inference_fps), 1.0)
        )
        last_inference_at = 0.0
        last_predictions: Dict[str, Any] = {}
        last_ergonomic_payload: Dict[str, Any] = {"enabled": False}
        startup_ready = threading.Event()
        startup_state: Dict[str, Any] = {
            "class_indices": None,
            "error": None,
            "status": "warming_up",
            "started_at": time.monotonic(),
        }
        startup_state_lock = threading.Lock()

        def _warmup_model():
            resolved_class_indices: Optional[List[int]] = None
            startup_error: Optional[str] = None
            try:
                # Resolve class filters (loads model if label names are provided).
                resolved_class_indices = self._resolve_class_indices(runtime)

                # Ensure the primary model is cached before the transform loop needs it.
                if resolved_class_indices is None:
                    runtime.get_model(self.model_path)

                # Optional pose model warmup to avoid a second startup hitch when enabled.
                if self.enable_ergonomic_check and not self._ergonomic_error_cache:
                    try:
                        runtime.get_model(self.ergonomic_pose_model_path)
                    except Exception as e:
                        # Keep detection running even if ergonomic pose model is unavailable.
                        self._ergonomic_error_cache = str(e)
            except Exception as e:
                startup_error = str(e)
            finally:
                with startup_state_lock:
                    startup_state["class_indices"] = resolved_class_indices
                    startup_state["error"] = startup_error
                    startup_state["status"] = "error" if startup_error else "ready"
                    startup_state["ready_at"] = time.monotonic()
                startup_ready.set()

        threading.Thread(
            target=_warmup_model,
            name=f"main-vision-warmup-{self.name}",
            daemon=True,
        ).start()

        startup_error_raised = False

        def _transform(frame):
            nonlocal last_inference_at
            nonlocal last_predictions
            nonlocal last_ergonomic_payload
            nonlocal startup_error_raised

            if not startup_ready.is_set():
                # Keep the stream responsive while a heavy model loads in the background.
                overlay = self._compose_overlay(frame, last_predictions, last_ergonomic_payload)
                return overlay, last_predictions

            with startup_state_lock:
                class_indices = startup_state.get("class_indices")
                startup_error = startup_state.get("error")

            if startup_error:
                if not startup_error_raised:
                    startup_error_raised = True
                    raise RuntimeError(
                        f"Main Vision warm-up failed for '{self.model_path}': {startup_error}"
                    )
                overlay = self._compose_overlay(frame, last_predictions, last_ergonomic_payload)
                return overlay, last_predictions

            now = time.monotonic()

            # Run heavy model inference at a controlled rate, while still pushing
            # display frames at stream_fps with the latest known predictions.
            should_infer = (
                inference_interval <= 0.0
                or (now - last_inference_at) >= inference_interval
                or not last_predictions
            )
            if should_infer:
                predictions = runtime.predict(
                    frame,
                    model_path=self.model_path,
                    conf=self.conf_threshold,
                    classes=class_indices,
                    imgsz=self.imgsz,
                )
                last_predictions = predictions or {}
                last_inference_at = now
                if self.enable_ergonomic_check:
                    last_ergonomic_payload = self._run_ergonomic_inference(frame, runtime)
            else:
                predictions = last_predictions

            overlay = self._compose_overlay(frame, predictions, last_ergonomic_payload)
            return overlay, predictions

        overlay_stream_id = manager.create_transform_stream(
            source_stream_id,
            _transform,
            fps=max(1.0, float(effective_stream_fps)),
            owner_name=self.name,
        )
        predictions_url = manager.build_predictions_url(overlay_stream_id)

        predictions_payload = self._build_detection_payload(
            last_predictions,
            mode="stream",
            extra={
                "live": True,
                "predictions_url": predictions_url,
                "stream_id": overlay_stream_id,
                "startup_status": "warming_up",
                "startup_deferred": True,
            },
            ergonomic=last_ergonomic_payload,
        )

        return [
            json.dumps(predictions_payload),
            f"stream://{overlay_stream_id}",
        ]

    def _process_file(self, input_url: str):
        filename = _extract_asset_filename(input_url)
        if not filename:
            raise ValueError("main-vision-model expects /asset/<file> URL or stream:// ref")

        storage = self.get_storage()
        content = storage.get_file(filename)
        runtime = get_ultralytics_runtime()

        if _is_video_filename(filename):
            return self._process_video_bytes(content, runtime)
        return self._process_image_bytes(content, runtime)

    def _process_image_bytes(self, content: bytes, runtime):
        image = cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError("Could not decode input image")

        class_indices = self._resolve_class_indices(runtime)
        predictions = runtime.predict(
            image,
            model_path=self.model_path,
            conf=self.conf_threshold,
            classes=class_indices,
            imgsz=self.imgsz,
        )
        ergonomic_payload = self._run_ergonomic_inference(image, runtime)
        overlay = self._compose_overlay(image, predictions, ergonomic_payload)
        ok, encoded = cv2.imencode(".jpg", overlay)
        if not ok:
            raise RuntimeError("Could not encode overlay image")

        filename = f"{self.name}-overlay-{uuid.uuid4().hex[:10]}.jpg"
        overlay_url = self.get_storage().save(filename, encoded.tobytes())
        payload = self._build_detection_payload(
            predictions,
            mode="image",
            ergonomic=ergonomic_payload,
        )
        return [json.dumps(payload), overlay_url]

    def _process_video_bytes(self, content: bytes, runtime):
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as src:
            src.write(content)
            src_path = src.name

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as dst:
            dst_path = dst.name

        cap = cv2.VideoCapture(src_path)
        if not cap.isOpened():
            raise RuntimeError("Could not open input video")

        fps = cap.get(cv2.CAP_PROP_FPS) or 20.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)
        writer = cv2.VideoWriter(
            dst_path,
            cv2.VideoWriter_fourcc(*"mp4v"),
            fps,
            (width, height),
        )
        if not writer.isOpened():
            cap.release()
            raise RuntimeError("Could not initialize output video writer")

        last_predictions = {}
        last_ergonomic_payload: Dict[str, Any] = {"enabled": False}
        frame_count = 0
        class_indices = self._resolve_class_indices(runtime)
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            preds = runtime.predict(
                frame,
                model_path=self.model_path,
                conf=self.conf_threshold,
                classes=class_indices,
                imgsz=self.imgsz,
            )
            ergonomic_payload = self._run_ergonomic_inference(frame, runtime)
            frame_overlay = self._compose_overlay(frame, preds, ergonomic_payload)
            writer.write(frame_overlay)
            last_predictions = preds
            last_ergonomic_payload = ergonomic_payload
            frame_count += 1

        cap.release()
        writer.release()

        with open(dst_path, "rb") as f:
            overlay_bytes = f.read()
        for p in (src_path, dst_path):
            try:
                os.remove(p)
            except OSError:
                pass

        overlay_filename = f"{self.name}-overlay-{uuid.uuid4().hex[:10]}.mp4"
        overlay_url = self.get_storage().save(overlay_filename, overlay_bytes)
        payload = self._build_detection_payload(
            last_predictions,
            mode="video",
            extra={"frame_count": frame_count},
            ergonomic=last_ergonomic_payload,
        )
        return [json.dumps(payload), overlay_url]

    def cancel(self):
        pass
