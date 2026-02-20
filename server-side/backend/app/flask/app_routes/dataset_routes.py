import json
import time
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request

from app.storage.db import connect, get_data_root

datasets_blueprint = Blueprint("datasets_blueprint", __name__)

def _datasets_root() -> Path:
    root = get_data_root() / "datasets"
    root.mkdir(parents=True, exist_ok=True)
    return root

@datasets_blueprint.route("/datasets", methods=["GET"])
def list_datasets():
    with connect() as conn:
        rows = conn.execute("SELECT * FROM datasets ORDER BY created_at DESC").fetchall()
    return jsonify([dict(r) for r in rows])

@datasets_blueprint.route("/datasets", methods=["POST"])
def create_dataset():
    body = request.json or {}
    name = body.get("name") or "dataset"
    classes = body.get("classes") or []
    dataset_id = body.get("id") or f"ds-{uuid.uuid4().hex[:10]}"
    path = _datasets_root() / dataset_id
    (path / "images").mkdir(parents=True, exist_ok=True)
    (path / "labels").mkdir(parents=True, exist_ok=True)
    (path / "videos").mkdir(parents=True, exist_ok=True)
    (path / "splits").mkdir(parents=True, exist_ok=True)
    (path / "exports").mkdir(parents=True, exist_ok=True)

    with connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO datasets(id,name,path,classes_json,created_at) VALUES(?,?,?,?,?)",
            (dataset_id, name, str(path), json.dumps(classes), time.time()),
        )
        conn.commit()
    return {"id": dataset_id, "name": name, "path": str(path), "classes": classes}

@datasets_blueprint.route("/datasets/<dataset_id>", methods=["GET"])
def get_dataset(dataset_id: str):
    with connect() as conn:
        row = conn.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone()
    if not row:
        return {"error": "Dataset not found"}, 404
    d=dict(row)
    d["classes"]=json.loads(d.get("classes_json") or "[]")
    return jsonify(d)
