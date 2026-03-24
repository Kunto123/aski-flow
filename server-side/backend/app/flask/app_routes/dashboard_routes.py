"""
Dashboard / Aggregates Blueprint  –  /dashboard

Endpoints:
    GET /dashboard/summary     – High-level totals
    GET /dashboard/buckets     – Time-series counter bucket rows
"""

from datetime import datetime

from flask import Blueprint, jsonify, request

from app.flask.middleware.auth_middleware import require_auth
from app.qc.aggregate_repository import query_dashboard, get_summary

dashboard_blueprint = Blueprint("dashboard", __name__, url_prefix="/dashboard")


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


@dashboard_blueprint.route("/summary", methods=["GET"])
@require_auth
def handle_summary():
    summary = get_summary(
        line_id=request.args.get("line_id") or None,
        from_dt=_parse_dt(request.args.get("from_dt")),
        to_dt=_parse_dt(request.args.get("to_dt")),
    )
    return jsonify(summary)


@dashboard_blueprint.route("/buckets", methods=["GET"])
@require_auth
def handle_buckets():
    granularity = request.args.get("granularity") or "hour"
    if granularity not in ("minute", "hour", "day"):
        granularity = "hour"

    buckets = query_dashboard(
        line_id=request.args.get("line_id") or None,
        template_version_id=(
            int(request.args["template_version_id"])
            if request.args.get("template_version_id")
            else None
        ),
        part_name=request.args.get("part_name") or None,
        granularity=granularity,
        from_dt=_parse_dt(request.args.get("from_dt")),
        to_dt=_parse_dt(request.args.get("to_dt")),
        limit=min(int(request.args.get("limit") or 200), 1000),
    )
    return jsonify(buckets)
