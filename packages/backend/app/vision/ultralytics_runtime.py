import os
import logging
from typing import Any, Dict, Optional


class UltralyticsRuntime:
    """Cached YOLO runtime keyed by absolute model path/name."""

    def __init__(self):
        self._models: Dict[str, YOLO] = {}

    def _normalize_key(self, model_path: str) -> str:
        if not model_path:
            model_path = "yolov8n.pt"

        resolved = self._resolve_model_path(model_path)
        if resolved is not None:
            return os.path.abspath(resolved)

        # If the requested model path is missing, fallback to any local model
        # before failing. This keeps the node usable on fresh setups where
        # users have custom local weights but not the default one.
        fallback = self._find_any_local_model()
        if fallback is not None:
            logging.warning(
                "Requested model '%s' not found. Falling back to local model '%s'.",
                model_path,
                fallback,
            )
            return os.path.abspath(fallback)

        # Local-first safety: do NOT allow implicit downloads.
        # Ultralytics will attempt to download weights when given a known name
        # (e.g. "yolov8n.pt") if it does not exist on disk.
        allow_download = os.getenv("ASKI_ALLOW_ULTRALYTICS_DOWNLOAD", "0") == "1"
        if not allow_download:
            raise FileNotFoundError(
                "YOLO weights not found locally: "
                f"'{model_path}'.\n"
                "Local-first mode blocks implicit downloads. "
                "Place the weights file locally (e.g. './models/yolov8n.pt' or './data/models/yolo/yolov8n.pt' or './packages/backend/models/yolov5m.pt') "
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
        if not model_path:
            return None

        # Important runtime anchors:
        # - backend_root: <repo>/packages/backend
        # - repo_root: <repo>
        backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        repo_root = os.path.abspath(os.path.join(backend_root, "..", ".."))
        cwd = os.getcwd()

        # 1) Try as-is and relative to common roots for explicit paths
        explicit_candidates = [
            model_path,
            os.path.join(cwd, model_path),
            os.path.join(repo_root, model_path),
            os.path.join(backend_root, model_path),
        ]
        for cand in explicit_candidates:
            if os.path.exists(cand):
                return cand

        # 2) Fallback by basename in common model directories
        basename = os.path.basename(model_path)
        if not basename:
            return None

        search_dirs = [
            os.path.join(cwd, "models"),
            os.path.join(cwd, "data", "models"),
            os.path.join(cwd, "data", "models", "yolo"),
            os.path.join(cwd, "data", "models", "vision"),
            os.path.join(repo_root, "models"),
            os.path.join(repo_root, "data", "models"),
            os.path.join(repo_root, "data", "models", "yolo"),
            os.path.join(repo_root, "data", "models", "vision"),
            os.path.join(backend_root, "models"),
            os.path.join(backend_root, "data", "models"),
            os.path.join(backend_root, "data", "models", "yolo"),
            os.path.join(backend_root, "data", "models", "vision"),
        ]

        names_to_try = [basename]
        if "." not in basename:
            names_to_try.extend(
                [
                    f"{basename}.pt",
                    f"{basename}.onnx",
                    f"{basename}.engine",
                ]
            )

        for directory in search_dirs:
            for model_name in names_to_try:
                cand = os.path.join(directory, model_name)
                if os.path.exists(cand):
                    return cand

        return None

    def _find_any_local_model(self) -> Optional[str]:
        backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        repo_root = os.path.abspath(os.path.join(backend_root, "..", ".."))
        cwd = os.getcwd()

        search_dirs = [
            os.path.join(cwd, "models"),
            os.path.join(cwd, "data", "models"),
            os.path.join(cwd, "data", "models", "yolo"),
            os.path.join(cwd, "data", "models", "vision"),
            os.path.join(repo_root, "models"),
            os.path.join(repo_root, "data", "models"),
            os.path.join(repo_root, "data", "models", "yolo"),
            os.path.join(repo_root, "data", "models", "vision"),
            os.path.join(backend_root, "models"),
            os.path.join(backend_root, "data", "models"),
            os.path.join(backend_root, "data", "models", "yolo"),
            os.path.join(backend_root, "data", "models", "vision"),
        ]

        found = []
        for directory in search_dirs:
            if not os.path.isdir(directory):
                continue
            for name in os.listdir(directory):
                lower = name.lower()
                if lower.endswith(".pt") or lower.endswith(".onnx") or lower.endswith(".engine"):
                    found.append(os.path.join(directory, name))

        if not found:
            return None

        found = sorted(set(found))
        return found[0]

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
