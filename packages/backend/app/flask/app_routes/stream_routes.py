from flask import Blueprint, Response, jsonify, request

from app.streaming import get_stream_manager


stream_blueprint = Blueprint("stream_blueprint", __name__)


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


@stream_blueprint.route("/stream/<stream_id>/stop", methods=["POST"])
def stop_stream(stream_id: str):
    manager = get_stream_manager()
    stopped = manager.stop_stream(stream_id)
    if not stopped:
        return {"stopped": False, "error": "Stream not found"}, 404
    return {"stopped": True}


@stream_blueprint.route("/stream/owner/<node_name>/stop", methods=["POST"])
def stop_stream_by_owner(node_name: str):
    manager = get_stream_manager()
    stopped_count = manager.stop_streams_by_owner(node_name)
    return {"stopped": stopped_count > 0, "stopped_count": stopped_count}


@stream_blueprint.route("/stream/camera", methods=["POST"])
def create_camera_stream():
    body = request.json or {}
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


@stream_blueprint.route("/stream/camera/stop", methods=["POST"])
def stop_all_camera_streams():
    manager = get_stream_manager()
    stopped_count = manager.stop_camera_streams()
    return {"stopped": stopped_count > 0, "stopped_count": stopped_count}


@stream_blueprint.route("/stream/camera/by-index/stop", methods=["POST"])
def stop_camera_streams_by_index():
    body = request.json or {}
    camera_index_raw = body.get("camera_index")
    if camera_index_raw is None:
        return {"stopped": False, "error": "camera_index is required"}, 400
    try:
        camera_index = int(camera_index_raw)
    except Exception:
        return {"stopped": False, "error": "camera_index must be an integer"}, 400

    manager = get_stream_manager()
    stopped_count = manager.stop_camera_streams_by_index(camera_index)
    return {
        "stopped": stopped_count > 0,
        "stopped_count": stopped_count,
        "camera_index": camera_index,
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
    manager = get_stream_manager()
    manager.clear_debug_events()
    return {"cleared": True}
