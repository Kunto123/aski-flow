import json
import logging
import os
import random
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from app.storage.db import connect, get_data_root

augmentation_blueprint = Blueprint("augmentation_blueprint", __name__)

_IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff",
}

# ---------------------------------------------------------------------------
# Augmentation job tracking
# ---------------------------------------------------------------------------
_AUG_JOBS: Dict[str, Dict[str, Any]] = {}
_AUG_JOBS_LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# Available augmentation techniques
# ---------------------------------------------------------------------------
AUGMENTATION_TECHNIQUES = [
    {
        "id": "horizontal_flip",
        "label": "Horizontal Flip",
        "description": "Membalik gambar secara horizontal (mirror).",
        "group": "geometric",
    },
    {
        "id": "vertical_flip",
        "label": "Vertical Flip",
        "description": "Membalik gambar secara vertikal.",
        "group": "geometric",
    },
    {
        "id": "rotate_90",
        "label": "Rotate 90°",
        "description": "Rotasi gambar 90 derajat searah jarum jam.",
        "group": "geometric",
    },
    {
        "id": "rotate_180",
        "label": "Rotate 180°",
        "description": "Rotasi gambar 180 derajat.",
        "group": "geometric",
    },
    {
        "id": "rotate_270",
        "label": "Rotate 270°",
        "description": "Rotasi gambar 270 derajat searah jarum jam.",
        "group": "geometric",
    },
    {
        "id": "random_rotate",
        "label": "Random Rotate (±15°)",
        "description": "Rotasi acak antara -15 hingga +15 derajat.",
        "group": "geometric",
    },
    {
        "id": "brightness_up",
        "label": "Brightness Up",
        "description": "Meningkatkan kecerahan gambar (1.2x - 1.5x).",
        "group": "color",
    },
    {
        "id": "brightness_down",
        "label": "Brightness Down",
        "description": "Menurunkan kecerahan gambar (0.5x - 0.8x).",
        "group": "color",
    },
    {
        "id": "contrast_up",
        "label": "Contrast Up",
        "description": "Meningkatkan kontras gambar.",
        "group": "color",
    },
    {
        "id": "contrast_down",
        "label": "Contrast Down",
        "description": "Menurunkan kontras gambar.",
        "group": "color",
    },
    {
        "id": "saturation_up",
        "label": "Saturation Up",
        "description": "Meningkatkan saturasi warna.",
        "group": "color",
    },
    {
        "id": "saturation_down",
        "label": "Saturation Down",
        "description": "Menurunkan saturasi warna.",
        "group": "color",
    },
    {
        "id": "grayscale",
        "label": "Grayscale",
        "description": "Mengubah gambar menjadi hitam-putih.",
        "group": "color",
    },
    {
        "id": "gaussian_blur",
        "label": "Gaussian Blur",
        "description": "Menambahkan efek blur Gaussian.",
        "group": "noise",
    },
    {
        "id": "sharpen",
        "label": "Sharpen",
        "description": "Mempertajam detail gambar.",
        "group": "noise",
    },
    {
        "id": "random_crop",
        "label": "Random Crop (80-95%)",
        "description": "Crop acak 80-95% area gambar lalu resize ke ukuran asli.",
        "group": "geometric",
    },
    {
        "id": "scale_up",
        "label": "Scale Up (110-130%)",
        "description": "Perbesar gambar lalu crop ke ukuran asli.",
        "group": "geometric",
    },
]

VALID_TECHNIQUE_IDS = {t["id"] for t in AUGMENTATION_TECHNIQUES}


# ---------------------------------------------------------------------------
# YOLO label transformers
# ---------------------------------------------------------------------------

def _flip_labels_horizontal(labels: List[str]) -> List[str]:
    """Flip bounding box labels horizontally: x_center = 1 - x_center."""
    result = []
    for line in labels:
        parts = line.strip().split()
        if len(parts) < 5:
            result.append(line)
            continue
        try:
            cls = parts[0]
            x, y, w, h = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            x = 1.0 - x
            result.append(f"{cls} {x:.6f} {y:.6f} {w:.6f} {h:.6f}")
        except Exception:
            result.append(line)
    return result


def _flip_labels_vertical(labels: List[str]) -> List[str]:
    """Flip bounding box labels vertically: y_center = 1 - y_center."""
    result = []
    for line in labels:
        parts = line.strip().split()
        if len(parts) < 5:
            result.append(line)
            continue
        try:
            cls = parts[0]
            x, y, w, h = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            y = 1.0 - y
            result.append(f"{cls} {x:.6f} {y:.6f} {w:.6f} {h:.6f}")
        except Exception:
            result.append(line)
    return result


def _rotate_labels_90(labels: List[str]) -> List[str]:
    """Rotate labels 90° CW: new_x=1-y, new_y=x, swap w/h."""
    result = []
    for line in labels:
        parts = line.strip().split()
        if len(parts) < 5:
            result.append(line)
            continue
        try:
            cls = parts[0]
            x, y, w, h = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            nx, ny, nw, nh = 1.0 - y, x, h, w
            result.append(f"{cls} {nx:.6f} {ny:.6f} {nw:.6f} {nh:.6f}")
        except Exception:
            result.append(line)
    return result


def _rotate_labels_180(labels: List[str]) -> List[str]:
    """Rotate labels 180°: x=1-x, y=1-y."""
    result = []
    for line in labels:
        parts = line.strip().split()
        if len(parts) < 5:
            result.append(line)
            continue
        try:
            cls = parts[0]
            x, y, w, h = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            result.append(f"{cls} {1.0-x:.6f} {1.0-y:.6f} {w:.6f} {h:.6f}")
        except Exception:
            result.append(line)
    return result


def _rotate_labels_270(labels: List[str]) -> List[str]:
    """Rotate labels 270° CW (= 90° CCW): new_x=y, new_y=1-x, swap w/h."""
    result = []
    for line in labels:
        parts = line.strip().split()
        if len(parts) < 5:
            result.append(line)
            continue
        try:
            cls = parts[0]
            x, y, w, h = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            nx, ny, nw, nh = y, 1.0 - x, h, w
            result.append(f"{cls} {nx:.6f} {ny:.6f} {nw:.6f} {nh:.6f}")
        except Exception:
            result.append(line)
    return result


def _crop_labels(labels: List[str], crop_x: float, crop_y: float,
                 crop_w: float, crop_h: float) -> List[str]:
    """Transform labels after a crop. crop_x/y/w/h are normalized to original image."""
    result = []
    for line in labels:
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        try:
            cls = parts[0]
            x, y, w, h = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            # Convert to crop-relative coords
            nx = (x - crop_x) / crop_w
            ny = (y - crop_y) / crop_h
            nw = w / crop_w
            nh = h / crop_h
            # Check if box center is inside crop
            if nx < 0 or nx > 1 or ny < 0 or ny > 1:
                continue
            # Clamp
            half_w, half_h = nw / 2, nh / 2
            x1 = max(0, nx - half_w)
            y1 = max(0, ny - half_h)
            x2 = min(1, nx + half_w)
            y2 = min(1, ny + half_h)
            nw = x2 - x1
            nh = y2 - y1
            nx = (x1 + x2) / 2
            ny = (y1 + y2) / 2
            if nw > 0.01 and nh > 0.01:
                result.append(f"{cls} {nx:.6f} {ny:.6f} {nw:.6f} {nh:.6f}")
        except Exception:
            continue
    return result


# ---------------------------------------------------------------------------
# Image augmentation functions
# ---------------------------------------------------------------------------

def _apply_augmentation(
    img: Image.Image,
    labels: List[str],
    technique: str,
    rng: random.Random,
) -> tuple:
    """Apply a single augmentation technique. Returns (augmented_img, transformed_labels)."""
    new_labels = list(labels)

    if technique == "horizontal_flip":
        img = ImageOps.mirror(img)
        new_labels = _flip_labels_horizontal(new_labels)

    elif technique == "vertical_flip":
        img = ImageOps.flip(img)
        new_labels = _flip_labels_vertical(new_labels)

    elif technique == "rotate_90":
        img = img.rotate(-90, expand=True)
        new_labels = _rotate_labels_90(new_labels)

    elif technique == "rotate_180":
        img = img.rotate(180, expand=False)
        new_labels = _rotate_labels_180(new_labels)

    elif technique == "rotate_270":
        img = img.rotate(-270, expand=True)
        new_labels = _rotate_labels_270(new_labels)

    elif technique == "random_rotate":
        angle = rng.uniform(-15, 15)
        img = img.rotate(angle, expand=False, fillcolor=(128, 128, 128))
        # Labels stay approximately the same for small rotations

    elif technique == "brightness_up":
        factor = rng.uniform(1.2, 1.5)
        img = ImageEnhance.Brightness(img).enhance(factor)

    elif technique == "brightness_down":
        factor = rng.uniform(0.5, 0.8)
        img = ImageEnhance.Brightness(img).enhance(factor)

    elif technique == "contrast_up":
        factor = rng.uniform(1.3, 1.8)
        img = ImageEnhance.Contrast(img).enhance(factor)

    elif technique == "contrast_down":
        factor = rng.uniform(0.5, 0.8)
        img = ImageEnhance.Contrast(img).enhance(factor)

    elif technique == "saturation_up":
        factor = rng.uniform(1.3, 2.0)
        img = ImageEnhance.Color(img).enhance(factor)

    elif technique == "saturation_down":
        factor = rng.uniform(0.3, 0.7)
        img = ImageEnhance.Color(img).enhance(factor)

    elif technique == "grayscale":
        img = ImageOps.grayscale(img).convert("RGB")

    elif technique == "gaussian_blur":
        radius = rng.uniform(1.0, 2.5)
        img = img.filter(ImageFilter.GaussianBlur(radius=radius))

    elif technique == "sharpen":
        img = img.filter(ImageFilter.SHARPEN)

    elif technique == "random_crop":
        w, h = img.size
        crop_ratio = rng.uniform(0.80, 0.95)
        cw = int(w * crop_ratio)
        ch = int(h * crop_ratio)
        left = rng.randint(0, w - cw)
        top = rng.randint(0, h - ch)
        img = img.crop((left, top, left + cw, top + ch)).resize((w, h), Image.LANCZOS)
        # Transform labels
        crop_x_norm = left / w
        crop_y_norm = top / h
        crop_w_norm = cw / w
        crop_h_norm = ch / h
        new_labels = _crop_labels(new_labels, crop_x_norm, crop_y_norm, crop_w_norm, crop_h_norm)

    elif technique == "scale_up":
        w, h = img.size
        scale = rng.uniform(1.1, 1.3)
        new_w, new_h = int(w * scale), int(h * scale)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        # Center crop back to original size
        left = (new_w - w) // 2
        top = (new_h - h) // 2
        img = img.crop((left, top, left + w, top + h))
        # Transform labels
        crop_x_norm = left / new_w
        crop_y_norm = top / new_h
        crop_w_norm = w / new_w
        crop_h_norm = h / new_h
        new_labels = _crop_labels(new_labels, crop_x_norm, crop_y_norm, crop_w_norm, crop_h_norm)

    return img, new_labels


# ---------------------------------------------------------------------------
# Job runner
# ---------------------------------------------------------------------------

def _get_dataset_row(dataset_id: str):
    with connect() as conn:
        return conn.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone()


def _run_augmentation_job(job_id: str, dataset_id: str, techniques: List[str],
                          copies_per_technique: int, seed: int) -> None:
    """Run augmentation in a background thread."""
    rng = random.Random(seed)

    def _update(updates: Dict[str, Any]):
        with _AUG_JOBS_LOCK:
            if job_id in _AUG_JOBS:
                _AUG_JOBS[job_id].update(updates)

    try:
        row = _get_dataset_row(dataset_id)
        if not row:
            _update({"status": "failed", "error": "Dataset not found", "finished_at": time.time()})
            return

        dataset_path = Path(str(row["path"])).resolve()
        images_path = dataset_path / "images"
        labels_path = dataset_path / "labels"

        if not images_path.exists():
            _update({"status": "failed", "error": "Folder images/ tidak ditemukan", "finished_at": time.time()})
            return

        # Collect image files
        image_files = sorted(
            [f for f in images_path.iterdir() if f.is_file() and f.suffix.lower() in _IMAGE_EXTENSIONS],
            key=lambda p: p.name.lower(),
        )
        if not image_files:
            _update({"status": "failed", "error": "Tidak ada gambar di dataset", "finished_at": time.time()})
            return

        total_ops = len(image_files) * len(techniques) * copies_per_technique
        _update({"status": "running", "total": total_ops, "progress": 0, "started_at": time.time()})

        generated = 0
        errors = 0

        for img_file in image_files:
            # Check cancellation
            with _AUG_JOBS_LOCK:
                if _AUG_JOBS.get(job_id, {}).get("status") == "canceling":
                    _update({"status": "canceled", "finished_at": time.time()})
                    return

            # Read label file if exists
            label_file = labels_path / f"{img_file.stem}.txt"
            label_lines: List[str] = []
            if label_file.exists():
                label_lines = label_file.read_text(encoding="utf-8", errors="ignore").strip().splitlines()

            try:
                img = Image.open(img_file).convert("RGB")
            except Exception as e:
                logging.warning("Augment: failed to open %s: %s", img_file.name, e)
                errors += len(techniques) * copies_per_technique
                generated_delta = len(techniques) * copies_per_technique
                _update({"progress": generated + generated_delta, "errors": errors})
                generated += generated_delta
                continue

            for tech in techniques:
                for copy_idx in range(copies_per_technique):
                    # Check cancellation periodically
                    with _AUG_JOBS_LOCK:
                        if _AUG_JOBS.get(job_id, {}).get("status") == "canceling":
                            _update({"status": "canceled", "finished_at": time.time()})
                            return

                    try:
                        aug_img, aug_labels = _apply_augmentation(img, label_lines, tech, rng)

                        # Generate output filename
                        suffix_tag = f"aug_{tech}"
                        if copies_per_technique > 1:
                            suffix_tag += f"_{copy_idx}"
                        out_name = f"{img_file.stem}_{suffix_tag}{img_file.suffix}"

                        # Save augmented image
                        out_img_path = images_path / out_name
                        aug_img.save(str(out_img_path), quality=95)

                        # Save augmented label if original had labels
                        if label_lines:
                            out_label_path = labels_path / f"{img_file.stem}_{suffix_tag}.txt"
                            out_label_path.write_text(
                                "\n".join(aug_labels) + "\n",
                                encoding="utf-8",
                            )

                        generated += 1
                    except Exception as e:
                        logging.warning("Augment: error on %s/%s: %s", img_file.name, tech, e)
                        errors += 1
                        generated += 1

                    _update({"progress": generated, "errors": errors})

        _update({
            "status": "completed",
            "finished_at": time.time(),
            "progress": total_ops,
            "generated": generated - errors,
            "errors": errors,
        })

    except Exception as e:
        logging.exception("Augmentation job %s failed: %s", job_id, e)
        _update({"status": "failed", "error": str(e), "finished_at": time.time()})


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@augmentation_blueprint.route("/augment/techniques", methods=["GET"])
def list_techniques():
    return jsonify(AUGMENTATION_TECHNIQUES)


@augmentation_blueprint.route("/augment/jobs", methods=["POST"])
def create_augmentation_job():
    body = request.json or {}
    dataset_id = str(body.get("dataset_id") or "").strip()
    techniques = body.get("techniques") or []
    copies_per_technique = max(1, min(10, int(body.get("copies_per_technique") or 1)))
    seed = int(body.get("seed") or random.randint(0, 999999))

    if not dataset_id:
        return {"error": "dataset_id wajib diisi."}, 400

    row = _get_dataset_row(dataset_id)
    if not row:
        return {"error": "Dataset tidak ditemukan."}, 404

    if not isinstance(techniques, list) or not techniques:
        return {"error": "Pilih minimal 1 teknik augmentasi."}, 400

    invalid = [t for t in techniques if t not in VALID_TECHNIQUE_IDS]
    if invalid:
        return {"error": f"Teknik tidak valid: {', '.join(invalid)}"}, 400

    job_id = f"aug-{uuid.uuid4().hex[:10]}"
    job = {
        "id": job_id,
        "dataset_id": dataset_id,
        "techniques": techniques,
        "copies_per_technique": copies_per_technique,
        "seed": seed,
        "status": "queued",
        "total": 0,
        "progress": 0,
        "generated": 0,
        "errors": 0,
        "error": None,
        "created_at": time.time(),
        "started_at": None,
        "finished_at": None,
    }

    with _AUG_JOBS_LOCK:
        _AUG_JOBS[job_id] = job

    thread = threading.Thread(
        target=_run_augmentation_job,
        args=(job_id, dataset_id, techniques, copies_per_technique, seed),
        daemon=True,
    )
    thread.start()

    return jsonify(job), 201


@augmentation_blueprint.route("/augment/jobs", methods=["GET"])
def list_augmentation_jobs():
    with _AUG_JOBS_LOCK:
        jobs = list(_AUG_JOBS.values())
    jobs.sort(key=lambda j: j.get("created_at") or 0, reverse=True)
    return jsonify(jobs)


@augmentation_blueprint.route("/augment/jobs/<job_id>", methods=["GET"])
def get_augmentation_job(job_id: str):
    with _AUG_JOBS_LOCK:
        job = _AUG_JOBS.get(job_id)
    if not job:
        return {"error": "Job not found"}, 404
    return jsonify(job)


@augmentation_blueprint.route("/augment/jobs/<job_id>/cancel", methods=["POST"])
def cancel_augmentation_job(job_id: str):
    with _AUG_JOBS_LOCK:
        job = _AUG_JOBS.get(job_id)
        if not job:
            return {"error": "Job not found"}, 404
        if job["status"] in ("completed", "failed", "canceled"):
            return {"error": f"Job sudah selesai ({job['status']})"}, 400
        job["status"] = "canceling"
    return jsonify(job)


@augmentation_blueprint.route("/augment/jobs/<job_id>", methods=["DELETE"])
def delete_augmentation_job(job_id: str):
    with _AUG_JOBS_LOCK:
        job = _AUG_JOBS.get(job_id)
        if not job:
            return {"error": "Job not found"}, 404
        if job["status"] in ("queued", "running"):
            return {"error": "Cancel job dulu sebelum delete."}, 400
        del _AUG_JOBS[job_id]
    return jsonify({"id": job_id, "deleted": True})
