import io
import json
import time
import uuid
import zipfile
from pathlib import Path

from flask import Blueprint, jsonify, request

from app.storage.db import connect, get_data_root

models_blueprint = Blueprint("models_blueprint", __name__)

def _models_root() -> Path:
    root = get_data_root() / "models"
    root.mkdir(parents=True, exist_ok=True)
    return root

@models_blueprint.route("/models", methods=["GET"])
def list_models():
    with connect() as conn:
        rows = conn.execute("SELECT * FROM models ORDER BY created_at DESC").fetchall()
    return jsonify([dict(r) for r in rows])

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

