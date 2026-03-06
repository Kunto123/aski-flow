import io
import json
import time
import uuid
import zipfile
from pathlib import Path

from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename

from app.storage.db import connect, get_data_root
from app.utils.local_model_files import (
    LOCAL_MODEL_FILE_EXTENSIONS,
    infer_local_model_kind,
    infer_local_model_source,
    list_local_model_files_payload,
    server_model_search_roots,
    to_runtime_path,
)
from app.utils.ocr_languages import list_ocr_languages_payload

models_blueprint = Blueprint("models_blueprint", __name__)


def _local_model_manage_roots() -> list[Path]:
    roots: list[Path] = []
    seen: set[str] = set()
    for raw_root in server_model_search_roots():
        root = raw_root if raw_root.is_absolute() else (Path.cwd() / raw_root)
        root = root.resolve()
        # Ensure canonical default root exists for upload.
        if raw_root.as_posix() == "models":
            root.mkdir(parents=True, exist_ok=True)
        if not root.exists() or not root.is_dir():
            continue
        key = str(root).lower()
        if key in seen:
            continue
        seen.add(key)
        roots.append(root)
    return roots


def _first_manage_root() -> Path:
    roots = _local_model_manage_roots()
    if roots:
        return roots[0]
    fallback = (Path.cwd() / "models").resolve()
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def _resolve_model_file_path(raw_path: str) -> Path:
    candidate = Path(str(raw_path or "").strip())
    if not str(candidate):
        raise ValueError("Missing model path")
    if not candidate.is_absolute():
        candidate = (Path.cwd() / candidate).resolve()
    else:
        candidate = candidate.resolve()

    for root in _local_model_manage_roots():
        if candidate == root or root in candidate.parents:
            return candidate
    raise ValueError("Model path is outside allowed roots")


def _ensure_supported_model_file(path: Path) -> None:
    if path.suffix.lower() not in LOCAL_MODEL_FILE_EXTENSIONS:
        raise ValueError(
            f"Unsupported model extension '{path.suffix}'. "
            f"Allowed: {', '.join(sorted(LOCAL_MODEL_FILE_EXTENSIONS))}"
        )
    if not path.is_file():
        raise FileNotFoundError("Model file not found")


def _model_file_payload(path: Path, search_root: Path | None = None) -> dict:
    return {
        "path": to_runtime_path(path),
        "basename": path.name,
        "extension": path.suffix.lower(),
        "kind": infer_local_model_kind(path.name),
        "source": infer_local_model_source(path),
        "search_root": to_runtime_path(search_root or path.parent),
        "size_bytes": int(path.stat().st_size),
    }

def _models_root() -> Path:
    root = get_data_root() / "models"
    root.mkdir(parents=True, exist_ok=True)
    return root

@models_blueprint.route("/models", methods=["GET"])
def list_models():
    with connect() as conn:
        rows = conn.execute("SELECT * FROM models ORDER BY created_at DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@models_blueprint.route("/models/local-files", methods=["GET"])
def list_local_model_files():
    return list_local_model_files_payload()


@models_blueprint.route("/models/ocr-languages", methods=["GET"])
def list_ocr_languages():
    return list_ocr_languages_payload()

@models_blueprint.route("/models/<model_id>", methods=["GET"])
def get_model(model_id: str):
    with connect() as conn:
        row = conn.execute("SELECT * FROM models WHERE id=?", (model_id,)).fetchone()
    if not row:
        return {"error": "Model not found"}, 404
    return jsonify(dict(row))

@models_blueprint.route("/models/upload", methods=["POST"])
def upload_model():
    # expects multipart with file=zip
    if "file" not in request.files:
        return {"error": "Missing file field"}, 400
    f = request.files["file"]
    data = f.read()
    z = zipfile.ZipFile(io.BytesIO(data))
    # must contain manifest.json
    try:
        manifest = json.loads(z.read("manifest.json").decode("utf-8"))
    except Exception as e:
        return {"error": f"Invalid model package: missing/invalid manifest.json ({e})"}, 400

    model_id = manifest.get("id") or f"model-{uuid.uuid4().hex[:10]}"
    name = manifest.get("name") or model_id
    task = manifest.get("task") or "vision"
    runtime = manifest.get("runtime") or "ultralytics"

    out_dir = _models_root() / model_id
    if out_dir.exists():
        # overwrite allowed
        for p in out_dir.rglob("*"):
            try:
                p.unlink()
            except Exception:
                pass
    out_dir.mkdir(parents=True, exist_ok=True)
    z.extractall(out_dir)

    with connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO models(id,name,task,runtime,path,created_at) VALUES(?,?,?,?,?,?)",
            (model_id, name, task, runtime, str(out_dir), time.time()),
        )
        conn.commit()

    return {"id": model_id, "name": name, "task": task, "runtime": runtime}

@models_blueprint.route("/models/<model_id>/validate", methods=["POST"])
def validate_model(model_id: str):
    # minimal validation: manifest exists and weights/code files exist as declared
    with connect() as conn:
        row = conn.execute("SELECT * FROM models WHERE id=?", (model_id,)).fetchone()
    if not row:
        return {"error": "Model not found"}, 404
    model_path = Path(row["path"])
    manifest_path = model_path / "manifest.json"
    if not manifest_path.exists():
        return {"valid": False, "error": "manifest.json missing"}, 200
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as e:
        return {"valid": False, "error": f"manifest.json invalid: {e}"}, 200
    # basic: if runtime ultralytics, ensure at least one weights file exists
    if (manifest.get("runtime") or row["runtime"]) == "ultralytics":
        weights_dir = model_path / "weights"
        if not weights_dir.exists():
            return {"valid": False, "error": "weights/ folder missing"}, 200
        weights = list(weights_dir.glob("*.pt")) + list(weights_dir.glob("*.onnx"))
        if not weights:
            return {"valid": False, "error": "no weights found in weights/"}, 200
    return {"valid": True}


@models_blueprint.route("/models/local-files/upload", methods=["POST"])
def upload_local_model_file():
    if "file" not in request.files:
        return {"error": "Missing multipart field 'file'"}, 400

    files = request.files.getlist("file")
    files = [f for f in files if f and getattr(f, "filename", "")]
    if not files:
        return {"error": "Empty file list"}, 400

    target_root = _first_manage_root()
    saved = []
    errors = []
    for uploaded in files:
        original_name = secure_filename(uploaded.filename)
        if not original_name:
            errors.append({"name": uploaded.filename, "error": "Invalid filename"})
            continue

        suffix = Path(original_name).suffix.lower()
        if suffix not in LOCAL_MODEL_FILE_EXTENSIONS:
            errors.append(
                {
                    "name": original_name,
                    "error": (
                        "Unsupported extension. "
                        f"Allowed: {', '.join(sorted(LOCAL_MODEL_FILE_EXTENSIONS))}"
                    ),
                }
            )
            continue

        stem = Path(original_name).stem or "model"
        candidate = target_root / f"{stem}{suffix}"
        while candidate.exists():
            candidate = target_root / f"{stem}-{uuid.uuid4().hex[:6]}{suffix}"

        uploaded.save(str(candidate))
        saved.append(_model_file_payload(candidate, search_root=target_root))

    status_code = 200 if saved else 400
    return (
        jsonify(
            {
                "saved_count": len(saved),
                "files": saved,
                "errors": errors,
            }
        ),
        status_code,
    )


@models_blueprint.route("/models/local-files/rename", methods=["PATCH"])
def rename_local_model_file():
    body = request.json or {}
    raw_path = str(body.get("path") or "").strip()
    new_name = secure_filename(str(body.get("new_name") or "").strip())
    if not raw_path:
        return {"error": "Missing 'path'"}, 400
    if not new_name:
        return {"error": "Missing or invalid 'new_name'"}, 400

    try:
        src = _resolve_model_file_path(raw_path)
        _ensure_supported_model_file(src)
    except FileNotFoundError:
        return {"error": "Model file not found"}, 404
    except ValueError as e:
        return {"error": str(e)}, 400

    suffix = Path(new_name).suffix.lower()
    if not suffix:
        new_name = f"{new_name}{src.suffix.lower()}"
        suffix = Path(new_name).suffix.lower()
    if suffix not in LOCAL_MODEL_FILE_EXTENSIONS:
        return {
            "error": (
                "Invalid target file extension. "
                f"Allowed: {', '.join(sorted(LOCAL_MODEL_FILE_EXTENSIONS))}"
            )
        }, 400

    dest = src.with_name(new_name)
    # no-op rename support (same target path)
    if src.resolve() == dest.resolve():
        return jsonify({"file": _model_file_payload(src, search_root=src.parent)})
    if dest.exists():
        return {"error": "Target filename already exists"}, 409

    src.rename(dest)
    return jsonify({"file": _model_file_payload(dest, search_root=dest.parent)})


@models_blueprint.route("/models/local-files/delete", methods=["DELETE"])
def delete_local_model_file():
    body = request.json or {}
    raw_path = str(body.get("path") or "").strip()
    if not raw_path:
        return {"error": "Missing 'path'"}, 400

    try:
        target = _resolve_model_file_path(raw_path)
        _ensure_supported_model_file(target)
    except FileNotFoundError:
        return {"error": "Model file not found"}, 404
    except ValueError as e:
        return {"error": str(e)}, 400

    target.unlink()
    return jsonify({"deleted": True, "path": to_runtime_path(target)})
