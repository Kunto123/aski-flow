import os
from typing import Any, Dict


class UltralyticsRuntime:
    """Cached YOLO runtime keyed by absolute model path/name."""

    def __init__(self):
        self._models: Dict[str, YOLO] = {}

    def _normalize_key(self, model_path: str) -> str:
        if not model_path:
            return "yolov8n.pt"
        if os.path.exists(model_path):
            return os.path.abspath(model_path)
        return model_path

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

    def predict(self, image, model_path: str, conf: float = 0.25) -> Dict[str, Any]:
        model = self.get_model(model_path)
        result = model.predict(image, verbose=False, conf=conf)[0]
        names = result.names or {}
        boxes = []

        if result.boxes is not None:
            for box in result.boxes:
                xyxy = box.xyxy[0].tolist()
                cls = int(box.cls[0].item())
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
