"""
Inspection Blueprint  –  /inspections

Endpoints:
    GET  /inspections              – List inspection events (with filters)
    GET  /inspections/<id>         – Get event detail with target results
    GET  /inspections/outbox       – List pending outbox rows
    POST /inspections/outbox/<id>/sent    – Mark outbox row as sent
    POST /inspections/outbox/<id>/failed  – Mark outbox row as failed
"""

from datetime import datetime

from flask import Blueprint, g, jsonify, request

from app.flask.middleware.auth_middleware import require_auth, require_admin
from app.qc.inspection_repository import (
    list_inspection_events,
    get_inspection_event_with_targets,
    list_outbox_pending,
    mark_outbox_sent,
    mark_outbox_failed,
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
def handle_list_events():
    events = list_inspection_events(
        line_id=request.args.get("line_id") or None,
        part_name=request.args.get("part_name") or None,
        template_version_id=(
            int(request.args["template_version_id"])
            if request.args.get("template_version_id")
            else None
        ),
        decision_code=request.args.get("decision_code") or None,
        from_dt=_parse_dt(request.args.get("from_dt")),
        to_dt=_parse_dt(request.args.get("to_dt")),
        limit=min(int(request.args.get("limit") or 100), 500),
        offset=int(request.args.get("offset") or 0),
    )
    return jsonify(events)


@inspection_blueprint.route("/<int:event_id>", methods=["GET"])
@require_auth
def handle_get_event(event_id: int):
    event = get_inspection_event_with_targets(event_id)
    if not event:
        return jsonify({"error": "Inspection event tidak ditemukan"}), 404
    return jsonify(event)


@inspection_blueprint.route("/outbox", methods=["GET"])
@require_admin
def handle_list_outbox():
    limit = min(int(request.args.get("limit") or 50), 200)
    rows = list_outbox_pending(limit=limit)
    return jsonify(rows)


@inspection_blueprint.route("/outbox/<int:outbox_id>/sent", methods=["POST"])
@require_admin
def handle_outbox_sent(outbox_id: int):
    mark_outbox_sent(outbox_id)
    return jsonify({"id": outbox_id, "status": "sent"})


@inspection_blueprint.route("/outbox/<int:outbox_id>/failed", methods=["POST"])
@require_admin
def handle_outbox_failed(outbox_id: int):
    payload = request.get_json(force=True) or {}
    error_msg = str(payload.get("error") or "Unknown error")
    mark_outbox_failed(outbox_id, error_msg)
    return jsonify({"id": outbox_id, "status": "failed"})
