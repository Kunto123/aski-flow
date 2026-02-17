import time
import uuid
from pathlib import Path
from flask import Blueprint, request, jsonify

from app.storage.db import connect, get_data_root

training_blueprint = Blueprint("training_blueprint", __name__)

@training_blueprint.route("/train/jobs", methods=["GET"])
def list_jobs():
    with connect() as conn:
        rows = conn.execute("SELECT * FROM training_jobs ORDER BY created_at DESC").fetchall()
    return jsonify([dict(r) for r in rows])

@training_blueprint.route("/train/jobs", methods=["POST"])
def create_job():
    # Week 10 skeleton: register a training job (actual runner can be added later).
    body = request.json or {}
    job_id = f"job-{uuid.uuid4().hex[:10]}"
    dataset_id = body.get("dataset_id") or ""
    base_model = body.get("base_model") or "yolov8n.pt"
    log_root = get_data_root() / "runs" / "training"
    log_root.mkdir(parents=True, exist_ok=True)
    log_path = log_root / f"{job_id}.log"
    log_path.write_text("Training runner not yet enabled in this build.\n", encoding="utf-8")
    with connect() as conn:
        conn.execute(
            "INSERT INTO training_jobs(id,dataset_id,base_model,status,log_path,output_model_id,created_at) VALUES(?,?,?,?,?,?,?)",
            (job_id, dataset_id, base_model, "created", str(log_path), None, time.time()),
        )
        conn.commit()
    return {"id": job_id, "status": "created", "log_path": str(log_path)}
