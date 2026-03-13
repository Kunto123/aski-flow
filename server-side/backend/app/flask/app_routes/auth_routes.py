"""
Auth Blueprint  –  /auth/*

Endpoints:
    POST  /auth/login               – Login, kembalikan JWT
    GET   /auth/me                  – Info user yang sedang login
    GET   /auth/permissions         – Daftar semua permission (butuh login)
    PUT   /auth/permissions/<key>   – Toggle permission (hanya admin)
    POST  /auth/users               – Buat user baru (hanya admin)
    GET   /auth/users               – Daftar semua user (hanya admin)
    PUT   /auth/users/<id>          – Update user aktif/nonaktif (hanya admin)
"""

import datetime
import os

import bcrypt
import jwt
from flask import Blueprint, g, jsonify, request

from app.flask.middleware.auth_middleware import (
    JWT_ALGORITHM,
    JWT_SECRET_KEY,
    require_admin,
    require_auth,
)
from app.storage.auth_db import db_cursor, row_to_dict

auth_blueprint = Blueprint("auth", __name__, url_prefix="/auth")

_TOKEN_EXPIRY_HOURS = int(os.getenv("JWT_EXPIRY_HOURS", "8"))


# ---------------------------------------------------------------------------
# POST /auth/login
# ---------------------------------------------------------------------------
@auth_blueprint.route("/login", methods=["POST"])
def login():
    data     = request.get_json(force=True) or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "")

    if not username or not password:
        return jsonify({"error": "Username dan password wajib diisi"}), 400

    with db_cursor() as cur:
        cur.execute(
            "SELECT id, username, password_hash, role, is_active "
            "FROM aski_users WHERE username = ?",
            username,
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"error": "Username atau password salah"}), 401

        user = row_to_dict(cur, row)

    if not user["is_active"]:
        return jsonify({"error": "Akun Anda telah dinonaktifkan"}), 403

    if not bcrypt.checkpw(password.encode(), user["password_hash"].encode()):
        return jsonify({"error": "Username atau password salah"}), 401

    # Update last_login
    with db_cursor() as cur:
        cur.execute(
            "UPDATE aski_users SET last_login = GETDATE() WHERE id = ?",
            user["id"],
        )

    # Generate JWT
    now = datetime.datetime.utcnow()
    payload = {
        "sub":      str(user["id"]),
        "username": user["username"],
        "role":     user["role"],
        "iat":      now,
        "exp":      now + datetime.timedelta(hours=_TOKEN_EXPIRY_HOURS),
    }
    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)

    return jsonify({
        "token": token,
        "expires_in": _TOKEN_EXPIRY_HOURS * 3600,
        "user": {
            "id":       user["id"],
            "username": user["username"],
            "role":     user["role"],
        },
    })


# ---------------------------------------------------------------------------
# GET /auth/me
# ---------------------------------------------------------------------------
@auth_blueprint.route("/me", methods=["GET"])
@require_auth
def me():
    return jsonify({
        "id":       g.user_id,
        "username": g.username,
        "role":     g.role,
    })


# ---------------------------------------------------------------------------
# GET /auth/permissions
# ---------------------------------------------------------------------------
@auth_blueprint.route("/permissions", methods=["GET"])
@require_auth
def get_permissions():
    with db_cursor() as cur:
        cur.execute(
            "SELECT permission_key, label, description, is_allowed "
            "FROM aski_operator_permissions ORDER BY permission_key"
        )
        rows = cur.fetchall()
        permissions = [row_to_dict(cur, row) for row in rows]

    # Konversi BIT (0/1) ke bool agar JSON-nya benar
    for p in permissions:
        p["is_allowed"] = bool(p["is_allowed"])

    return jsonify(permissions)


# ---------------------------------------------------------------------------
# PUT /auth/permissions/<key>
# ---------------------------------------------------------------------------
@auth_blueprint.route("/permissions/<string:key>", methods=["PUT"])
@require_admin
def update_permission(key: str):
    data       = request.get_json(force=True) or {}
    is_allowed = bool(data.get("is_allowed", False))

    with db_cursor() as cur:
        cur.execute(
            "UPDATE aski_operator_permissions "
            "SET is_allowed = ?, updated_by = ?, updated_at = GETDATE() "
            "WHERE permission_key = ?",
            int(is_allowed),
            int(g.user_id),
            key,
        )
        if cur.rowcount == 0:
            return jsonify({"error": f"Permission '{key}' tidak ditemukan"}), 404

    return jsonify({"permission_key": key, "is_allowed": is_allowed})


# ---------------------------------------------------------------------------
# GET /auth/users  (admin only)
# ---------------------------------------------------------------------------
@auth_blueprint.route("/users", methods=["GET"])
@require_admin
def list_users():
    with db_cursor() as cur:
        cur.execute(
            "SELECT id, username, role, is_active, created_at, last_login "
            "FROM aski_users ORDER BY created_at"
        )
        rows  = cur.fetchall()
        users = [row_to_dict(cur, row) for row in rows]

    for u in users:
        u["is_active"]  = bool(u["is_active"])
        u["created_at"] = str(u["created_at"]) if u["created_at"] else None
        u["last_login"] = str(u["last_login"]) if u["last_login"]  else None

    return jsonify(users)


# ---------------------------------------------------------------------------
# POST /auth/users  (admin only) – buat user baru
# ---------------------------------------------------------------------------
@auth_blueprint.route("/users", methods=["POST"])
@require_admin
def create_user():
    data     = request.get_json(force=True) or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "")
    role     = (data.get("role") or "operator").strip()

    if not username or not password:
        return jsonify({"error": "Username dan password wajib diisi"}), 400

    if role not in ("admin", "operator"):
        return jsonify({"error": "Role harus 'admin' atau 'operator'"}), 400

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(12)).decode()

    try:
        with db_cursor() as cur:
            cur.execute(
                "INSERT INTO aski_users (username, password_hash, role) "
                "OUTPUT INSERTED.id VALUES (?, ?, ?)",
                username,
                hashed,
                role,
            )
            new_id = cur.fetchone()[0]
    except Exception as e:
        if "UNIQUE" in str(e) or "unique" in str(e) or "duplicate" in str(e).lower():
            return jsonify({"error": f"Username '{username}' sudah digunakan"}), 409
        raise

    return jsonify({"id": new_id, "username": username, "role": role}), 201


# ---------------------------------------------------------------------------
# PUT /auth/users/<id>  (admin only) – aktifkan/nonaktifkan user
# ---------------------------------------------------------------------------
@auth_blueprint.route("/users/<int:user_id>", methods=["PUT"])
@require_admin
def update_user(user_id: int):
    data      = request.get_json(force=True) or {}
    is_active = bool(data.get("is_active", True))

    with db_cursor() as cur:
        cur.execute(
            "UPDATE aski_users SET is_active = ? WHERE id = ?",
            int(is_active),
            user_id,
        )
        if cur.rowcount == 0:
            return jsonify({"error": "User tidak ditemukan"}), 404

    return jsonify({"id": user_id, "is_active": is_active})
