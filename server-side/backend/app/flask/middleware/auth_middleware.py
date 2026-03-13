"""
JWT Authentication Middleware.

Decorator yang tersedia:
    @require_auth   - endpoint memerlukan login (admin atau operator)
    @require_admin  - endpoint hanya untuk admin

Contoh penggunaan:
    from app.flask.middleware.auth_middleware import require_auth, require_admin

    @blueprint.route("/data", methods=["GET"])
    @require_auth
    def get_data():
        # g.user_id, g.username, g.role tersedia di sini
        return jsonify({"user": g.username, "role": g.role})

    @blueprint.route("/admin-only", methods=["DELETE"])
    @require_admin
    def delete_something():
        ...
"""

import os
from functools import wraps

import jwt
from flask import g, jsonify, request

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-this-secret-key-in-production")
JWT_ALGORITHM  = "HS256"


def _parse_token() -> tuple[dict | None, tuple | None]:
    """
    Ekstrak dan validasi JWT dari header Authorization.
    Return: (payload, None) jika valid, atau (None, error_response) jika gagal.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None, (jsonify({"error": "Authorization header diperlukan"}), 401)

    token = auth_header[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload, None
    except jwt.ExpiredSignatureError:
        return None, (jsonify({"error": "Token sudah kedaluwarsa, silakan login kembali"}), 401)
    except jwt.InvalidTokenError:
        return None, (jsonify({"error": "Token tidak valid"}), 401)


def require_auth(f):
    """Decorator: endpoint hanya bisa diakses pengguna yang sudah login."""
    @wraps(f)
    def decorated(*args, **kwargs):
        payload, err = _parse_token()
        if err:
            return err
        g.user_id = payload["sub"]
        g.username = payload["username"]
        g.role = payload["role"]
        return f(*args, **kwargs)
    return decorated


def require_admin(f):
    """Decorator: endpoint hanya bisa diakses oleh admin."""
    @wraps(f)
    def decorated(*args, **kwargs):
        payload, err = _parse_token()
        if err:
            return err
        if payload.get("role") != "admin":
            return jsonify({"error": "Hanya admin yang dapat mengakses endpoint ini"}), 403
        g.user_id = payload["sub"]
        g.username = payload["username"]
        g.role = payload["role"]
        return f(*args, **kwargs)
    return decorated
