"""
Permission resolution utility.

Simplified: only two roles exist (admin / operator).
Admin has all permissions; operator has none at the global level
(field-level access is enforced per-template via FlowTemplatePolicy).
"""


def has_permission(user_id: str | int | None, role: str | None, permission_key: str) -> bool:
    return role == "admin"
