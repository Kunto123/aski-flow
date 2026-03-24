"""
Template deployment repository.

Enforces single-active constraint per (line_id, station_id):
  - deactivate_deployment() closes the effective_until timestamp
  - deploy_template() deactivates any existing active deployment first
"""

from __future__ import annotations

from typing import Any

from app.storage.auth_db import db_cursor, row_to_dict


def deploy_template(
    *,
    template_id: int,
    template_version_id: int,
    line_id: str,
    station_id: str,
    deployed_by: int,
) -> dict[str, Any]:
    """
    Deactivate any existing active deployment for this line/station,
    then create a new active deployment. Returns the new deployment row.
    """
    with db_cursor() as cur:
        # Close previous active deployment
        cur.execute(
            """
            UPDATE aski_template_deployments
            SET is_active = 0, effective_until = GETDATE()
            WHERE line_id = ? AND station_id = ? AND is_active = 1
            """,
            line_id,
            station_id,
        )

        cur.execute(
            """
            INSERT INTO aski_template_deployments (
                template_id, template_version_id, line_id, station_id, deployed_by
            )
            OUTPUT INSERTED.id
            VALUES (?, ?, ?, ?, ?)
            """,
            int(template_id),
            int(template_version_id),
            line_id,
            station_id,
            int(deployed_by),
        )
        deployment_id = int(cur.fetchone()[0])

    return get_deployment(deployment_id)


def deactivate_deployment(deployment_id: int) -> bool:
    """Deactivate a specific deployment. Returns True if found."""
    with db_cursor() as cur:
        cur.execute(
            """
            UPDATE aski_template_deployments
            SET is_active = 0, effective_until = GETDATE()
            WHERE id = ? AND is_active = 1
            """,
            int(deployment_id),
        )
        return cur.rowcount > 0


def get_active_deployment(line_id: str, station_id: str) -> dict[str, Any] | None:
    """Return the active deployment for a line/station, or None."""
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT
                d.id, d.template_id, d.template_version_id,
                d.line_id, d.station_id, d.is_active,
                d.deployed_by, d.effective_from, d.effective_until, d.created_at,
                t.name AS template_name,
                v.version_number
            FROM aski_template_deployments d
            INNER JOIN aski_flow_templates t ON t.id = d.template_id
            INNER JOIN aski_flow_template_versions v ON v.id = d.template_version_id
            WHERE d.line_id = ? AND d.station_id = ? AND d.is_active = 1
            """,
            line_id,
            station_id,
        )
        row = cur.fetchone()
        if not row:
            return None
        return _map_row(row_to_dict(cur, row))


def get_deployment(deployment_id: int) -> dict[str, Any] | None:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT
                d.id, d.template_id, d.template_version_id,
                d.line_id, d.station_id, d.is_active,
                d.deployed_by, d.effective_from, d.effective_until, d.created_at,
                t.name AS template_name,
                v.version_number
            FROM aski_template_deployments d
            INNER JOIN aski_flow_templates t ON t.id = d.template_id
            INNER JOIN aski_flow_template_versions v ON v.id = d.template_version_id
            WHERE d.id = ?
            """,
            int(deployment_id),
        )
        row = cur.fetchone()
        if not row:
            return None
        return _map_row(row_to_dict(cur, row))


def list_deployments(
    line_id: str | None = None,
    active_only: bool = False,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []

    if line_id:
        clauses.append("d.line_id = ?")
        params.append(line_id)
    if active_only:
        clauses.append("d.is_active = 1")

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    with db_cursor() as cur:
        cur.execute(
            f"""
            SELECT
                d.id, d.template_id, d.template_version_id,
                d.line_id, d.station_id, d.is_active,
                d.deployed_by, d.effective_from, d.effective_until, d.created_at,
                t.name AS template_name,
                v.version_number
            FROM aski_template_deployments d
            INNER JOIN aski_flow_templates t ON t.id = d.template_id
            INNER JOIN aski_flow_template_versions v ON v.id = d.template_version_id
            {where}
            ORDER BY d.created_at DESC
            """,
            *params,
        )
        rows = cur.fetchall()
        return [_map_row(row_to_dict(cur, r)) for r in rows]


def _map_row(row: dict[str, Any]) -> dict[str, Any]:
    row["is_active"] = bool(row.get("is_active"))
    for key in ("effective_from", "effective_until", "created_at"):
        row[key] = str(row[key]) if row.get(key) else None
    return row
