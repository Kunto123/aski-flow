"""
Template Deployment Blueprint  –  /deployments

Endpoints:
    POST   /deployments                         – Deploy template version to line/station (admin)
    GET    /deployments                         – List deployments (admin)
    GET    /deployments/active                  – Get active deployment by ?line_id&station_id
    DELETE /deployments/<id>                    – Deactivate a deployment (admin)
"""

from flask import Blueprint, g, jsonify, request

from app.flask.middleware.auth_middleware import require_admin, require_auth
from app.qc.deployment_repository import (
    deploy_template,
    deactivate_deployment,
    get_active_deployment,
    list_deployments,
)

deployment_blueprint = Blueprint("deployments", __name__, url_prefix="/deployments")


@deployment_blueprint.route("", methods=["POST"])
@require_admin
def handle_deploy():
    payload = request.get_json(force=True) or {}
    required = ("template_id", "template_version_id", "line_id", "station_id")
    missing = [k for k in required if not payload.get(k)]
    if missing:
        return jsonify({"error": f"Field wajib diisi: {', '.join(missing)}"}), 400

    try:
        deployment = deploy_template(
            template_id=int(payload["template_id"]),
            template_version_id=int(payload["template_version_id"]),
            line_id=str(payload["line_id"]).strip(),
            station_id=str(payload["station_id"]).strip(),
            deployed_by=int(g.user_id),
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(deployment), 201


@deployment_blueprint.route("", methods=["GET"])
@require_auth
def handle_list_deployments():
    if g.role not in ("admin",):
        return jsonify({"error": "Akses ditolak"}), 403

    line_id = request.args.get("line_id") or None
    active_only = request.args.get("active_only") == "1"
    deployments = list_deployments(line_id=line_id, active_only=active_only)
    return jsonify(deployments)


@deployment_blueprint.route("/active", methods=["GET"])
@require_auth
def handle_get_active_deployment():
    line_id = (request.args.get("line_id") or "").strip()
    station_id = (request.args.get("station_id") or "").strip()
    if not line_id or not station_id:
        return jsonify({"error": "Parameter line_id dan station_id wajib diisi"}), 400

    deployment = get_active_deployment(line_id, station_id)
    if not deployment:
        return jsonify({"deployment": None}), 200

    return jsonify(deployment)


@deployment_blueprint.route("/<int:deployment_id>", methods=["DELETE"])
@require_admin
def handle_deactivate_deployment(deployment_id: int):
    found = deactivate_deployment(deployment_id)
    if not found:
        return jsonify({"error": "Deployment tidak ditemukan atau sudah tidak aktif"}), 404
    return jsonify({"id": deployment_id, "is_active": False})
