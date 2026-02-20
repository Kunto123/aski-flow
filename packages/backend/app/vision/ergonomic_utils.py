import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

import cv2

# COCO keypoint order used by common YOLO pose models.
COCO_KEYPOINT_NAMES = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]

COCO_SKELETON_EDGES = [
    (5, 7),
    (7, 9),
    (6, 8),
    (8, 10),
    (5, 6),
    (5, 11),
    (6, 12),
    (11, 12),
    (11, 13),
    (13, 15),
    (12, 14),
    (14, 16),
]


def _to_point(kp: Dict[str, Any], min_conf: float) -> Optional[Tuple[float, float]]:
    if not isinstance(kp, dict):
        return None
    conf = float(kp.get("conf", 0.0) or 0.0)
    if conf < min_conf:
        return None
    x = kp.get("x")
    y = kp.get("y")
    if x is None or y is None:
        return None
    try:
        return float(x), float(y)
    except Exception:
        return None


def _get_point(
    keypoints: Sequence[Dict[str, Any]],
    index: int,
    min_conf: float,
) -> Optional[Tuple[float, float]]:
    if index < 0 or index >= len(keypoints):
        return None
    return _to_point(keypoints[index], min_conf)


def _midpoint(
    a: Optional[Tuple[float, float]],
    b: Optional[Tuple[float, float]],
) -> Optional[Tuple[float, float]]:
    if a is None or b is None:
        return None
    return ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)


def _angle_degrees(
    p1: Optional[Tuple[float, float]],
    pivot: Optional[Tuple[float, float]],
    p3: Optional[Tuple[float, float]],
) -> Optional[float]:
    if p1 is None or pivot is None or p3 is None:
        return None
    v1 = (p1[0] - pivot[0], p1[1] - pivot[1])
    v2 = (p3[0] - pivot[0], p3[1] - pivot[1])
    mag1 = math.hypot(v1[0], v1[1])
    mag2 = math.hypot(v2[0], v2[1])
    if mag1 < 1e-6 or mag2 < 1e-6:
        return None
    cos_theta = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (mag1 * mag2)))
    return math.degrees(math.acos(cos_theta))


def _angle_from_vertical(
    p_top: Optional[Tuple[float, float]],
    p_bottom: Optional[Tuple[float, float]],
) -> Optional[float]:
    if p_top is None or p_bottom is None:
        return None
    dx = float(p_top[0] - p_bottom[0])
    dy = float(p_top[1] - p_bottom[1])
    # Compare to vertical axis; 0 means upright.
    return abs(math.degrees(math.atan2(dx, abs(dy) + 1e-6)))


def _risk_level(score: float) -> str:
    if score >= 60:
        return "high"
    if score >= 30:
        return "medium"
    return "low"


def assess_ergonomic_risk(
    keypoints: Sequence[Dict[str, Any]],
    min_conf: float = 0.35,
) -> Dict[str, Any]:
    if not keypoints:
        return {
            "pose_label": "unknown",
            "risk_score": 0,
            "risk_level": "low",
            "issues": [],
            "metrics": {},
            "valid_keypoints": 0,
        }

    points = [
        _to_point(keypoints[i], min_conf) if i < len(keypoints) else None
        for i in range(len(COCO_KEYPOINT_NAMES))
    ]
    valid_keypoints = sum(1 for p in points if p is not None)

    left_shoulder = _get_point(keypoints, 5, min_conf)
    right_shoulder = _get_point(keypoints, 6, min_conf)
    left_elbow = _get_point(keypoints, 7, min_conf)
    right_elbow = _get_point(keypoints, 8, min_conf)
    left_wrist = _get_point(keypoints, 9, min_conf)
    right_wrist = _get_point(keypoints, 10, min_conf)
    left_hip = _get_point(keypoints, 11, min_conf)
    right_hip = _get_point(keypoints, 12, min_conf)
    left_knee = _get_point(keypoints, 13, min_conf)
    right_knee = _get_point(keypoints, 14, min_conf)
    left_ankle = _get_point(keypoints, 15, min_conf)
    right_ankle = _get_point(keypoints, 16, min_conf)
    nose = _get_point(keypoints, 0, min_conf)

    shoulder_mid = _midpoint(left_shoulder, right_shoulder)
    hip_mid = _midpoint(left_hip, right_hip)

    metrics: Dict[str, Any] = {}
    issues: List[Dict[str, Any]] = []
    risk_score = 0

    torso_lean = _angle_from_vertical(shoulder_mid, hip_mid)
    if torso_lean is not None:
        torso_lean = round(float(torso_lean), 1)
        metrics["torso_lean_deg"] = torso_lean
        if torso_lean >= 40:
            risk_score += 35
            issues.append(
                {
                    "code": "torso_lean",
                    "severity": "high",
                    "value": torso_lean,
                    "message": "Torso is heavily bent forward/sideways.",
                }
            )
        elif torso_lean >= 25:
            risk_score += 18
            issues.append(
                {
                    "code": "torso_lean",
                    "severity": "medium",
                    "value": torso_lean,
                    "message": "Torso lean indicates non-neutral posture.",
                }
            )

    neck_lean = _angle_from_vertical(nose, shoulder_mid)
    if neck_lean is not None:
        neck_lean = round(float(neck_lean), 1)
        metrics["neck_lean_deg"] = neck_lean
        if neck_lean >= 45:
            risk_score += 25
            issues.append(
                {
                    "code": "neck_lean",
                    "severity": "high",
                    "value": neck_lean,
                    "message": "Neck posture shows strong forward/side lean.",
                }
            )
        elif neck_lean >= 30:
            risk_score += 12
            issues.append(
                {
                    "code": "neck_lean",
                    "severity": "medium",
                    "value": neck_lean,
                    "message": "Neck posture may increase strain risk.",
                }
            )

    left_knee_angle = _angle_degrees(left_hip, left_knee, left_ankle)
    right_knee_angle = _angle_degrees(right_hip, right_knee, right_ankle)
    if left_knee_angle is not None:
        left_knee_angle = round(float(left_knee_angle), 1)
        metrics["left_knee_angle_deg"] = left_knee_angle
    if right_knee_angle is not None:
        right_knee_angle = round(float(right_knee_angle), 1)
        metrics["right_knee_angle_deg"] = right_knee_angle

    for side, angle in (("left", left_knee_angle), ("right", right_knee_angle)):
        if angle is None:
            continue
        if angle < 95:
            risk_score += 20
            issues.append(
                {
                    "code": f"{side}_knee_flexion",
                    "severity": "high",
                    "value": angle,
                    "message": f"{side.capitalize()} knee flexion is deep.",
                }
            )
        elif angle < 120:
            risk_score += 10
            issues.append(
                {
                    "code": f"{side}_knee_flexion",
                    "severity": "medium",
                    "value": angle,
                    "message": f"{side.capitalize()} knee flexion is noticeable.",
                }
            )

    left_elbow_angle = _angle_degrees(left_shoulder, left_elbow, left_wrist)
    right_elbow_angle = _angle_degrees(right_shoulder, right_elbow, right_wrist)
    if left_elbow_angle is not None:
        left_elbow_angle = round(float(left_elbow_angle), 1)
        metrics["left_elbow_angle_deg"] = left_elbow_angle
    if right_elbow_angle is not None:
        right_elbow_angle = round(float(right_elbow_angle), 1)
        metrics["right_elbow_angle_deg"] = right_elbow_angle

    for side, angle in (("left", left_elbow_angle), ("right", right_elbow_angle)):
        if angle is None:
            continue
        if angle < 60:
            risk_score += 12
            issues.append(
                {
                    "code": f"{side}_elbow_flexion",
                    "severity": "high",
                    "value": angle,
                    "message": f"{side.capitalize()} elbow is strongly flexed.",
                }
            )
        elif angle < 90:
            risk_score += 6
            issues.append(
                {
                    "code": f"{side}_elbow_flexion",
                    "severity": "medium",
                    "value": angle,
                    "message": f"{side.capitalize()} elbow flexion may increase strain.",
                }
            )

    left_overhead = (
        left_wrist is not None
        and left_shoulder is not None
        and left_wrist[1] < (left_shoulder[1] - 10.0)
    )
    right_overhead = (
        right_wrist is not None
        and right_shoulder is not None
        and right_wrist[1] < (right_shoulder[1] - 10.0)
    )
    if left_overhead or right_overhead:
        risk_score += 10
        which_arm = "both" if (left_overhead and right_overhead) else ("left" if left_overhead else "right")
        issues.append(
            {
                "code": "overhead_reach",
                "severity": "medium",
                "value": which_arm,
                "message": "Arm reach above shoulder detected.",
            }
        )

    shoulder_asymmetry_px: Optional[float] = None
    if left_shoulder is not None and right_shoulder is not None:
        shoulder_asymmetry_px = abs(left_shoulder[1] - right_shoulder[1])
    torso_len_px: Optional[float] = None
    if shoulder_mid is not None and hip_mid is not None:
        torso_len_px = math.hypot(shoulder_mid[0] - hip_mid[0], shoulder_mid[1] - hip_mid[1])
    if shoulder_asymmetry_px is not None and torso_len_px is not None and torso_len_px > 1e-6:
        shoulder_asymmetry_ratio = shoulder_asymmetry_px / torso_len_px
        metrics["shoulder_asymmetry_ratio"] = round(float(shoulder_asymmetry_ratio), 3)
        if shoulder_asymmetry_ratio >= 0.12:
            risk_score += 8
            issues.append(
                {
                    "code": "shoulder_asymmetry",
                    "severity": "medium",
                    "value": round(float(shoulder_asymmetry_ratio), 3),
                    "message": "Shoulder height asymmetry is visible.",
                }
            )

    risk_score = int(max(0, min(100, risk_score)))
    risk_level = _risk_level(float(risk_score))

    pose_label = "standing"
    if torso_lean is not None and torso_lean >= 35:
        pose_label = "bending"
    elif (
        (left_knee_angle is not None and left_knee_angle < 115)
        or (right_knee_angle is not None and right_knee_angle < 115)
    ):
        pose_label = "squatting"
    elif left_overhead or right_overhead:
        pose_label = "reaching"

    return {
        "pose_label": pose_label,
        "risk_score": risk_score,
        "risk_level": risk_level,
        "issues": issues,
        "metrics": metrics,
        "valid_keypoints": valid_keypoints,
    }


def draw_skeleton_overlay(
    image: Any,
    people: Sequence[Dict[str, Any]],
    min_conf: float = 0.35,
) -> Any:
    if image is None or not people:
        return image

    canvas = image.copy()
    palette = {
        "low": (80, 220, 100),
        "medium": (0, 190, 255),
        "high": (0, 70, 255),
    }

    for person in people:
        keypoints = person.get("keypoints") or []
        if not isinstance(keypoints, list) or not keypoints:
            continue

        assessment = person.get("assessment") or {}
        risk_level = str(assessment.get("risk_level", "low"))
        color = palette.get(risk_level, (0, 190, 255))

        points: Dict[int, Tuple[int, int]] = {}
        for kp in keypoints:
            try:
                idx = int(kp.get("index", -1))
            except Exception:
                continue
            pt = _to_point(kp, min_conf=min_conf)
            if pt is None:
                continue
            points[idx] = (int(pt[0]), int(pt[1]))

        for a, b in COCO_SKELETON_EDGES:
            pa = points.get(a)
            pb = points.get(b)
            if pa is None or pb is None:
                continue
            cv2.line(canvas, pa, pb, color, 2, cv2.LINE_AA)

        for _, p in points.items():
            cv2.circle(canvas, p, 3, color, -1, cv2.LINE_AA)

        bbox = person.get("bbox_xyxy") or person.get("bbox") or [0, 0, 0, 0]
        if isinstance(bbox, list) and len(bbox) >= 4:
            try:
                x1, y1, _, _ = [int(float(v)) for v in bbox[:4]]
            except Exception:
                x1, y1 = 0, 0
        else:
            x1, y1 = 0, 0

        risk_score = assessment.get("risk_score")
        label = f"ergonomic: {risk_level.upper()}"
        if risk_score is not None:
            label += f" ({risk_score})"
        cv2.putText(
            canvas,
            label,
            (max(4, x1), max(18, y1 - 12)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            color,
            2,
            cv2.LINE_AA,
        )

    return canvas
