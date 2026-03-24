"""
RBAC Blueprint  –  /rbac

Endpoints:
    GET  /rbac/roles                         – List all roles
    GET  /rbac/users/<id>/roles              – List roles for a user
    POST /rbac/users/<id>/roles              – Assign role to user (admin only)
    DELETE /rbac/users/<id>/roles/<role>     – Revoke role from user (admin only)
    GET  /rbac/me/permissions                – Effective permissions for current user
"""

from flask import Blueprint, g, jsonify, request

from app.flask.middleware.auth_middleware import require_admin, require_auth
from app.qc.rbac_repository import (
    assign_user_role,
    list_roles,
    list_user_roles,
    resolve_user_permissions,
    revoke_user_role,
)

rbac_blueprint = Blueprint("rbac", __name__, url_prefix="/rbac")


@rbac_blueprint.route("/roles", methods=["GET"])
@require_auth
def handle_list_roles():
    return jsonify(list_roles())


@rbac_blueprint.route("/users/<int:user_id>/roles", methods=["GET"])
@require_admin
def handle_list_user_roles(user_id: int):
    return jsonify(list_user_roles(user_id))


@rbac_blueprint.route("/users/<int:user_id>/roles", methods=["POST"])
@require_admin
def handle_assign_role(user_id: int):
    payload = request.get_json(force=True) or {}
    role_name = str(payload.get("role_name") or "").strip()
    if not role_name:
        return jsonify({"error": "role_name wajib diisi"}), 400

    assign_user_role(user_id, role_name, assigned_by=int(g.user_id))
    return jsonify({"user_id": user_id, "role_name": role_name}), 201


@rbac_blueprint.route("/users/<int:user_id>/roles/<string:role_name>", methods=["DELETE"])
@require_admin
def handle_revoke_role(user_id: int, role_name: str):
    revoke_user_role(user_id, role_name)
    return jsonify({"user_id": user_id, "role_name": role_name, "revoked": True})


@rbac_blueprint.route("/me/permissions", methods=["GET"])
@require_auth
def handle_my_permissions():
    perms = resolve_user_permissions(g.user_id, g.role)
    return jsonify(sorted(perms))
