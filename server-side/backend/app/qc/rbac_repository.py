"""
RBAC repository.

Resolution strategy:
  1. Check aski_user_roles → aski_role_permissions for the user's new-style roles.
  2. If no new-style roles assigned, fall back to the legacy aski_users.role column:
       'admin'    → super_admin permission set
       'operator' → operator permission set
  3. Global admin override: legacy role='admin' always returns True (same as before).

This ensures zero login breakage for existing users.
"""

from __future__ import annotations

from app.storage.auth_db import db_cursor, row_to_dict


# ── Legacy role → new permission set mapping ────────────────────────────────
_LEGACY_ROLE_PERMISSIONS: dict[str, set[str]] = {
    "admin": {
        "users.manage",
        "templates.manage",
        "templates.deploy",
        "templates.use",
        "inspection.view",
        "dashboard.view",
        "recipe.manage",
    },
    "operator": {
        "templates.use",
        "inspection.view",
    },
}


def resolve_user_permissions(user_id: int | str, legacy_role: str | None) -> set[str]:
    """
    Return the full set of permission keys for a user.
    Checks new RBAC tables first; falls back to legacy role mapping.
    """
    uid = int(user_id)

    with db_cursor() as cur:
        cur.execute(
            """
            SELECT rp.permission_key
            FROM aski_user_roles ur
            INNER JOIN aski_role_permissions rp ON rp.role_name = ur.role_name
            WHERE ur.user_id = ?
            """,
            uid,
        )
        rows = cur.fetchall()

    if rows:
        return {row[0] for row in rows}

    # Fall back to legacy role
    role = (legacy_role or "").strip().lower()
    return set(_LEGACY_ROLE_PERMISSIONS.get(role, set()))


def has_rbac_permission(
    user_id: int | str | None,
    legacy_role: str | None,
    permission_key: str,
) -> bool:
    """Check if a user has a specific permission (RBAC-aware + legacy fallback)."""
    # Legacy admin short-circuit (unchanged behaviour)
    if legacy_role == "admin":
        return True

    if not user_id:
        return False

    return permission_key in resolve_user_permissions(user_id, legacy_role)


def list_roles() -> list[dict]:
    with db_cursor() as cur:
        cur.execute("SELECT id, name, label, description FROM aski_roles ORDER BY id")
        rows = cur.fetchall()
        return [row_to_dict(cur, r) for r in rows]


def list_user_roles(user_id: int) -> list[str]:
    with db_cursor() as cur:
        cur.execute(
            "SELECT role_name FROM aski_user_roles WHERE user_id = ?",
            int(user_id),
        )
        return [row[0] for row in cur.fetchall()]


def assign_user_role(user_id: int, role_name: str, assigned_by: int) -> None:
    with db_cursor() as cur:
        cur.execute(
            """
            IF NOT EXISTS (
                SELECT 1 FROM aski_user_roles WHERE user_id = ? AND role_name = ?
            )
            BEGIN
                INSERT INTO aski_user_roles (user_id, role_name, assigned_by)
                VALUES (?, ?, ?)
            END
            """,
            int(user_id), role_name,
            int(user_id), role_name, int(assigned_by),
        )


def revoke_user_role(user_id: int, role_name: str) -> None:
    with db_cursor() as cur:
        cur.execute(
            "DELETE FROM aski_user_roles WHERE user_id = ? AND role_name = ?",
            int(user_id), role_name,
        )
