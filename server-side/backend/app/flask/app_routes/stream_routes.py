from flask import Blueprint, Response, jsonify, request
import os

from app.streaming import get_stream_manager


stream_blueprint = Blueprint("stream_blueprint", __name__)


def _request_body():
    if request.is_json:
        return request.json or {}
    return {}


def _get_client_session_id_from_request():
    body = _request_body()
    return (
        request.headers.get("X-Aski-Client-Session-Id")
        or request.headers.get("X-Aski-Client-Id")
        or request.args.get("client_session_id")
        or request.args.get("client_id")
        or (body or {}).get("client_session_id")
        or (body or {}).get("client_id")
    )


def _parse_optional_int(raw, field_name: str):
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except Exception:
        raise ValueError(f"{field_name} must be an integer")


def _parse_optional_float(raw, field_name: str):
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except Exception:
        raise ValueError(f"{field_name} must be a number")


def _get_auth_token_from_request():
    body = _request_body()

    authorization = (request.headers.get("Authorization") or "").strip()
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token:
            return token

    header_token = (request.headers.get("X-Aski-Auth-Token") or "").strip()
    if header_token:
        return header_token

    query_token = (request.args.get("auth_token") or "").strip()
    if query_token:
        return query_token

    body_token = str((body or {}).get("auth_token") or "").strip()
    if body_token:
        return body_token

    return ""


def _is_request_authorized():
    expected = (os.getenv("ASKI_CLIENT_AUTH_TOKEN") or "").strip()
    if not expected:
        return True
    return _get_auth_token_from_request() == expected


def _require_authorized_request():
    if _is_request_authorized():
        return None
    return {"error": "Unauthorized"}, 401


@stream_blueprint.route("/stream/<stream_id>.mjpg", methods=["GET"])
def stream_mjpeg(stream_id: str):
    manager = get_stream_manager()
    stream = manager.get_stream(stream_id)
    if stream is None:
        return {"error": "Stream not found"}, 404

    return Response(
        manager.mjpeg_generator(stream_id),
        mimetype="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Accel-Buffering": "no",
        },
    )


@stream_blueprint.route("/stream/<stream_id>/predictions.json", methods=["GET"])
def stream_predictions(stream_id: str):
    manager = get_stream_manager()
    stream = manager.get_stream(stream_id)
    if stream is None:
        return {"error": "Stream not found"}, 404
    return jsonify(manager.get_predictions(stream_id))


@stream_blueprint.route("/stream/<stream_id>/roi/params", methods=["POST"])
def update_roi_stream_params(stream_id: str):
    unauthorized = _require_authorized_request()
    if unauthorized is not None:
        return unauthorized

    manager = get_stream_manager()
    stream = manager.get_stream(stream_id)
    if stream is None:
        return {"updated": False, "error": "Stream not found"}, 404

    if stream.source_type != "transform" or getattr(stream, "stream_tag", None) != "roi":
        return {"updated": False, "error": "Stream is not an ROI transform stream"}, 400

    body = request.json or {}
    allowed_fields = ("x", "y", "w", "h", "width", "height")
    updates = {}

    for field_name in allowed_fields:
        if field_name not in body:
            continue
        raw = body.get(field_name)
        if raw is None or raw == "":
            continue
        try:
            updates[field_name] = float(raw)
        except Exception:
            return {
                "updated": False,
                "error": f"{field_name} must be a number",
            }, 400

    if not updates:
        return {
            "updated": False,
            "error": "No ROI parameters provided",
        }, 400

    ok = manager.update_stream_runtime_params(stream_id, updates)
    if not ok:
        return {"updated": False, "error": "Stream not found"}, 404

    return {
        "updated": True,
        "stream_id": stream_id,
        "params": updates,
    }


@stream_blueprint.route("/stream/<stream_id>/stop", methods=["POST"])
def stop_stream(stream_id: str):
    unauthorized = _require_authorized_request()
    if unauthorized is not None:
        return unauthorized

    manager = get_stream_manager()
    stopped = manager.stop_stream(stream_id)
    if not stopped:
        return {"stopped": False, "error": "Stream not found"}, 404
    return {"stopped": True}


@stream_blueprint.route("/stream/owner/<node_name>/stop", methods=["POST"])
def stop_stream_by_owner(node_name: str):
    unauthorized = _require_authorized_request()
    if unauthorized is not None:
        return unauthorized

    client_session_id = _get_client_session_id_from_request()
    manager = get_stream_manager()
    stopped_count = manager.stop_streams_by_owner(
        node_name, client_session_id=client_session_id
    )
    return {"stopped": stopped_count > 0, "stopped_count": stopped_count}


@stream_blueprint.route("/stream/camera", methods=["POST"])
def create_camera_stream():
    unauthorized = _require_authorized_request()
    if unauthorized is not None:
        return unauthorized

    body = _request_body()
    camera_index = int(body.get("camera_index", 0))
    width = body.get("width")
    height = body.get("height")
    fps = body.get("fps")

    manager = get_stream_manager()
    stream_id = manager.create_camera_stream(
        camera_index=camera_index,
        width=int(width) if width is not None else None,
        height=int(height) if height is not None else None,
        fps=float(fps) if fps is not None else None,
    )

    return {
        "stream_id": stream_id,
        "stream_ref": f"stream://{stream_id}",
        "mjpeg_url": manager.build_mjpeg_url(stream_id),
        "predictions_url": manager.build_predictions_url(stream_id),
    }


@stream_blueprint.route("/stream/client-camera/frame", methods=["POST"])
def ingest_client_camera_frame():
    unauthorized = _require_authorized_request()
    if unauthorized is not None:
        return unauthorized

    client_session_id = str(_get_client_session_id_from_request() or "").strip()
    if not client_session_id:
        return {"ingested": False, "error": "client_session_id is required"}, 400

    try:
        camera_index = _parse_optional_int(
            request.args.get("camera_index") or request.headers.get("X-Aski-Camera-Index"),
            "camera_index",
        )
        if camera_index is None:
            camera_index = 0
        width = _parse_optional_int(
            request.args.get("width") or request.headers.get("X-Aski-Camera-Width"),
            "width",
        )
        height = _parse_optional_int(
            request.args.get("height") or request.headers.get("X-Aski-Camera-Height"),
            "height",
        )
        fps = _parse_optional_float(
            request.args.get("fps") or request.headers.get("X-Aski-Camera-Fps"),
            "fps",
        )
    except ValueError as e:
        return {"ingested": False, "error": str(e)}, 400

    frame_bytes = request.get_data(cache=False)
    if not frame_bytes:
        return {"ingested": False, "error": "JPEG body is required"}, 400

    manager = get_stream_manager()
    try:
        stream_id = manager.ingest_client_camera_frame(
            client_session_id=client_session_id,
            camera_index=int(camera_index),
            jpeg_bytes=frame_bytes,
            width=width,
            height=height,
            fps=fps,
        )
    except ValueError as e:
        return {"ingested": False, "error": str(e)}, 400
    except RuntimeError as e:
        return {"ingested": False, "error": str(e)}, 500

    return {
        "ingested": True,
        "stream_id": stream_id,
        "stream_ref": f"stream://{stream_id}",
        "mjpeg_url": manager.build_mjpeg_url(stream_id),
        "predictions_url": manager.build_predictions_url(stream_id),
    }


@stream_blueprint.route("/stream/camera/stop", methods=["POST"])
def stop_all_camera_streams():
    unauthorized = _require_authorized_request()
    if unauthorized is not None:
        return unauthorized

    manager = get_stream_manager()
    client_session_id = _get_client_session_id_from_request()
    stopped_count = manager.stop_camera_streams(client_session_id=client_session_id)
    return {"stopped": stopped_count > 0, "stopped_count": stopped_count}


@stream_blueprint.route("/stream/camera/by-index/stop", methods=["POST"])
def stop_camera_streams_by_index():
    unauthorized = _require_authorized_request()
    if unauthorized is not None:
        return unauthorized

    body = _request_body()
    camera_index_raw = body.get("camera_index")
    if camera_index_raw is None:
        return {"stopped": False, "error": "camera_index is required"}, 400
    try:
        camera_index = int(camera_index_raw)
    except Exception:
        return {"stopped": False, "error": "camera_index must be an integer"}, 400

    manager = get_stream_manager()
    client_session_id = _get_client_session_id_from_request()
    stopped_count = manager.stop_camera_streams_by_index(
        camera_index,
        client_session_id=client_session_id,
    )
    return {
        "stopped": stopped_count > 0,
        "stopped_count": stopped_count,
        "camera_index": camera_index,
        "client_session_id": client_session_id,
    }


@stream_blueprint.route("/stream/debug", methods=["GET"])
def stream_debug_snapshot():
    manager = get_stream_manager()
    limit_raw = request.args.get("limit", "200")
    try:
        limit = int(limit_raw)
    except Exception:
        limit = 200
    limit = max(0, min(limit, 2000))
    return jsonify(manager.get_debug_snapshot(events_limit=limit))


@stream_blueprint.route("/stream/debug/clear", methods=["POST"])
def stream_debug_clear():
    unauthorized = _require_authorized_request()
    if unauthorized is not None:
        return unauthorized

    manager = get_stream_manager()
    manager.clear_debug_events()
    return {"cleared": True}
