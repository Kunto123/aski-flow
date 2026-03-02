import json
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from app.storage.db import connect, get_data_root
from app.utils.runtime_url import resolve_public_base_url

datasets_blueprint = Blueprint("datasets_blueprint", __name__)

_DATASET_SUBDIRS = ("images", "labels", "videos", "splits", "exports")
_DEFAULT_UPLOAD_TARGET = "images"


def _datasets_root() -> Path:
    root = get_data_root() / "datasets"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _sanitize_folder_name(raw_name: str) -> str:
    raw = str(raw_name or "").strip().lower()
    if not raw:
        return "dataset"
    normalized = re.sub(r"\s+", "-", raw)
    normalized = re.sub(r"[^a-z0-9\-_]+", "-", normalized)
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-_")
    return normalized or "dataset"


def _resolve_unique_folder_name(base_name: str) -> str:
    root = _datasets_root()
    base = _sanitize_folder_name(base_name)
    candidate = base
    suffix = 1
    while (root / candidate).exists():
        suffix += 1
        candidate = f"{base}-{suffix}"
    return candidate


def _ensure_dataset_dirs(path: Path) -> None:
    for subdir in _DATASET_SUBDIRS:
        (path / subdir).mkdir(parents=True, exist_ok=True)


def _safe_parse_classes(raw: Any) -> List[Any]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return parsed
    except Exception:
        pass
    return []


def _count_files(path: Path) -> int:
    if not path.exists() or not path.is_dir():
        return 0
    try:
        return sum(1 for p in path.iterdir() if p.is_file())
    except Exception:
        return 0


def _dataset_file_url(dataset_id: str, relative_path: str) -> str:
    base_url = resolve_public_base_url().rstrip("/")
    rel = str(relative_path).replace("\\", "/").lstrip("/")
    return f"{base_url}/datasets/{dataset_id}/files/{rel}"


def _row_to_dataset_payload(row: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(row)
    raw_path = Path(str(payload.get("path") or ""))
    payload["classes"] = _safe_parse_classes(payload.get("classes_json"))
    payload["folder_name"] = raw_path.name if str(raw_path) else ""
    payload["stats"] = {
        "images": _count_files(raw_path / "images"),
        "labels": _count_files(raw_path / "labels"),
        "videos": _count_files(raw_path / "videos"),
    }
    return payload


def _get_dataset_row(dataset_id: str):
    with connect() as conn:
        return conn.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone()


def _resolve_upload_target(raw_target: Optional[str]) -> str:
    target = str(raw_target or _DEFAULT_UPLOAD_TARGET).strip().lower()
    if target not in _DATASET_SUBDIRS:
        return _DEFAULT_UPLOAD_TARGET
    return target


@datasets_blueprint.route("/datasets", methods=["GET"])
def list_datasets():
    with connect() as conn:
        rows = conn.execute("SELECT * FROM datasets ORDER BY created_at DESC").fetchall()
    return jsonify([_row_to_dataset_payload(dict(r)) for r in rows])


@datasets_blueprint.route("/datasets", methods=["POST"])
def create_dataset():
    body = request.json or {}
    name = str(body.get("name") or "dataset").strip() or "dataset"
    classes = body.get("classes") or []
    if not isinstance(classes, list):
        classes = []
    dataset_id = str(body.get("id") or f"ds-{uuid.uuid4().hex[:10]}").strip()
    requested_folder = str(body.get("folder_name") or name).strip()

    existing_row = _get_dataset_row(dataset_id)
    if existing_row:
        path = Path(str(existing_row["path"]))
        folder_name = path.name
    else:
        folder_name = _resolve_unique_folder_name(requested_folder)
        path = _datasets_root() / folder_name

    _ensure_dataset_dirs(path)

    with connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO datasets(id,name,path,classes_json,created_at) VALUES(?,?,?,?,?)",
            (dataset_id, name, str(path), json.dumps(classes), time.time()),
        )
        conn.commit()

    row = _get_dataset_row(dataset_id)
    return jsonify(_row_to_dataset_payload(dict(row)))


@datasets_blueprint.route("/datasets/<dataset_id>", methods=["GET"])
def get_dataset(dataset_id: str):
    row = _get_dataset_row(dataset_id)
    if not row:
        return {"error": "Dataset not found"}, 404
    return jsonify(_row_to_dataset_payload(dict(row)))


@datasets_blueprint.route("/datasets/<dataset_id>/files", methods=["GET"])
def list_dataset_files(dataset_id: str):
    row = _get_dataset_row(dataset_id)
    if not row:
        return {"error": "Dataset not found"}, 404

    dataset_path = Path(str(row["path"]))
    target = _resolve_upload_target(request.args.get("target"))
    target_path = dataset_path / target
    target_path.mkdir(parents=True, exist_ok=True)

    files = []
    for p in sorted(target_path.iterdir(), key=lambda x: x.name.lower()):
        if not p.is_file():
            continue
        rel = f"{target}/{p.name}"
        files.append(
            {
                "name": p.name,
                "target": target,
                "size_bytes": p.stat().st_size,
                "url": _dataset_file_url(dataset_id, rel),
            }
        )

    return jsonify(
        {
            "dataset_id": dataset_id,
            "target": target,
            "count": len(files),
            "files": files,
        }
    )


@datasets_blueprint.route("/datasets/<dataset_id>/upload", methods=["POST"])
def upload_dataset_files(dataset_id: str):
    row = _get_dataset_row(dataset_id)
    if not row:
        return {"error": "Dataset not found"}, 404

    if "file" not in request.files:
        return {"error": "Missing multipart field 'file'"}, 400

    files = request.files.getlist("file")
    files = [f for f in files if f and getattr(f, "filename", "")]
    if not files:
        return {"error": "Empty file list"}, 400

    dataset_path = Path(str(row["path"]))
    target = _resolve_upload_target(request.form.get("target"))
    target_path = dataset_path / target
    target_path.mkdir(parents=True, exist_ok=True)

    saved_files = []
    for uploaded in files:
        original_name = secure_filename(uploaded.filename)
        if not original_name:
            continue

        stem = Path(original_name).stem or "file"
        suffix = Path(original_name).suffix
        candidate = f"{stem}{suffix}"
        destination = target_path / candidate
        while destination.exists():
            candidate = f"{stem}-{uuid.uuid4().hex[:6]}{suffix}"
            destination = target_path / candidate

        uploaded.save(str(destination))
        relative_path = f"{target}/{candidate}"
        saved_files.append(
            {
                "name": candidate,
                "original_name": original_name,
                "target": target,
                "size_bytes": destination.stat().st_size,
                "url": _dataset_file_url(dataset_id, relative_path),
            }
        )

    return jsonify(
        {
            "dataset_id": dataset_id,
            "target": target,
            "saved_count": len(saved_files),
            "files": saved_files,
        }
    )


@datasets_blueprint.route("/datasets/<dataset_id>/files/<path:relative_path>", methods=["GET"])
def get_dataset_file(dataset_id: str, relative_path: str):
    row = _get_dataset_row(dataset_id)
    if not row:
        return {"error": "Dataset not found"}, 404

    dataset_path = Path(str(row["path"])).resolve()
    requested = (dataset_path / relative_path).resolve()
    if dataset_path not in requested.parents and requested != dataset_path:
        return {"error": "Invalid file path"}, 400
    if not requested.exists() or not requested.is_file():
        return {"error": "File not found"}, 404

    return send_from_directory(str(dataset_path), relative_path)
