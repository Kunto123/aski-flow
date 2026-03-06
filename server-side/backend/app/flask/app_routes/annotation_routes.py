import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

from flask import Blueprint, jsonify, request

from app.storage.db import connect
from app.utils.runtime_url import resolve_public_base_url

try:
    import cv2
    import numpy as np
except Exception:
    cv2 = None
    np = None

annotation_blueprint = Blueprint("annotation_blueprint", __name__)

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


def _get_dataset_row(dataset_id: str):
    with connect() as conn:
        return conn.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone()


def _dataset_file_url(dataset_id: str, relative_path: str) -> str:
    base_url = resolve_public_base_url().rstrip("/")
    rel = str(relative_path).replace("\\", "/").lstrip("/")
    return f"{base_url}/datasets/{dataset_id}/files/{rel}"


def _resolve_dataset_context(dataset_id: str) -> Tuple[Dict[str, Any], Path, Path, Path]:
    row = _get_dataset_row(dataset_id)
    if not row:
        raise FileNotFoundError("Dataset not found")

    payload = dict(row)
    payload["classes"] = _safe_parse_classes(payload.get("classes_json"))

    dataset_path = Path(str(payload.get("path") or "")).resolve()
    images_path = (dataset_path / "images").resolve()
    labels_path = (dataset_path / "labels").resolve()
    exports_path = (dataset_path / "exports").resolve()
    images_path.mkdir(parents=True, exist_ok=True)
    labels_path.mkdir(parents=True, exist_ok=True)
    exports_path.mkdir(parents=True, exist_ok=True)
    return payload, images_path, labels_path, exports_path


def _resolve_image_file(image_name: str, images_path: Path) -> Path:
    normalized = str(image_name or "").strip()
    if not normalized:
        raise ValueError("Image name is required")
    if Path(normalized).name != normalized:
        raise ValueError("Invalid image name")

    image_path = (images_path / normalized).resolve()
    if images_path not in image_path.parents or image_path == images_path:
        raise ValueError("Invalid image path")
    if image_path.suffix.lower() not in _IMAGE_EXTENSIONS:
        raise ValueError("Unsupported image format")
    if not image_path.exists() or not image_path.is_file():
        raise FileNotFoundError("Image not found")
    return image_path


def _label_path_from_image(image_path: Path, labels_path: Path) -> Path:
    return (labels_path / f"{image_path.stem}.txt").resolve()


def _done_marker_path_from_image(image_path: Path, labels_path: Path) -> Path:
    return (labels_path / f"{image_path.stem}.done").resolve()


def _annotated_image_path_from_image(image_path: Path, exports_path: Path) -> Path:
    return (exports_path / f"{image_path.stem}__annotated.jpg").resolve()


def _safe_color_for_class(class_id: int) -> Tuple[int, int, int]:
    # BGR color palette with deterministic fallback based on class_id.
    palette = [
        (59, 235, 255),
        (255, 200, 59),
        (80, 220, 120),
        (255, 136, 136),
        (158, 109, 255),
        (97, 212, 255),
    ]
    if class_id < 0:
        return palette[0]
    return palette[class_id % len(palette)]


def _load_image_with_unicode_path(path: Path):
    if cv2 is None or np is None:
        return None
    try:
        data = np.fromfile(str(path), dtype=np.uint8)
        if data.size == 0:
            return None
        return cv2.imdecode(data, cv2.IMREAD_COLOR)
    except Exception:
        return None


def _save_image_with_unicode_path(path: Path, image) -> bool:
    if cv2 is None:
        return False
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        success, encoded = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
        if not success:
            return False
        encoded.tofile(str(path))
        return True
    except Exception:
        return False


def _render_annotated_image(
    image_path: Path, boxes: List[Dict[str, float]], classes: List[str], output_path: Path
) -> bool:
    image = _load_image_with_unicode_path(image_path)
    if image is None:
        return False

    height, width = image.shape[:2]
    if width <= 0 or height <= 0:
        return False

    for box in boxes:
        class_id = int(box.get("class_id", 0))
        x = float(box.get("x", 0.0))
        y = float(box.get("y", 0.0))
        w = float(box.get("w", 0.0))
        h = float(box.get("h", 0.0))

        x1 = max(0, min(width - 1, int(round((x - w / 2.0) * width))))
        y1 = max(0, min(height - 1, int(round((y - h / 2.0) * height))))
        x2 = max(0, min(width - 1, int(round((x + w / 2.0) * width))))
        y2 = max(0, min(height - 1, int(round((y + h / 2.0) * height))))
        if x2 <= x1 or y2 <= y1:
            continue

        color = _safe_color_for_class(class_id)
        cv2.rectangle(image, (x1, y1), (x2, y2), color, 2, lineType=cv2.LINE_AA)

        class_name = classes[class_id] if 0 <= class_id < len(classes) else f"class-{class_id}"
        label_text = f"{class_name} ({class_id})"
        (text_w, text_h), baseline = cv2.getTextSize(
            label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1
        )
        text_x = x1
        text_y = max(text_h + baseline + 2, y1 - 4)
        bg_x2 = min(width - 1, text_x + text_w + 6)
        bg_y1 = max(0, text_y - text_h - baseline - 4)
        cv2.rectangle(
            image,
            (text_x, bg_y1),
            (bg_x2, min(height - 1, text_y + 2)),
            color,
            thickness=-1,
            lineType=cv2.LINE_AA,
        )
        cv2.putText(
            image,
            label_text,
            (text_x + 3, text_y - 1),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (20, 20, 20),
            1,
            lineType=cv2.LINE_AA,
        )

    return _save_image_with_unicode_path(output_path, image)


def _parse_yolo_label_file(label_path: Path) -> List[Dict[str, float]]:
    if not label_path.exists() or not label_path.is_file():
        return []

    boxes: List[Dict[str, float]] = []
    lines = label_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    for line in lines:
        parts = [part for part in line.strip().split() if part]
        if len(parts) < 5:
            continue
        try:
            class_id = int(float(parts[0]))
            x = float(parts[1])
            y = float(parts[2])
            w = float(parts[3])
            h = float(parts[4])
        except Exception:
            continue
        boxes.append(
            {
                "class_id": class_id,
                "x": x,
                "y": y,
                "w": w,
                "h": h,
            }
        )
    return boxes


def _count_non_empty_label_rows(label_path: Path) -> int:
    if not label_path.exists() or not label_path.is_file():
        return 0
    try:
        rows = label_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return 0
    return sum(1 for row in rows if str(row).strip())


def _label_has_annotation_content(label_path: Path) -> bool:
    return _count_non_empty_label_rows(label_path) > 0


def _is_image_marked_done(label_path: Path, done_marker_path: Path) -> bool:
    if _label_has_annotation_content(label_path):
        return True
    return done_marker_path.exists() and done_marker_path.is_file()


def _touch_done_marker(done_marker_path: Path) -> None:
    done_marker_path.parent.mkdir(parents=True, exist_ok=True)
    done_marker_path.write_text("done\n", encoding="utf-8")


def _normalize_boxes(raw_boxes: Any, class_count: int) -> List[Dict[str, float]]:
    if raw_boxes is None:
        return []
    if not isinstance(raw_boxes, list):
        raise ValueError("Field 'boxes' must be an array")

    normalized: List[Dict[str, float]] = []
    for item in raw_boxes:
        if not isinstance(item, dict):
            raise ValueError("Invalid annotation box payload")

        try:
            class_id = int(item.get("class_id"))
            x = float(item.get("x"))
            y = float(item.get("y"))
            w = float(item.get("w"))
            h = float(item.get("h"))
        except Exception:
            raise ValueError("Each box must contain class_id, x, y, w, h")

        if class_id < 0:
            raise ValueError("class_id must be >= 0")
        if class_count > 0 and class_id >= class_count:
            raise ValueError("class_id is out of range of dataset classes")

        if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1):
            raise ValueError("x,y,w,h must be normalized to [0..1] and w/h > 0")

        normalized.append(
            {
                "class_id": class_id,
                "x": x,
                "y": y,
                "w": w,
                "h": h,
            }
        )
    return normalized


@annotation_blueprint.route("/annotate/health", methods=["GET"])
def annotate_health():
    return {"status": "ok"}


@annotation_blueprint.route("/annotate/datasets/<dataset_id>/images", methods=["GET"])
def list_annotation_images(dataset_id: str):
    try:
        dataset, images_path, labels_path, exports_path = _resolve_dataset_context(dataset_id)
    except FileNotFoundError:
        return {"error": "Dataset not found"}, 404

    status_filter = str(request.args.get("status") or "all").strip().lower()
    if status_filter not in {"all", "done", "unassigned"}:
        status_filter = "all"

    try:
        page = max(1, int(request.args.get("page") or 1))
    except Exception:
        page = 1
    try:
        page_size = int(request.args.get("page_size") or 200)
    except Exception:
        page_size = 200
    page_size = max(1, min(1000, page_size))

    all_images = [
        p
        for p in sorted(images_path.iterdir(), key=lambda x: x.name.lower())
        if p.is_file() and p.suffix.lower() in _IMAGE_EXTENSIONS
    ]

    items: List[Dict[str, Any]] = []
    done_count = 0
    for image_path in all_images:
        label_path = _label_path_from_image(image_path, labels_path)
        done_marker_path = _done_marker_path_from_image(image_path, labels_path)
        annotated_path = _annotated_image_path_from_image(image_path, exports_path)
        boxes = _parse_yolo_label_file(label_path)
        has_annotation = _is_image_marked_done(label_path, done_marker_path)
        status = "done" if has_annotation else "unassigned"
        label_count = len(boxes)
        if label_count == 0 and has_annotation:
            label_count = _count_non_empty_label_rows(label_path)
        if status == "done":
            done_count += 1

        if status_filter != "all" and status != status_filter:
            continue

        relative_path = f"images/{image_path.name}"
        items.append(
            {
                "name": image_path.name,
                "url": _dataset_file_url(dataset_id, relative_path),
                "status": status,
                "label_count": label_count,
                "label_file": f"labels/{label_path.name}",
                "label_updated_at": label_path.stat().st_mtime if label_path.exists() else None,
                "done_marker_file": f"labels/{done_marker_path.name}"
                if done_marker_path.exists()
                else "",
                "annotated_image_file": f"exports/{annotated_path.name}"
                if annotated_path.exists()
                else "",
                "annotated_image_url": _dataset_file_url(
                    dataset_id, f"exports/{annotated_path.name}"
                )
                if annotated_path.exists()
                else "",
                "annotated_image_updated_at": annotated_path.stat().st_mtime
                if annotated_path.exists()
                else None,
            }
        )

    total_filtered = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    paged = items[start:end]

    return jsonify(
        {
            "dataset_id": dataset_id,
            "dataset_name": dataset.get("name"),
            "folder_name": Path(str(dataset.get("path") or "")).name,
            "classes": dataset.get("classes") or [],
            "status": status_filter,
            "page": page,
            "page_size": page_size,
            "total": total_filtered,
            "stats": {
                "all": len(all_images),
                "done": done_count,
                "unassigned": max(0, len(all_images) - done_count),
            },
            "images": paged,
        }
    )


@annotation_blueprint.route(
    "/annotate/datasets/<dataset_id>/images/<path:image_name>/labels", methods=["GET"]
)
def get_annotation_labels(dataset_id: str, image_name: str):
    try:
        dataset, images_path, labels_path, exports_path = _resolve_dataset_context(dataset_id)
        image_path = _resolve_image_file(image_name, images_path)
    except FileNotFoundError:
        return {"error": "Dataset or image not found"}, 404
    except ValueError as exc:
        return {"error": str(exc)}, 400

    label_path = _label_path_from_image(image_path, labels_path)
    done_marker_path = _done_marker_path_from_image(image_path, labels_path)
    annotated_path = _annotated_image_path_from_image(image_path, exports_path)
    boxes = _parse_yolo_label_file(label_path)
    has_annotation = _is_image_marked_done(label_path, done_marker_path)
    status = "done" if has_annotation else "unassigned"
    label_count = len(boxes)
    if label_count == 0 and has_annotation:
        label_count = _count_non_empty_label_rows(label_path)

    return jsonify(
        {
            "dataset_id": dataset_id,
            "image_name": image_path.name,
            "image_url": _dataset_file_url(dataset_id, f"images/{image_path.name}"),
            "label_file": f"labels/{label_path.name}",
            "status": status,
            "classes": dataset.get("classes") or [],
            "boxes": boxes,
            "label_count": label_count,
            "updated_at": label_path.stat().st_mtime if label_path.exists() else None,
            "done_marker_file": f"labels/{done_marker_path.name}"
            if done_marker_path.exists()
            else "",
            "annotated_image_file": f"exports/{annotated_path.name}"
            if annotated_path.exists()
            else "",
            "annotated_image_url": _dataset_file_url(
                dataset_id, f"exports/{annotated_path.name}"
            )
            if annotated_path.exists()
            else "",
            "annotated_image_updated_at": annotated_path.stat().st_mtime
            if annotated_path.exists()
            else None,
        }
    )


@annotation_blueprint.route(
    "/annotate/datasets/<dataset_id>/images/<path:image_name>/labels", methods=["PUT"]
)
def save_annotation_labels(dataset_id: str, image_name: str):
    try:
        dataset, images_path, labels_path, exports_path = _resolve_dataset_context(dataset_id)
        image_path = _resolve_image_file(image_name, images_path)
    except FileNotFoundError:
        return {"error": "Dataset or image not found"}, 404
    except ValueError as exc:
        return {"error": str(exc)}, 400

    body = request.json or {}
    raw_boxes = body.get("boxes")
    mark_done_only = bool(body.get("mark_done_only"))
    try:
        boxes = _normalize_boxes(raw_boxes, len(dataset.get("classes") or []))
    except ValueError as exc:
        return {"error": str(exc)}, 400

    label_path = _label_path_from_image(image_path, labels_path)
    done_marker_path = _done_marker_path_from_image(image_path, labels_path)
    annotated_path = _annotated_image_path_from_image(image_path, exports_path)
    if not boxes:
        if mark_done_only:
            if label_path.exists() and label_path.is_file():
                label_path.unlink()
            _touch_done_marker(done_marker_path)
            return jsonify(
                {
                    "dataset_id": dataset_id,
                    "image_name": image_path.name,
                    "saved_count": 0,
                    "status": "done",
                    "label_file": f"labels/{label_path.name}",
                    "done_marker_file": f"labels/{done_marker_path.name}",
                    "updated_at": None,
                    "annotated_image_file": "",
                    "annotated_image_url": "",
                    "annotated_image_updated_at": None,
                }
            )
        if label_path.exists():
            label_path.unlink()
        if done_marker_path.exists() and done_marker_path.is_file():
            done_marker_path.unlink()
        if annotated_path.exists() and annotated_path.is_file():
            annotated_path.unlink()
        return jsonify(
            {
                "dataset_id": dataset_id,
                "image_name": image_path.name,
                "saved_count": 0,
                "status": "unassigned",
                "label_file": f"labels/{label_path.name}",
                "done_marker_file": "",
                "updated_at": None,
                "annotated_image_file": "",
                "annotated_image_url": "",
                "annotated_image_updated_at": None,
            }
        )

    lines = [
        f"{box['class_id']} {box['x']:.6f} {box['y']:.6f} {box['w']:.6f} {box['h']:.6f}"
        for box in boxes
    ]
    label_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    _touch_done_marker(done_marker_path)
    classes = dataset.get("classes") or []
    render_ok = _render_annotated_image(image_path, boxes, classes, annotated_path)

    response_payload = {
        "dataset_id": dataset_id,
        "image_name": image_path.name,
        "saved_count": len(boxes),
        "status": "done",
        "label_file": f"labels/{label_path.name}",
        "done_marker_file": f"labels/{done_marker_path.name}",
        "updated_at": label_path.stat().st_mtime,
        "annotated_image_file": "",
        "annotated_image_url": "",
        "annotated_image_updated_at": None,
    }
    if render_ok and annotated_path.exists():
        response_payload["annotated_image_file"] = f"exports/{annotated_path.name}"
        response_payload["annotated_image_url"] = _dataset_file_url(
            dataset_id, f"exports/{annotated_path.name}"
        )
        response_payload["annotated_image_updated_at"] = annotated_path.stat().st_mtime
    else:
        response_payload["render_warning"] = (
            "Label tersimpan, tetapi gagal membuat gambar anotasi."
        )

    return jsonify(response_payload)


@annotation_blueprint.route(
    "/annotate/datasets/<dataset_id>/images/<path:image_name>/labels", methods=["DELETE"]
)
def delete_annotation_labels(dataset_id: str, image_name: str):
    try:
        _, images_path, labels_path, exports_path = _resolve_dataset_context(dataset_id)
        image_path = _resolve_image_file(image_name, images_path)
    except FileNotFoundError:
        return {"error": "Dataset or image not found"}, 404
    except ValueError as exc:
        return {"error": str(exc)}, 400

    label_path = _label_path_from_image(image_path, labels_path)
    done_marker_path = _done_marker_path_from_image(image_path, labels_path)
    annotated_path = _annotated_image_path_from_image(image_path, exports_path)
    deleted = False
    if label_path.exists() and label_path.is_file():
        label_path.unlink()
        deleted = True
    done_marker_deleted = False
    if done_marker_path.exists() and done_marker_path.is_file():
        done_marker_path.unlink()
        done_marker_deleted = True
    annotated_deleted = False
    if annotated_path.exists() and annotated_path.is_file():
        annotated_path.unlink()
        annotated_deleted = True

    return jsonify(
        {
            "dataset_id": dataset_id,
            "image_name": image_path.name,
            "label_file": f"labels/{label_path.name}",
            "done_marker_file": f"labels/{done_marker_path.name}",
            "deleted": deleted,
            "done_marker_deleted": done_marker_deleted,
            "annotated_image_file": f"exports/{annotated_path.name}",
            "annotated_image_deleted": annotated_deleted,
        }
    )


@annotation_blueprint.route("/annotate/datasets/<dataset_id>/classes", methods=["PUT"])
def update_annotation_classes(dataset_id: str):
    row = _get_dataset_row(dataset_id)
    if not row:
        return {"error": "Dataset not found"}, 404

    body = request.json or {}
    raw_classes = body.get("classes")
    if not isinstance(raw_classes, list):
        return {"error": "Field 'classes' must be an array"}, 400

    cleaned: List[str] = []
    for item in raw_classes:
        value = str(item or "").strip()
        if not value:
            continue
        if value not in cleaned:
            cleaned.append(value)

    with connect() as conn:
        conn.execute(
            "UPDATE datasets SET classes_json=? WHERE id=?",
            (json.dumps(cleaned), dataset_id),
        )
        conn.commit()

    return jsonify(
        {
            "dataset_id": dataset_id,
            "classes": cleaned,
            "count": len(cleaned),
        }
    )
