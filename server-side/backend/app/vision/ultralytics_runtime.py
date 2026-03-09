import os
from typing import Any, Dict, List, Optional, Sequence

_COCO_KEYPOINT_NAMES = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]


class UltralyticsRuntime:
    """Cached YOLO runtime keyed by absolute model path/name."""

    def __init__(self):
        self._models: Dict[str, YOLO] = {}
        self._inference_device = self._resolve_inference_device()

    def _load_torch(self):
        try:
            import torch
        except Exception:
            return None
        return torch

    def _resolve_inference_device(self) -> str:
        forced = str(os.getenv("ASKI_MAIN_VISION_DEVICE", "")).strip()
        torch = self._load_torch()

        if forced:
            forced_lower = forced.lower()
            if torch is None:
                return forced

            if forced_lower.startswith("cuda"):
                try:
                    if torch.cuda.is_available():
                        return forced
                except Exception:
                    pass
                return "cpu"

            if forced_lower == "mps":
                try:
                    mps_backend = getattr(getattr(torch, "backends", None), "mps", None)
                    if mps_backend is not None and mps_backend.is_available():
                        return "mps"
                except Exception:
                    pass
                return "cpu"

            return forced

        if torch is not None:
            try:
                if torch.cuda.is_available():
                    return "cuda:0"
            except Exception:
                pass
            try:
                mps_backend = getattr(getattr(torch, "backends", None), "mps", None)
                if mps_backend is not None and mps_backend.is_available():
                    return "mps"
            except Exception:
                pass

        return "cpu"

    def _normalize_key(self, model_path: str) -> str:
        if not model_path:
            model_path = "yolov5mu.pt"

        resolved = self._resolve_model_path(model_path)
        if resolved is not None:
            return os.path.abspath(resolved)

        # Local-first safety: do NOT allow implicit downloads.
        # Ultralytics will attempt to download weights when given a known name
        # (e.g. "yolov5mu.pt") if it does not exist on disk.
        allow_download = os.getenv("ASKI_ALLOW_ULTRALYTICS_DOWNLOAD", "0") == "1"
        if not allow_download:
            raise FileNotFoundError(
                "YOLO weights not found locally: "
                f"'{model_path}'.\n"
                "Local-first mode blocks implicit downloads. "
                "Place the weights file locally (e.g. './models/yolov5mu.pt' or './data/models/yolo/yolov5mu.pt') "
                "and set 'model_path' accordingly.\n"
                "(To override for dev only, set ASKI_ALLOW_ULTRALYTICS_DOWNLOAD=1)"
            )

        # If explicitly allowed, fallback to passing the raw name (Ultralytics may download).
        return model_path

    def _resolve_model_path(self, model_path: str) -> Optional[str]:
        """Resolve a model path in a local-first way.

        - If an absolute/relative path exists, use it.
        - If a bare filename is provided, try common local directories.
        """

        if os.path.exists(model_path):
            return model_path

        basename = os.path.basename(model_path)
        if not basename:
            return None

        # Only attempt common search paths when user passed a bare filename.
        if basename != model_path:
            return None

        candidates = [
            os.path.join("models", basename),
            os.path.join("data", "models", basename),
            os.path.join("data", "models", "yolo", basename),
            os.path.join("data", "models", "vision", basename),
        ]

        for cand in candidates:
            if os.path.exists(cand):
                return cand

        return None

    def _load_yolo_class(self):
        try:
            from ultralytics import YOLO
        except Exception as e:
            raise RuntimeError(
                "ultralytics is required for main-vision-model processor. Install backend dependencies first."
            ) from e
        return YOLO

    def get_model(self, model_path: str):
        YOLO = self._load_yolo_class()
        key = self._normalize_key(model_path)
        model = self._models.get(key)
        if model is None:
            model = YOLO(key)
            self._prepare_model_device(model)
            self._models[key] = model
        return model

    def _prepare_model_device(self, model):
        target_device = self._inference_device
        try:
            model.to(target_device)
        except Exception:
            if target_device != "cpu":
                self._inference_device = "cpu"
                try:
                    model.to("cpu")
                except Exception:
                    pass

    def _predict_with_device(self, model, image: Any, kwargs: Dict[str, Any]):
        request_kwargs = dict(kwargs)
        request_kwargs["device"] = self._inference_device
        try:
            return model.predict(image, **request_kwargs)
        except Exception:
            if self._inference_device == "cpu":
                raise
            fallback_kwargs = dict(kwargs)
            fallback_kwargs["device"] = "cpu"
            results = model.predict(image, **fallback_kwargs)
            self._inference_device = "cpu"
            return results

    def _resolve_imgsz(self, image: Any, imgsz: Optional[int]):
        frame_height: Optional[int] = None
        frame_width: Optional[int] = None
        if image is not None:
            try:
                frame_height = int(image.shape[0])
                frame_width = int(image.shape[1])
            except Exception:
                frame_height = None
                frame_width = None

        if imgsz is None:
            return None

        try:
            imgsz_value = int(imgsz)
        except Exception:
            return None

        if imgsz_value > 0:
            if (
                frame_height is not None
                and frame_width is not None
                and imgsz_value < max(frame_height, frame_width)
            ):
                return (frame_height, frame_width)
            return imgsz_value

        if frame_height is not None and frame_width is not None:
            return (frame_height, frame_width)
        return None

    def predict(
        self,
        image: Any,
        model_path: str,
        conf: float = 0.25,
        classes: Optional[Sequence[int]] = None,
        imgsz: Optional[int] = None,
    ) -> Dict[str, Any]:
        model = self.get_model(model_path)
        kwargs: Dict[str, Any] = {"verbose": False, "conf": conf}
        if classes is not None:
            kwargs["classes"] = list(classes)
        imgsz_value = self._resolve_imgsz(image, imgsz)
        if imgsz_value is not None:
            kwargs["imgsz"] = imgsz_value

        result = self._predict_with_device(model, image, kwargs)[0]
        names = result.names or {}
        boxes = []

        if result.boxes is not None:
            allowed = set(classes) if classes is not None else None
            for box in result.boxes:
                xyxy = box.xyxy[0].tolist()
                cls = int(box.cls[0].item())
                if allowed is not None and cls not in allowed:
                    continue
                conf_score = float(box.conf[0].item())
                label = names.get(cls, str(cls))
                boxes.append(
                    {
                        "xyxy": [float(x) for x in xyxy],
                        "conf": conf_score,
                        "label": label,
                        "class_id": cls,
                    }
                )

        return {
            "boxes": boxes,
            "names": names,
            "shape": list(image.shape[:2]) if image is not None else None,
        }

    def predict_pose(
        self,
        image: Any,
        model_path: str,
        conf: float = 0.25,
        imgsz: Optional[int] = None,
    ) -> Dict[str, Any]:
        model = self.get_model(model_path)
        kwargs: Dict[str, Any] = {"verbose": False, "conf": conf}
        imgsz_value = self._resolve_imgsz(image, imgsz)
        if imgsz_value is not None:
            kwargs["imgsz"] = imgsz_value

        result = self._predict_with_device(model, image, kwargs)[0]
        shape = list(image.shape[:2]) if image is not None else None
        if result is None or result.keypoints is None:
            return {"people": [], "shape": shape}

        people: List[Dict[str, Any]] = []

        boxes_xyxy = None
        boxes_conf = None
        if result.boxes is not None:
            try:
                boxes_xyxy = result.boxes.xyxy.cpu().numpy()
            except Exception:
                boxes_xyxy = None
            try:
                boxes_conf = result.boxes.conf.cpu().numpy()
            except Exception:
                boxes_conf = None

        try:
            kp_xy = result.keypoints.xy.cpu().numpy()
        except Exception:
            kp_xy = None
        try:
            kp_conf = result.keypoints.conf.cpu().numpy()
        except Exception:
            kp_conf = None

        if kp_xy is None:
            return {"people": [], "shape": shape}

        for i in range(len(kp_xy)):
            keypoints = []
            person_xy = kp_xy[i]
            person_conf = kp_conf[i] if kp_conf is not None and i < len(kp_conf) else None

            for kp_idx in range(len(person_xy)):
                x, y = person_xy[kp_idx]
                conf_val = 1.0
                if person_conf is not None and kp_idx < len(person_conf):
                    try:
                        conf_val = float(person_conf[kp_idx])
                    except Exception:
                        conf_val = 0.0

                keypoints.append(
                    {
                        "index": int(kp_idx),
                        "name": (
                            _COCO_KEYPOINT_NAMES[kp_idx]
                            if kp_idx < len(_COCO_KEYPOINT_NAMES)
                            else str(kp_idx)
                        ),
                        "x": float(x),
                        "y": float(y),
                        "conf": float(conf_val),
                    }
                )

            bbox_xyxy = None
            det_conf = None
            if boxes_xyxy is not None and i < len(boxes_xyxy):
                bbox_xyxy = [float(v) for v in boxes_xyxy[i][:4]]
            if boxes_conf is not None and i < len(boxes_conf):
                try:
                    det_conf = float(boxes_conf[i])
                except Exception:
                    det_conf = None

            people.append(
                {
                    "person_index": int(i),
                    "bbox_xyxy": bbox_xyxy,
                    "confidence": det_conf,
                    "keypoints": keypoints,
                }
            )

        return {
            "people": people,
            "shape": shape,
        }


_RUNTIME = UltralyticsRuntime()


def get_ultralytics_runtime() -> UltralyticsRuntime:
    return _RUNTIME
