"""
Permission resolution utility.

Resolution order:
  1. Legacy admin short-circuit (role == 'admin' → all permissions granted).
     This preserves 100% backward compatibility for existing admin users.
  2. RBAC-aware check via app.qc.rbac_repository.has_rbac_permission().
     Falls back to aski_user_roles → aski_role_permissions tables.
     If user has no new-style roles, falls back to legacy role mapping.
  3. Legacy aski_operator_permissions table check (for 'operator' role).
     Kept for backward compatibility with existing template.manage / template.use keys.
"""

from app.storage.auth_db import db_cursor


def has_permission(user_id: str | int | None, role: str | None, permission_key: str) -> bool:
    # ── 1. Legacy admin short-circuit ──────────────────────────────────────
    if role == "admin":
        return True

    if not user_id or not permission_key:
        return False

    # ── 2. RBAC-aware check ─────────────────────────────────────────────────
    try:
        from app.qc.rbac_repository import has_rbac_permission
        if has_rbac_permission(user_id, role, permission_key):
            return True
    except Exception:
        # RBAC tables may not exist yet during initial migration; fall through.
        pass

    # ── 3. Legacy aski_operator_permissions table (operator role, old keys) ─
    with db_cursor() as cur:
        cur.execute(
            "SELECT is_allowed FROM aski_operator_permissions WHERE permission_key = ?",
            permission_key,
        )
        row = cur.fetchone()

    if not row:
        return False

    return bool(row[0])
