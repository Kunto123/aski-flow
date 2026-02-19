import os
from typing import Any, Dict, Optional, Sequence


class UltralyticsRuntime:
    """Cached YOLO runtime keyed by absolute model path/name."""

    def __init__(self):
        self._models: Dict[str, YOLO] = {}

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
            self._models[key] = model
        return model

    def predict(
        self,
        image: Any,
        model_path: str,
        conf: float = 0.25,
        classes: Optional[Sequence[int]] = None,
    ) -> Dict[str, Any]:
        model = self.get_model(model_path)
        kwargs: Dict[str, Any] = {"verbose": False, "conf": conf}
        if classes is not None:
            kwargs["classes"] = list(classes)

        result = model.predict(image, **kwargs)[0]
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


_RUNTIME = UltralyticsRuntime()


def get_ultralytics_runtime() -> UltralyticsRuntime:
    return _RUNTIME
