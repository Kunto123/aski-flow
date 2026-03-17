from app.storage.auth_db import db_cursor


def has_permission(user_id: str | int | None, role: str | None, permission_key: str) -> bool:
    if role == "admin":
        return True

    if not user_id or not permission_key:
        return False

    with db_cursor() as cur:
        cur.execute(
            "SELECT is_allowed FROM aski_operator_permissions WHERE permission_key = ?",
            permission_key,
        )
        row = cur.fetchone()

    if not row:
        return False

    return bool(row[0])
