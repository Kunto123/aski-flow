"""
Inspection Blueprint  –  /inspections

Endpoints:
    GET  /inspections                         – List inspection results (with filters)
    GET  /inspections/<id>                    – Get result detail (includes targets array)
    GET  /inspections/push-pending            – List results pending push (admin)
    POST /inspections/push/<id>/sent          – Mark result as pushed successfully (admin)
    POST /inspections/push/<id>/failed        – Mark result push as failed (admin)

Legacy URL aliases kept for backward compatibility:
    GET  /inspections/outbox                  → same as /push-pending
    POST /inspections/outbox/<id>/sent        → same as /push/<id>/sent
    POST /inspections/outbox/<id>/failed      → same as /push/<id>/failed
"""

from datetime import datetime

from flask import Blueprint, jsonify, request

from app.flask.middleware.auth_middleware import require_auth, require_admin
from app.qc.inspection_repository import (
    list_inspection_results,
    get_inspection_result,
    list_push_pending,
    mark_push_sent,
    mark_push_failed,
)

inspection_blueprint = Blueprint("inspections", __name__, url_prefix="/inspections")


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


@inspection_blueprint.route("", methods=["GET"])
@require_auth
def handle_list_results():
    results = list_inspection_results(
        line_id=request.args.get("line_id") or None,
        part_name=request.args.get("part_name") or None,
        template_version_id=(
            int(request.args["template_version_id"])
            if request.args.get("template_version_id")
            else None
        ),
        decision_code=request.args.get("decision_code") or None,
        push_status=request.args.get("push_status") or None,
        from_dt=_parse_dt(request.args.get("from_dt")),
        to_dt=_parse_dt(request.args.get("to_dt")),
        limit=min(int(request.args.get("limit") or 100), 500),
        offset=int(request.args.get("offset") or 0),
    )
    return jsonify(results)


@inspection_blueprint.route("/<int:result_id>", methods=["GET"])
@require_auth
def handle_get_result(result_id: int):
    record = get_inspection_result(result_id)
    if not record:
        return jsonify({"error": "Inspection result tidak ditemukan"}), 404
    return jsonify(record)


# ── Push-queue endpoints ────────────────────────────────────────────────────

@inspection_blueprint.route("/push-pending", methods=["GET"])
@require_admin
def handle_list_push_pending():
    limit = min(int(request.args.get("limit") or 50), 200)
    rows = list_push_pending(limit=limit)
    return jsonify(rows)


@inspection_blueprint.route("/push/<int:result_id>/sent", methods=["POST"])
@require_admin
def handle_push_sent(result_id: int):
    mark_push_sent(result_id)
    return jsonify({"id": result_id, "push_status": "sent"})


@inspection_blueprint.route("/push/<int:result_id>/failed", methods=["POST"])
@require_admin
def handle_push_failed(result_id: int):
    payload = request.get_json(force=True) or {}
    error_msg = str(payload.get("error") or "Unknown error")
    mark_push_failed(result_id, error_msg)
    return jsonify({"id": result_id, "push_status": "failed"})


# ── Legacy /outbox aliases (backward compat) ───────────────────────────────

@inspection_blueprint.route("/outbox", methods=["GET"])
@require_admin
def handle_list_outbox_legacy():
    limit = min(int(request.args.get("limit") or 50), 200)
    rows = list_push_pending(limit=limit)
    return jsonify(rows)


@inspection_blueprint.route("/outbox/<int:result_id>/sent", methods=["POST"])
@require_admin
def handle_outbox_sent_legacy(result_id: int):
    mark_push_sent(result_id)
    return jsonify({"id": result_id, "push_status": "sent"})


@inspection_blueprint.route("/outbox/<int:result_id>/failed", methods=["POST"])
@require_admin
def handle_outbox_failed_legacy(result_id: int):
    payload = request.get_json(force=True) or {}
    error_msg = str(payload.get("error") or "Unknown error")
    mark_push_failed(result_id, error_msg)
    return jsonify({"id": result_id, "push_status": "failed"})
