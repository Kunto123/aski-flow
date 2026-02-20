from typing import Any, Dict, List

import cv2


def draw_boxes_overlay(image, predictions: Dict[str, Any]):
    if image is None:
        return image

    boxes: List[Dict[str, Any]] = predictions.get("boxes", []) if predictions else []
    canvas = image.copy()

    for box in boxes:
        xyxy = box.get("xyxy", [0, 0, 0, 0])
        if len(xyxy) != 4:
            continue

        x1, y1, x2, y2 = [int(v) for v in xyxy]
        label = box.get("label", "object")
        conf = float(box.get("conf", 0))
        text = f"{label} {conf:.2f}"

        cv2.rectangle(canvas, (x1, y1), (x2, y2), (50, 220, 255), 2)
        cv2.putText(
            canvas,
            text,
            (x1, max(20, y1 - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (50, 220, 255),
            2,
            cv2.LINE_AA,
        )

    return canvas
