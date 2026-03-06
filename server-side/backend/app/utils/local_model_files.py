from pathlib import Path

LOCAL_MODEL_FILE_EXTENSIONS = {".pt", ".onnx"}


def server_model_search_roots() -> list[Path]:
    roots = [
        Path("models"),
        Path("data") / "models",
        Path("data") / "models" / "yolo",
        Path("data") / "models" / "vision",
    ]
    deduped: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        try:
            key = str(root.resolve()).lower()
        except Exception:
            key = str(root).lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(root)
    return deduped


def to_runtime_path(path: Path) -> str:
    try:
        rel = path.resolve().relative_to(Path.cwd().resolve())
        return rel.as_posix()
    except Exception:
        return str(path).replace("\\", "/")


def infer_local_model_kind(file_name: str) -> str:
    name = (file_name or "").lower()
    if "pose" in name or "keypoint" in name:
        return "pose"
    if "seg" in name or "segment" in name:
        return "segmentation"
    if "cls" in name or "classif" in name:
        return "classification"
    return "detect"


def infer_local_model_source(path: Path) -> str:
    normalized = str(path).replace("\\", "/").lower()
    if "/models/trained/" in normalized:
        return "trained"
    if "/models/architectures/" in normalized:
        return "architecture"

    basename = path.name.lower()
    if basename in {"yolov5m.pt", "yolov5mu.pt"}:
        return "architecture"
    return "custom"


def list_local_model_files_payload() -> dict:
    files = []
    seen_paths = set()
    roots_payload = []

    for root in server_model_search_roots():
        root_exists = root.exists() and root.is_dir()
        roots_payload.append({"path": to_runtime_path(root), "exists": root_exists})
        if not root_exists:
            continue

        for candidate in root.rglob("*"):
            if not candidate.is_file():
                continue

            ext = candidate.suffix.lower()
            if ext not in LOCAL_MODEL_FILE_EXTENSIONS:
                continue

            runtime_path = to_runtime_path(candidate)
            dedupe_key = runtime_path.lower()
            if dedupe_key in seen_paths:
                continue
            seen_paths.add(dedupe_key)

            files.append(
                {
                    "path": runtime_path,
                    "basename": candidate.name,
                    "extension": ext,
                    "kind": infer_local_model_kind(candidate.name),
                    "source": infer_local_model_source(candidate),
                    "search_root": to_runtime_path(root),
                }
            )

    files.sort(
        key=lambda item: (
            item["basename"].lower(),
            item["path"].lower(),
        )
    )

    return {
        "files": files,
        "count": len(files),
        "roots": roots_payload,
    }
