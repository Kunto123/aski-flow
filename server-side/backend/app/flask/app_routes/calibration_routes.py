"""
Calibration routes  (url_prefix = /calibration)

Provides the workstation calibration API for computing reference color profiles
from snippet images.  Runs only in LOCAL environment (same guard as other
workstation-specific routes).

POST /calibration/color-profile
    Body (JSON):
      {
        "image_data": "<base64-encoded PNG/JPEG>",   # Required
        "colorspace": "LAB",                          # Optional, default "LAB"
        "roi": {"x": 0, "y": 0, "w": 1, "h": 1}     # Optional normalised crop
      }
    OR
      {
        "image_url": "/asset/<filename>",             # Use stored asset instead
        "colorspace": "LAB",
        "roi": {...}
      }

    Response (200):
      The full color_profile JSON contract:
      {
        "schema_version": 1,
        "method": "color_profile_match",
        "colorspace": "LAB",
        "reference_source": "snippet",
        "reference_color": {"hex": "#rrggbb", "rgb": {"r": …, "g": …, "b": …}},
        "reference_stats": {
          "mean": {"l": …, "a": …, "b": …},
          "std":  {"l": …, "a": …, "b": …}
        },
        "tolerance": {"distance_threshold": <auto-computed, 3*std_pooled>},
        "min_match_ratio": 0.80,
        "sampling_meta": {"width": W, "height": H, "total_pixels": N}
      }
"""
from __future__ import annotations

import base64
import json
import math
import time
from typing import Any

from flask import Blueprint, jsonify, request

from app.flask.middleware.auth_middleware import require_admin
from app.storage.db import connect as db_connect

calibration_blueprint = Blueprint(
    "calibration", __name__, url_prefix="/calibration"
)


# ── lazy-import opencv (optional dep, same pattern as ROI processor) ─────────
def _import_cv2():
    try:
        import cv2
        import numpy as np
        return cv2, np
    except ImportError:
        return None, None


# ── helpers ───────────────────────────────────────────────────────────────────
def _decode_image(cv2, np, image_data_b64: str):
    """Decode a base64 image string into a BGR numpy array."""
    data = base64.b64decode(image_data_b64)
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def _load_asset_image(cv2, np, image_url: str):
    """Load an image from the local asset storage by URL."""
    from urllib.parse import urlparse
    from werkzeug.utils import secure_filename
    from app.storage.file_storage import FileStorage

    parsed = urlparse(image_url)
    marker = "/asset/"
    if marker not in parsed.path:
        return None
    filename = secure_filename(parsed.path.split(marker, 1)[1])
    storage = FileStorage()
    content = storage.get_file(filename)
    arr = np.frombuffer(content, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _apply_roi_crop(img, roi: dict | None):
    """Crop img by a normalised ROI dict {x, y, w, h} ∈ [0,1]."""
    if not roi:
        return img
    h, w = img.shape[:2]
    x1 = max(0, int(float(roi.get("x", 0)) * w))
    y1 = max(0, int(float(roi.get("y", 0)) * h))
    rw = max(1, int(float(roi.get("w", 1)) * w))
    rh = max(1, int(float(roi.get("h", 1)) * h))
    x2 = min(w, x1 + rw)
    y2 = min(h, y1 + rh)
    if x2 <= x1 or y2 <= y1:
        return img
    return img[y1:y2, x1:x2]


def _compute_color_profile(cv2, np, img, colorspace: str = "LAB") -> dict:
    """
    Compute a reference color profile from a BGR image region.

    Returns the full color_profile contract dict ready for use in
    PartReadyValidatorProcessor.
    """
    h, w = img.shape[:2]
    total_pixels = h * w

    # ── Mean color in BGR space (for reference_color.rgb) ─────────────────
    mean_bgr = img.mean(axis=(0, 1))   # [B, G, R]
    r_mean = float(mean_bgr[2])
    g_mean = float(mean_bgr[1])
    b_mean = float(mean_bgr[0])
    hex_color = "#{:02x}{:02x}{:02x}".format(
        int(round(r_mean)), int(round(g_mean)), int(round(b_mean))
    )

    # ── Stats in LAB (perceptual) or RGB ──────────────────────────────────
    colorspace = colorspace.upper()

    if colorspace == "LAB":
        converted = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(float)
        # Normalise to perceptual range: L→[0,100], a/b→[-128,127]
        converted[:, :, 0] *= (100.0 / 255.0)
        converted[:, :, 1] -= 128.0
        converted[:, :, 2] -= 128.0
        pixels = converted.reshape(-1, 3)
        axes_labels = ("l", "a", "b")
    else:
        colorspace = "RGB"
        pixels = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).reshape(-1, 3).astype(float)
        axes_labels = ("r", "g", "b")

    mean_vals = pixels.mean(axis=0)
    std_vals  = pixels.std(axis=0)

    mean_dict = {k: round(float(v), 4) for k, v in zip(axes_labels, mean_vals)}
    std_dict  = {k: round(float(v), 4) for k, v in zip(axes_labels, std_vals)}

    # Auto-threshold: 3× the pooled (RMS) std across channels
    pooled_std = math.sqrt(sum(v ** 2 for v in std_vals) / 3.0)
    distance_threshold = round(max(8.0, 3.0 * pooled_std), 2)

    return {
        "schema_version":   1,
        "method":           "color_profile_match",
        "colorspace":       colorspace,
        "reference_source": "snippet",
        "reference_color": {
            "hex": hex_color,
            "rgb": {
                "r": round(r_mean, 2),
                "g": round(g_mean, 2),
                "b": round(b_mean, 2),
            },
        },
        "reference_stats": {
            "mean": mean_dict,
            "std":  std_dict,
        },
        "tolerance": {
            "distance_threshold": distance_threshold,
        },
        "min_match_ratio": 0.80,
        "sampling_meta": {
            "width":        w,
            "height":       h,
            "total_pixels": total_pixels,
        },
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@calibration_blueprint.route("/color-profile", methods=["POST"])
@require_admin
def compute_color_profile():
    cv2, np = _import_cv2()
    if cv2 is None:
        return jsonify({"error": "opencv-python is not installed on this server."}), 503

    body: dict[str, Any] = request.get_json(force=True) or {}
    colorspace = str(body.get("colorspace") or "LAB").upper()
    roi = body.get("roi")  # optional normalised {x,y,w,h}

    img = None

    # Prefer inline base64
    image_data_b64 = body.get("image_data")
    if image_data_b64:
        try:
            img = _decode_image(cv2, np, image_data_b64)
        except Exception as exc:
            return jsonify({"error": f"Failed to decode image_data: {exc}"}), 400

    # Fallback: asset URL
    if img is None:
        image_url = body.get("image_url")
        if image_url:
            try:
                img = _load_asset_image(cv2, np, image_url)
            except Exception as exc:
                return jsonify({"error": f"Failed to load image_url: {exc}"}), 400

    if img is None:
        return jsonify({"error": "Provide image_data (base64) or image_url."}), 400

    # Apply ROI crop if specified
    if roi:
        img = _apply_roi_crop(img, roi)

    if img is None or img.size == 0:
        return jsonify({"error": "Image is empty after ROI crop."}), 400

    profile = _compute_color_profile(cv2, np, img, colorspace=colorspace)
    return jsonify(profile), 200


# ── Color Profile Registry (SQLite) ───────────────────────────────────────────

@calibration_blueprint.route("/profiles", methods=["GET"])
@require_admin
def list_profiles():
    """Return all saved color profiles, newest first."""
    with db_connect() as conn:
        rows = conn.execute(
            "SELECT id, name, profile_json, created_at FROM color_profiles ORDER BY created_at DESC"
        ).fetchall()
    result = []
    for row in rows:
        try:
            profile_data = json.loads(row["profile_json"])
        except Exception:
            profile_data = {}
        result.append({
            "id": row["id"],
            "name": row["name"],
            "profile": profile_data,
            "created_at": row["created_at"],
        })
    return jsonify(result), 200


@calibration_blueprint.route("/profiles", methods=["POST"])
@require_admin
def save_profile():
    """Save a named color profile to the local registry."""
    body: dict[str, Any] = request.get_json(force=True) or {}
    name = str(body.get("name") or "").strip()
    profile_data = body.get("profile")
    if not name:
        return jsonify({"error": "name is required"}), 400
    if not isinstance(profile_data, dict):
        return jsonify({"error": "profile must be an object"}), 400
    profile_json = json.dumps(profile_data)
    now = time.time()
    with db_connect() as conn:
        cur = conn.execute(
            "INSERT INTO color_profiles (name, profile_json, created_at) VALUES (?, ?, ?)",
            (name, profile_json, now),
        )
        conn.commit()
        new_id = cur.lastrowid
    return jsonify({"id": new_id, "name": name, "profile": profile_data, "created_at": now}), 201


@calibration_blueprint.route("/profiles/<int:profile_id>", methods=["DELETE"])
@require_admin
def delete_profile(profile_id: int):
    """Delete a color profile from the registry."""
    with db_connect() as conn:
        conn.execute("DELETE FROM color_profiles WHERE id = ?", (profile_id,))
        conn.commit()
    return jsonify({"ok": True}), 200
