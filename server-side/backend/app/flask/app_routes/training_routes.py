import json
import os
import random
import re
import shutil
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request

from app.storage.db import connect, get_data_root
from app.utils.local_model_files import to_runtime_path

training_blueprint = Blueprint("training_blueprint", __name__)

_IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".gif",
    ".webp",
    ".tif",
    ".tiff",
}

_ARCHITECTURE_OPTIONS: Dict[str, Dict[str, Any]] = {
    "yolov5m": {
        "family": "yolov5",
        "label": "YOLOv5 m",
        "candidates": [
            Path("models/architectures/yolov5m.pt"),
            Path("models/yolov5m.pt"),
            Path("data/models/yolov5m.pt"),
            Path("data/models/yolo/yolov5m.pt"),
        ],
    },
    "yolov5mu": {
        "family": "yolov5",
        "label": "YOLOv5 mu",
        "candidates": [
            Path("models/architectures/yolov5mu.pt"),
            Path("models/yolov5mu.pt"),
            Path("data/models/yolov5mu.pt"),
            Path("data/models/yolo/yolov5mu.pt"),
        ],
    },
}

_ARCHITECTURE_ALIASES = {
    "m": "yolov5m",
    "yolov5-m": "yolov5m",
    "yolov5m.pt": "yolov5m",
    "mu": "yolov5mu",
    "yolov5-mu": "yolov5mu",
    "yolov5mu.pt": "yolov5mu",
}

_DEFAULT_ARCHITECTURE_VARIANT = "yolov5mu"
_DEFAULT_TRAIN_PATIENCE = 50

_JOB_THREADS: Dict[str, threading.Thread] = {}
_JOB_THREADS_LOCK = threading.Lock()
_JOB_CANCEL_REQUESTED: set[str] = set()
_JOB_CANCEL_LOCK = threading.Lock()


def _get_dataset_row(dataset_id: str):
    with connect() as conn:
        return conn.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone()


def _safe_parse_classes(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    except Exception:
        pass
    return []


def _sanitize_slug(value: str, fallback: str = "run") -> str:
    base = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value or "").strip()).strip("-")
    if not base:
        return fallback
    return base[:64]


def _normalize_architecture_variant(raw_variant: Any, raw_base_model: Any) -> str:
    candidates = [
        str(raw_variant or "").strip().lower(),
        str(raw_base_model or "").strip().lower(),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        mapped = _ARCHITECTURE_ALIASES.get(candidate, candidate)
        if mapped in _ARCHITECTURE_OPTIONS:
            return mapped

        basename = Path(candidate).name
        mapped_basename = _ARCHITECTURE_ALIASES.get(basename, basename)
        if mapped_basename in _ARCHITECTURE_OPTIONS:
            return mapped_basename

    return _DEFAULT_ARCHITECTURE_VARIANT


def _resolve_architecture_model_path(variant: str) -> Optional[Path]:
    spec = _ARCHITECTURE_OPTIONS.get(variant)
    if not spec:
        return None

    for candidate in spec.get("candidates", []):
        resolved = candidate if candidate.is_absolute() else (Path.cwd() / candidate)
        resolved = resolved.resolve()
        if resolved.exists() and resolved.is_file():
            return resolved
    return None


def _parse_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = default
    return max(minimum, min(maximum, parsed))


def _parse_float(value: Any, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except Exception:
        parsed = default
    return max(minimum, min(maximum, parsed))


def _append_job_log(log_path: Path, message: str) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with log_path.open("a", encoding="utf-8") as fp:
        fp.write(f"[{timestamp}] {message}\n")


def _read_job_log_tail(log_path: Path, max_lines: int = 120) -> str:
    if not log_path.exists() or not log_path.is_file():
        return ""
    lines = log_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    if max_lines <= 0:
        return "\n".join(lines)
    return "\n".join(lines[-max_lines:])


def _safe_parse_json(raw: Any, default: Any) -> Any:
    if raw is None:
        return default
    if isinstance(raw, (dict, list)):
        return raw
    try:
        parsed = json.loads(raw)
        return parsed
    except Exception:
        return default


def _update_training_job(job_id: str, **fields: Any) -> None:
    if not fields:
        return

    keys = list(fields.keys())
    assignments = ", ".join(f"{key}=?" for key in keys)
    values = [fields[key] for key in keys]
    values.append(job_id)
    with connect() as conn:
        conn.execute(
            f"UPDATE training_jobs SET {assignments} WHERE id=?",
            tuple(values),
        )
        conn.commit()


def _get_training_job(job_id: str):
    with connect() as conn:
        return conn.execute("SELECT * FROM training_jobs WHERE id=?", (job_id,)).fetchone()


def _request_cancel(job_id: str) -> None:
    with _JOB_CANCEL_LOCK:
        _JOB_CANCEL_REQUESTED.add(job_id)


def _clear_cancel(job_id: str) -> None:
    with _JOB_CANCEL_LOCK:
        _JOB_CANCEL_REQUESTED.discard(job_id)


def _is_cancel_requested(job_id: str) -> bool:
    with _JOB_CANCEL_LOCK:
        return job_id in _JOB_CANCEL_REQUESTED


def _resolve_runtime_or_absolute_path(raw_path: str) -> Path:
    candidate = Path(str(raw_path or "").strip())
    if not str(candidate):
        return Path.cwd()
    if candidate.is_absolute():
        return candidate.resolve()
    return (Path.cwd() / candidate).resolve()


def _dataset_is_under_root(dataset_path: Path) -> bool:
    datasets_root = (get_data_root() / "datasets").resolve()
    resolved = dataset_path.resolve()
    return resolved != datasets_root and datasets_root in resolved.parents


def _collect_dataset_samples(dataset_path: Path) -> Dict[str, Any]:
    images_path = (dataset_path / "images").resolve()
    labels_path = (dataset_path / "labels").resolve()
    if not images_path.exists() or not images_path.is_dir():
        raise ValueError("Dataset folder 'images/' tidak ditemukan.")
    if not labels_path.exists() or not labels_path.is_dir():
        raise ValueError("Dataset folder 'labels/' tidak ditemukan.")

    pairs: List[Dict[str, Any]] = []
    class_ids: set[int] = set()
    valid_box_count = 0

    image_files = [
        item
        for item in sorted(images_path.iterdir(), key=lambda x: x.name.lower())
        if item.is_file() and item.suffix.lower() in _IMAGE_EXTENSIONS
    ]
    for image_file in image_files:
        label_file = labels_path / f"{image_file.stem}.txt"
        if not label_file.exists() or not label_file.is_file():
            continue

        has_valid_row = False
        lines = label_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        for line in lines:
            parts = [part for part in line.strip().split() if part]
            if len(parts) < 5:
                continue
            try:
                class_id = int(float(parts[0]))
                float(parts[1])
                float(parts[2])
                float(parts[3])
                float(parts[4])
            except Exception:
                continue
            if class_id < 0:
                continue
            class_ids.add(class_id)
            valid_box_count += 1
            has_valid_row = True

        pairs.append(
            {
                "image_path": image_file,
                "label_path": label_file,
                "has_valid_row": has_valid_row,
            }
        )

    if len(pairs) < 2:
        raise ValueError(
            "Dataset butuh minimal 2 pasangan image+label untuk training "
            "(format YOLO: images/<name> + labels/<name>.txt)."
        )
    if valid_box_count <= 0:
        raise ValueError(
            "Label terdeteksi, tapi belum ada bounding box valid untuk training."
        )

    return {
        "pairs": pairs,
        "class_ids": sorted(class_ids),
        "valid_box_count": valid_box_count,
        "total_pairs": len(pairs),
    }


def _split_samples(
    pairs: List[Dict[str, Any]], val_split: float, seed: int
) -> Dict[str, List[Dict[str, Any]]]:
    shuffled = list(pairs)
    rng = random.Random(seed)
    rng.shuffle(shuffled)

    total = len(shuffled)
    val_count = max(1, int(round(total * val_split)))
    if val_count >= total:
        val_count = total - 1
    train_count = total - val_count
    if train_count <= 0:
        raise ValueError("Split training tidak valid (train set kosong).")

    val_pairs = shuffled[:val_count]
    train_pairs = shuffled[val_count:]
    return {
        "train": train_pairs,
        "val": val_pairs,
    }


def _write_training_dataset_files(
    job_root: Path,
    dataset_path: Path,
    class_names: List[str],
    split_pairs: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Path]:
    split_dir = (job_root / "splits").resolve()
    split_dir.mkdir(parents=True, exist_ok=True)

    train_txt = (split_dir / "train.txt").resolve()
    val_txt = (split_dir / "val.txt").resolve()

    train_images = [str(item["image_path"].resolve()).replace("\\", "/") for item in split_pairs["train"]]
    val_images = [str(item["image_path"].resolve()).replace("\\", "/") for item in split_pairs["val"]]

    train_txt.write_text("\n".join(train_images) + "\n", encoding="utf-8")
    val_txt.write_text("\n".join(val_images) + "\n", encoding="utf-8")

    data_yaml = (job_root / "data.yaml").resolve()
    dataset_path_str = str(dataset_path.resolve()).replace("\\", "/")
    train_txt_str = str(train_txt).replace("\\", "/")
    val_txt_str = str(val_txt).replace("\\", "/")
    yaml_lines = [
        f"path: {json.dumps(dataset_path_str)}",
        f"train: {json.dumps(train_txt_str)}",
        f"val: {json.dumps(val_txt_str)}",
        f"nc: {len(class_names)}",
        f"names: {json.dumps(class_names, ensure_ascii=False)}",
    ]
    data_yaml.write_text("\n".join(yaml_lines) + "\n", encoding="utf-8")

    return {
        "split_dir": split_dir,
        "train_txt": train_txt,
        "val_txt": val_txt,
        "data_yaml": data_yaml,
    }


def _resolve_training_save_dir(train_result: Any, fallback_root: Path) -> Path:
    save_dir = getattr(train_result, "save_dir", None)
    if save_dir:
        try:
            path = Path(str(save_dir)).resolve()
            if path.exists():
                return path
        except Exception:
            pass

    trainer = getattr(train_result, "trainer", None)
    if trainer is not None:
        trainer_save_dir = getattr(trainer, "save_dir", None)
        if trainer_save_dir:
            try:
                path = Path(str(trainer_save_dir)).resolve()
                if path.exists():
                    return path
            except Exception:
                pass

    candidates = [item for item in fallback_root.rglob("*") if item.is_dir()]
    candidates.sort(key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)
    return candidates[0] if candidates else fallback_root


def _job_payload(row: Dict[str, Any], include_log_tail: bool = False, tail_lines: int = 80) -> Dict[str, Any]:
    payload = dict(row)
    payload["params"] = _safe_parse_json(payload.get("params_json"), {})
    payload["is_active"] = payload.get("status") in {"queued", "running", "canceling"}

    log_path = Path(str(payload.get("log_path") or "")).resolve()
    payload["log_exists"] = log_path.exists() and log_path.is_file()
    if include_log_tail and payload["log_exists"]:
        payload["log_tail"] = _read_job_log_tail(log_path, max_lines=tail_lines)
    return payload


def _run_training_job_async(job_id: str) -> None:
    row = _get_training_job(job_id)
    if row is None:
        return

    row_dict = dict(row)
    log_path = Path(str(row_dict["log_path"])).resolve()
    params = _safe_parse_json(row_dict.get("params_json"), {})
    dataset_id = str(row_dict.get("dataset_id") or "")
    architecture_variant = str(row_dict.get("architecture_variant") or _DEFAULT_ARCHITECTURE_VARIANT)
    initial_status = str(row_dict.get("status") or "")

    if initial_status == "canceled" or _is_cancel_requested(job_id):
        _append_job_log(log_path, f"Job skipped: canceled before start. id={job_id}")
        _update_training_job(
            job_id,
            status="canceled",
            started_at=row_dict.get("started_at") or time.time(),
            finished_at=time.time(),
            error_message="Canceled by user",
        )
        _clear_cancel(job_id)
        with _JOB_THREADS_LOCK:
            _JOB_THREADS.pop(job_id, None)
        return

    _update_training_job(
        job_id,
        status="running",
        started_at=time.time(),
        finished_at=None,
        error_message=None,
    )
    _append_job_log(log_path, f"Job started. id={job_id}")
    _append_job_log(log_path, f"Dataset: {dataset_id}")
    _append_job_log(log_path, f"Architecture variant: {architecture_variant}")

    try:
        if _is_cancel_requested(job_id):
            _append_job_log(log_path, "Cancellation detected before dataset preparation.")
            _update_training_job(
                job_id,
                status="canceled",
                finished_at=time.time(),
                error_message="Canceled by user",
            )
            return

        dataset_row = _get_dataset_row(dataset_id)
        if not dataset_row:
            raise ValueError("Dataset tidak ditemukan.")

        dataset_payload = dict(dataset_row)
        dataset_path = Path(str(dataset_payload.get("path") or "")).resolve()
        if not dataset_path.exists() or not dataset_path.is_dir():
            raise ValueError("Path dataset tidak ditemukan.")
        if not _dataset_is_under_root(dataset_path):
            raise ValueError("Dataset path tidak valid (di luar datasets root).")

        samples = _collect_dataset_samples(dataset_path)
        pairs = samples["pairs"]
        class_ids = samples["class_ids"]

        class_names = _safe_parse_classes(dataset_payload.get("classes_json"))
        if not class_names:
            if not class_ids:
                raise ValueError("Dataset belum memiliki class untuk training.")
            class_count = max(class_ids) + 1
            class_names = [f"class_{idx}" for idx in range(class_count)]
        if class_ids and max(class_ids) >= len(class_names):
            raise ValueError(
                "Label class_id melebihi jumlah classes dataset. "
                "Perbaiki classes di Annotate tab dulu."
            )

        val_split = _parse_float(params.get("val_split"), 0.2, 0.05, 0.5)
        seed = _parse_int(params.get("seed"), 42, 0, 1_000_000)
        split_pairs = _split_samples(pairs, val_split=val_split, seed=seed)

        job_root = (get_data_root() / "runs" / "training" / job_id).resolve()
        job_root.mkdir(parents=True, exist_ok=True)
        split_files = _write_training_dataset_files(
            job_root=job_root,
            dataset_path=dataset_path,
            class_names=class_names,
            split_pairs=split_pairs,
        )
        _append_job_log(
            log_path,
            (
                "Prepared dataset split: "
                f"train={len(split_pairs['train'])}, "
                f"val={len(split_pairs['val'])}, "
                f"boxes={samples['valid_box_count']}"
            ),
        )
        if _is_cancel_requested(job_id):
            _append_job_log(log_path, "Cancellation detected before model loading.")
            _update_training_job(
                job_id,
                status="canceled",
                finished_at=time.time(),
                error_message="Canceled by user",
            )
            return

        base_model_runtime_path = str(row_dict.get("base_model") or "").strip()
        if not base_model_runtime_path:
            raise ValueError("Base model path kosong.")

        base_model_path = Path(base_model_runtime_path)
        if not base_model_path.is_absolute():
            base_model_path = (Path.cwd() / base_model_path).resolve()
        else:
            base_model_path = base_model_path.resolve()
        if not base_model_path.exists() or not base_model_path.is_file():
            raise FileNotFoundError(f"Base model tidak ditemukan: {base_model_path}")

        _append_job_log(log_path, f"Loading model: {to_runtime_path(base_model_path)}")

        from ultralytics import YOLO

        model = YOLO(str(base_model_path))
        if _is_cancel_requested(job_id):
            _append_job_log(log_path, "Cancellation detected after model load, before training.")
            _update_training_job(
                job_id,
                status="canceled",
                finished_at=time.time(),
                error_message="Canceled by user",
            )
            return

        train_kwargs: Dict[str, Any] = {
            "data": str(split_files["data_yaml"]),
            "epochs": _parse_int(params.get("epochs"), 50, 1, 1000),
            "imgsz": _parse_int(params.get("imgsz"), 640, 64, 2048),
            "batch": _parse_int(params.get("batch"), 16, 1, 512),
            "patience": _parse_int(
                params.get("patience"),
                _DEFAULT_TRAIN_PATIENCE,
                0,
                1000,
            ),
            "project": str(job_root),
            "name": "ultralytics",
            "exist_ok": True,
            "verbose": True,
            "workers": 0 if os.name == "nt" else min(8, max(1, (os.cpu_count() or 2) - 1)),
        }

        device = str(params.get("device") or "").strip()
        if device:
            train_kwargs["device"] = device

        _append_job_log(
            log_path,
            "Training config: "
            + json.dumps(
                {
                    "epochs": train_kwargs["epochs"],
                    "imgsz": train_kwargs["imgsz"],
                    "batch": train_kwargs["batch"],
                    "patience": train_kwargs["patience"],
                    "device": train_kwargs.get("device", "default"),
                    "base_model": to_runtime_path(base_model_path),
                },
                ensure_ascii=False,
            ),
        )

        cancel_logged = False

        def _request_stop(trainer):
            nonlocal cancel_logged
            if _is_cancel_requested(job_id):
                trainer.stop = True
                if not cancel_logged:
                    _append_job_log(log_path, "Cancellation requested. Stopping training at safe checkpoint.")
                    cancel_logged = True

        try:
            model.add_callback("on_train_epoch_end", _request_stop)
            model.add_callback("on_fit_epoch_end", _request_stop)
        except Exception:
            # Continue training even if callback injection is not available.
            pass

        train_result = model.train(**train_kwargs)
        if _is_cancel_requested(job_id):
            _append_job_log(log_path, "Training canceled by user before artifact promotion.")
            _update_training_job(
                job_id,
                status="canceled",
                finished_at=time.time(),
                error_message="Canceled by user",
                output_model_id=None,
                trained_model_path=None,
            )
            return

        save_dir = _resolve_training_save_dir(train_result, job_root)
        best_path = (save_dir / "weights" / "best.pt").resolve()
        last_path = (save_dir / "weights" / "last.pt").resolve()
        source_weights = best_path if best_path.exists() else last_path if last_path.exists() else None
        if source_weights is None:
            raise FileNotFoundError(
                f"Training selesai, tapi weights tidak ditemukan di {save_dir / 'weights'}"
            )

        trained_models_root = (Path.cwd() / "models" / "trained").resolve()
        trained_models_root.mkdir(parents=True, exist_ok=True)

        timestamp = time.strftime("%Y%m%d-%H%M%S")
        trained_name = (
            f"{_sanitize_slug(dataset_id, 'dataset')}__{architecture_variant}__{timestamp}.pt"
        )
        trained_path = (trained_models_root / trained_name).resolve()
        shutil.copy2(source_weights, trained_path)

        trained_runtime_path = to_runtime_path(trained_path)
        metadata_path = trained_path.with_suffix(".meta.json")
        metadata_path.write_text(
            json.dumps(
                {
                    "job_id": job_id,
                    "dataset_id": dataset_id,
                    "architecture_family": "yolov5",
                    "architecture_variant": architecture_variant,
                    "base_model": to_runtime_path(base_model_path),
                    "trained_model_path": trained_runtime_path,
                    "source_weights": to_runtime_path(source_weights),
                    "training_save_dir": str(save_dir),
                    "params": params,
                    "class_names": class_names,
                    "created_at": time.time(),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        _update_training_job(
            job_id,
            status="completed",
            output_model_id=trained_runtime_path,
            trained_model_path=trained_runtime_path,
            finished_at=time.time(),
            error_message=None,
        )
        _append_job_log(log_path, f"Training completed. model={trained_runtime_path}")
    except Exception as exc:
        error_summary = f"{type(exc).__name__}: {exc}"
        if _is_cancel_requested(job_id):
            _append_job_log(log_path, f"Training canceled. {error_summary}")
            _append_job_log(log_path, traceback.format_exc())
            _update_training_job(
                job_id,
                status="canceled",
                finished_at=time.time(),
                error_message="Canceled by user",
                output_model_id=None,
                trained_model_path=None,
            )
        else:
            _append_job_log(log_path, f"Training failed. {error_summary}")
            _append_job_log(log_path, traceback.format_exc())
            _update_training_job(
                job_id,
                status="failed",
                finished_at=time.time(),
                error_message=error_summary,
            )
    finally:
        _clear_cancel(job_id)
        with _JOB_THREADS_LOCK:
            _JOB_THREADS.pop(job_id, None)


def _start_training_job(job_id: str) -> None:
    thread = threading.Thread(
        target=_run_training_job_async,
        args=(job_id,),
        daemon=True,
        name=f"aski-train-{job_id}",
    )
    with _JOB_THREADS_LOCK:
        _JOB_THREADS[job_id] = thread
    thread.start()


@training_blueprint.route("/train/architectures", methods=["GET"])
def list_training_architectures():
    items = []
    for variant, spec in _ARCHITECTURE_OPTIONS.items():
        resolved = _resolve_architecture_model_path(variant)
        first_candidate = spec["candidates"][0]
        runtime_model = to_runtime_path(resolved) if resolved else first_candidate.as_posix()
        items.append(
            {
                "id": variant,
                "family": spec["family"],
                "label": spec["label"],
                "available": resolved is not None,
                "base_model_path": runtime_model,
            }
        )

    return jsonify(
        {
            "family": "yolov5",
            "default_variant": _DEFAULT_ARCHITECTURE_VARIANT,
            "default_train_params": {
                "epochs": 50,
                "imgsz": 640,
                "batch": 16,
                "patience": _DEFAULT_TRAIN_PATIENCE,
            },
            "items": items,
        }
    )


@training_blueprint.route("/train/jobs", methods=["GET"])
def list_jobs():
    try:
        limit = _parse_int(request.args.get("limit"), 50, 1, 200)
    except Exception:
        limit = 50
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM training_jobs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return jsonify([_job_payload(dict(row)) for row in rows])


@training_blueprint.route("/train/jobs/<job_id>", methods=["GET"])
def get_job(job_id: str):
    row = _get_training_job(job_id)
    if row is None:
        return {"error": "Training job not found"}, 404

    tail_lines = _parse_int(request.args.get("tail"), 80, 0, 2000)
    include_log = str(request.args.get("include_log") or "").strip().lower() in {
        "1",
        "true",
        "yes",
    }
    return jsonify(_job_payload(dict(row), include_log_tail=include_log, tail_lines=tail_lines))


@training_blueprint.route("/train/jobs/<job_id>/log", methods=["GET"])
def get_job_log(job_id: str):
    row = _get_training_job(job_id)
    if row is None:
        return {"error": "Training job not found"}, 404

    log_path = Path(str(row["log_path"])).resolve()
    tail_lines = _parse_int(request.args.get("tail"), 120, 0, 3000)
    return jsonify(
        {
            "id": job_id,
            "log_path": str(log_path),
            "tail": _read_job_log_tail(log_path, max_lines=tail_lines),
        }
    )


@training_blueprint.route("/train/jobs/<job_id>/cancel", methods=["POST"])
def cancel_job(job_id: str):
    row = _get_training_job(job_id)
    if row is None:
        return {"error": "Training job not found"}, 404

    payload = dict(row)
    status = str(payload.get("status") or "")
    log_path = Path(str(payload.get("log_path") or "")).resolve()

    if status in {"completed", "failed", "canceled"}:
        return (
            {
                "error": f"Job sudah selesai dengan status '{status}' dan tidak bisa di-cancel.",
                "status": status,
            },
            409,
        )

    if status == "queued":
        _request_cancel(job_id)
        _update_training_job(
            job_id,
            status="canceled",
            finished_at=time.time(),
            error_message="Canceled by user",
        )
        _append_job_log(log_path, "Job canceled while still queued.")
        updated = _get_training_job(job_id)
        if updated is None:
            return {"id": job_id, "status": "canceled"}
        return jsonify(_job_payload(dict(updated), include_log_tail=True, tail_lines=40))

    _request_cancel(job_id)
    _update_training_job(
        job_id,
        status="canceling",
        error_message="Cancellation requested by user",
    )
    _append_job_log(log_path, "Cancellation requested by user.")
    updated = _get_training_job(job_id)
    if updated is None:
        return {"id": job_id, "status": "canceling"}
    return jsonify(_job_payload(dict(updated), include_log_tail=True, tail_lines=40))


@training_blueprint.route("/train/jobs/<job_id>", methods=["DELETE"])
def delete_job(job_id: str):
    row = _get_training_job(job_id)
    if row is None:
        return {"error": "Training job not found"}, 404

    payload = dict(row)
    status = str(payload.get("status") or "")
    if status in {"queued", "running"}:
        return (
            {
                "error": (
                    "Job masih aktif. Cancel job dulu, lalu delete setelah status menjadi "
                    "'canceling', 'canceled', 'failed', atau 'completed'."
                ),
                "status": status,
            },
            409,
        )

    if status == "canceling":
        _request_cancel(job_id)

    body = request.json if request.is_json else {}
    raw_delete_model = request.args.get("delete_model")
    if raw_delete_model is None and isinstance(body, dict):
        raw_delete_model = body.get("delete_model")
    delete_model = str(raw_delete_model or "").strip().lower() in {"1", "true", "yes"}

    trained_model_deleted = False
    trained_model_path = str(payload.get("trained_model_path") or "").strip()
    if delete_model and trained_model_path:
        resolved_model_path = _resolve_runtime_or_absolute_path(trained_model_path)
        models_root = (Path.cwd() / "models").resolve()
        if (
            resolved_model_path.exists()
            and resolved_model_path.is_file()
            and (resolved_model_path == models_root or models_root in resolved_model_path.parents)
        ):
            resolved_model_path.unlink()
            trained_model_deleted = True
            meta_path = resolved_model_path.with_suffix(".meta.json")
            if meta_path.exists() and meta_path.is_file():
                meta_path.unlink()

    run_artifacts_deleted = False
    log_path = Path(str(payload.get("log_path") or "")).resolve()
    run_dir = log_path.parent.resolve()
    runs_root = (get_data_root() / "runs" / "training").resolve()
    if run_dir.exists() and run_dir.is_dir() and (run_dir == runs_root or runs_root in run_dir.parents):
        shutil.rmtree(run_dir, ignore_errors=True)
        run_artifacts_deleted = True

    with connect() as conn:
        conn.execute("DELETE FROM training_jobs WHERE id=?", (job_id,))
        conn.commit()

    _clear_cancel(job_id)
    with _JOB_THREADS_LOCK:
        _JOB_THREADS.pop(job_id, None)

    return jsonify(
        {
            "id": job_id,
            "deleted": True,
            "status_before_delete": status,
            "delete_model": delete_model,
            "trained_model_deleted": trained_model_deleted,
            "run_artifacts_deleted": run_artifacts_deleted,
        }
    )


@training_blueprint.route("/train/jobs", methods=["POST"])
def create_job():
    body = request.json or {}
    dataset_id = str(body.get("dataset_id") or "").strip()
    if not dataset_id:
        return {"error": "Field 'dataset_id' is required"}, 400

    dataset_row = _get_dataset_row(dataset_id)
    if dataset_row is None:
        return {"error": "Dataset not found"}, 404

    architecture_variant = _normalize_architecture_variant(
        body.get("architecture_variant"),
        body.get("base_model"),
    )
    architecture_spec = _ARCHITECTURE_OPTIONS.get(architecture_variant)
    if not architecture_spec:
        return {"error": "Unsupported architecture variant"}, 400

    base_model_path = _resolve_architecture_model_path(architecture_variant)
    if base_model_path is None:
        return (
            {
                "error": (
                    f"Base model untuk '{architecture_variant}' belum tersedia secara lokal. "
                    "Siapkan file weights dulu di folder models."
                ),
                "architecture_variant": architecture_variant,
            },
            400,
        )

    epochs = _parse_int(body.get("epochs"), 50, 1, 1000)
    imgsz = _parse_int(body.get("imgsz"), 640, 64, 2048)
    batch = _parse_int(body.get("batch"), 16, 1, 512)
    patience = _parse_int(
        body.get("patience"),
        _DEFAULT_TRAIN_PATIENCE,
        0,
        1000,
    )
    val_split = _parse_float(body.get("val_split"), 0.2, 0.05, 0.5)
    seed = _parse_int(body.get("seed"), 42, 0, 1_000_000)
    device = str(body.get("device") or "").strip()

    run_name = _sanitize_slug(
        str(body.get("run_name") or f"{dataset_id}-{architecture_variant}"),
        fallback=f"{dataset_id}-{architecture_variant}",
    )

    job_id = f"job-{uuid.uuid4().hex[:10]}"
    run_root = (get_data_root() / "runs" / "training" / job_id).resolve()
    run_root.mkdir(parents=True, exist_ok=True)
    log_path = (run_root / "train.log").resolve()

    params_payload = {
        "run_name": run_name,
        "architecture_family": architecture_spec["family"],
        "architecture_variant": architecture_variant,
        "epochs": epochs,
        "imgsz": imgsz,
        "batch": batch,
        "patience": patience,
        "val_split": val_split,
        "seed": seed,
        "device": device,
    }

    _append_job_log(
        log_path,
        (
            "Queued training job: "
            f"dataset={dataset_id}, variant={architecture_variant}, "
            f"base_model={to_runtime_path(base_model_path)}"
        ),
    )

    created_at = time.time()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO training_jobs(
                id,
                dataset_id,
                base_model,
                status,
                log_path,
                output_model_id,
                architecture_family,
                architecture_variant,
                trained_model_path,
                params_json,
                started_at,
                finished_at,
                error_message,
                created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                job_id,
                dataset_id,
                to_runtime_path(base_model_path),
                "queued",
                str(log_path),
                None,
                architecture_spec["family"],
                architecture_variant,
                None,
                json.dumps(params_payload, ensure_ascii=False),
                None,
                None,
                None,
                created_at,
            ),
        )
        conn.commit()

    _start_training_job(job_id)

    created_row = _get_training_job(job_id)
    if created_row is None:
        return {"id": job_id, "status": "queued"}, 201
    return jsonify(_job_payload(dict(created_row), include_log_tail=True, tail_lines=40)), 201
