from flask import Blueprint, g, jsonify, request

from app.flask.middleware.auth_middleware import require_admin, require_auth
from app.templates.template_repository import (
    create_template,
    delete_template,
    get_template_detail,
    list_templates,
    update_template,
)

template_blueprint = Blueprint("templates", __name__, url_prefix="/templates")


def _ensure_template_access() -> tuple[bool, tuple | None]:
    if g.role in {"admin", "operator"}:
        return True, None

    return False, (jsonify({"error": "Anda tidak memiliki izin untuk menggunakan template"}), 403)


@template_blueprint.route("", methods=["GET"])
@require_auth
def handle_list_templates():
    allowed, error = _ensure_template_access()
    if not allowed:
        return error

    include_inactive = request.args.get("include_inactive") == "1" and g.role == "admin"
    templates = list_templates(active_only=not include_inactive)
    return jsonify(templates)


@template_blueprint.route("/<int:template_id>", methods=["GET"])
@require_auth
def handle_get_template(template_id: int):
    allowed, error = _ensure_template_access()
    if not allowed:
        return error

    detail = get_template_detail(template_id)
    if not detail or (g.role != "admin" and not detail.get("is_active")):
        return jsonify({"error": "Template tidak ditemukan"}), 404
    return jsonify(detail)


@template_blueprint.route("", methods=["POST"])
@require_admin
def handle_create_template():
    payload = request.get_json(force=True) or {}
    try:
        detail = create_template(
            name=payload.get("name"),
            description=payload.get("description"),
            flow_definition=payload.get("flow"),
            policy_definition=payload.get("policy"),
            inspection_recipe=payload.get("inspection_recipe"),
            created_by=int(g.user_id),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(detail), 201


@template_blueprint.route("/<int:template_id>", methods=["PUT"])
@require_admin
def handle_update_template(template_id: int):
    payload = request.get_json(force=True) or {}
    try:
        detail = update_template(
            template_id=template_id,
            name=payload.get("name"),
            description=payload.get("description"),
            flow_definition=payload.get("flow"),
            policy_definition=payload.get("policy"),
            inspection_recipe=payload.get("inspection_recipe"),
            updated_by=int(g.user_id),
            is_active=payload.get("is_active"),
        )
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if "tidak ditemukan" in message.lower() else 400
        return jsonify({"error": message}), status_code
    return jsonify(detail)


@template_blueprint.route("/<int:template_id>", methods=["DELETE"])
@require_admin
def handle_delete_template(template_id: int):
    try:
        found = delete_template(template_id=template_id)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400
    if not found:
        return jsonify({"error": "Template tidak ditemukan"}), 404
    return "", 204
