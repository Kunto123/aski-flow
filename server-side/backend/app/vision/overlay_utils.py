from typing import Any, Dict, List

import cv2


def _sanitize_box(xyxy: List[Any], frame_w: int, frame_h: int):
    if len(xyxy) != 4 or frame_w <= 1 or frame_h <= 1:
        return None
    try:
        x1f, y1f, x2f, y2f = [float(v) for v in xyxy]
    except Exception:
        return None

    if not all(v == v and abs(v) != float("inf") for v in (x1f, y1f, x2f, y2f)):
        return None

    raw_w = abs(x2f - x1f)
    raw_h = abs(y2f - y1f)
    # Guard against malformed outlier coordinates that can paint the whole screen.
    if raw_w > frame_w * 2.5 or raw_h > frame_h * 2.5:
        return None

    x1 = int(round(x1f))
    y1 = int(round(y1f))
    x2 = int(round(x2f))
    y2 = int(round(y2f))

    if x2 < x1:
        x1, x2 = x2, x1
    if y2 < y1:
        y1, y2 = y2, y1

    x1 = max(0, min(frame_w - 1, x1))
    x2 = max(0, min(frame_w - 1, x2))
    y1 = max(0, min(frame_h - 1, y1))
    y2 = max(0, min(frame_h - 1, y2))

    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def draw_boxes_overlay(image, predictions: Dict[str, Any]):
    if image is None:
        return image

    boxes: List[Dict[str, Any]] = predictions.get("boxes", []) if predictions else []
    if not boxes:
        return image

    frame_h, frame_w = image.shape[:2]
    canvas = None

    for box in boxes:
        xyxy = box.get("xyxy", [0, 0, 0, 0])
        sanitized = _sanitize_box(xyxy, frame_w, frame_h)
        if sanitized is None:
            continue

        x1, y1, x2, y2 = sanitized
        if canvas is None:
            canvas = image.copy()

        label = box.get("label", "object")
        conf = float(box.get("conf", 0))
        text = f"{label} {conf:.2f}"

        cv2.rectangle(canvas, (x1, y1), (x2, y2), (50, 220, 255), 2)
        cv2.putText(
            canvas,
            text,
            (max(0, x1), max(20, y1 - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (50, 220, 255),
            2,
            cv2.LINE_AA,
        )

    return canvas if canvas is not None else image
