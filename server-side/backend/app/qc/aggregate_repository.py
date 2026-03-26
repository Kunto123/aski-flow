"""
Inspection aggregate repository (live query version).

update_counter_bucket() is kept as a no-op for interface compatibility.
query_dashboard() and get_summary() now query aski_inspection_results directly
instead of the pre-aggregated aski_inspection_counter_buckets table.

Public signatures are unchanged so dashboard_routes.py needs no edits.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.storage.auth_db import db_cursor, row_to_dict

# SQL Server bucket truncation by granularity (DATEADD/DATEDIFF pattern,
# works on all SQL Server versions without DATETRUNC).
_BUCKET_SQL: dict[str, str] = {
    "minute": "DATEADD(MINUTE, DATEDIFF(MINUTE, 0, DateCheckMC), 0)",
    "hour":   "DATEADD(HOUR,   DATEDIFF(HOUR,   0, DateCheckMC), 0)",
    "day":    "DATEADD(DAY,    DATEDIFF(DAY,    0, DateCheckMC), 0)",
}


def update_counter_bucket(
    *,
    line_id: str,
    template_version_id: int | None,
    part_name: str | None,
    decision: str,
    reject_reason_code: str | None,
    granularity: str = "hour",
    at: datetime | None = None,
) -> None:
    """No-op: counter buckets are replaced by live GROUP BY on aski_inspection_results."""
    pass


def query_dashboard(
    *,
    line_id: str | None = None,
    template_version_id: int | None = None,
    part_name: str | None = None,
    granularity: str = "hour",
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Return time-bucketed aggregate rows from aski_inspection_results.

    Output shape matches the old aski_inspection_counter_buckets row format
    so the frontend requires no changes.
    """
    if granularity not in _BUCKET_SQL:
        granularity = "hour"
    bucket_expr = _BUCKET_SQL[granularity]

    filters: list[str] = []
    params: list[Any] = []

    if line_id:
        filters.append("Line = ?")
        params.append(line_id)
    if template_version_id is not None:
        filters.append("template_version_id = ?")
        params.append(int(template_version_id))
    if part_name:
        filters.append("PartName = ?")
        params.append(part_name)
    if from_dt:
        filters.append("DateCheckMC >= ?")
        params.append(from_dt.replace(tzinfo=None))
    if to_dt:
        filters.append("DateCheckMC <= ?")
        params.append(to_dt.replace(tzinfo=None))

    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    params.append(limit)

    with db_cursor() as cur:
        cur.execute(
            f"""
            SELECT
                {bucket_expr}                                               AS bucket_time,
                '{granularity}'                                             AS granularity,
                Line                                                        AS line_id,
                template_version_id,
                PartName                                                    AS part_name,
                COUNT(*)                                                    AS total_inspections,
                SUM(CASE WHEN decision = 'ACCEPT' THEN 1 ELSE 0 END)       AS total_accept,
                SUM(CASE WHEN decision = 'REJECT' THEN 1 ELSE 0 END)       AS total_reject,
                SUM(CASE WHEN reject_reason_code = 'NOT_FOUND'
                         THEN 1 ELSE 0 END)                                AS reject_not_found,
                SUM(CASE WHEN reject_reason_code = 'WRONG_TYPE'
                         THEN 1 ELSE 0 END)                                AS reject_wrong_type,
                SUM(CASE WHEN reject_reason_code = 'OUT_OF_POSITION'
                         THEN 1 ELSE 0 END)                                AS reject_out_of_position,
                SUM(CASE WHEN reject_reason_code = 'OUT_OF_ANGLE'
                         THEN 1 ELSE 0 END)                                AS reject_out_of_angle,
                SUM(CASE WHEN reject_reason_code IN ('LOW_ROI_CONF', 'LOW_CLASS_CONF')
                         THEN 1 ELSE 0 END)                                AS reject_low_conf,
                SUM(CASE WHEN reject_reason_code NOT IN (
                             'NOT_FOUND','WRONG_TYPE','OUT_OF_POSITION',
                             'OUT_OF_ANGLE','LOW_ROI_CONF','LOW_CLASS_CONF'
                         ) AND reject_reason_code IS NOT NULL
                         THEN 1 ELSE 0 END)                                AS reject_other
            FROM aski_inspection_results
            {where}
            GROUP BY
                {bucket_expr},
                Line,
                template_version_id,
                PartName
            ORDER BY bucket_time DESC
            OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY
            """,
            *params,
        )
        rows = cur.fetchall()
        result = [row_to_dict(cur, r) for r in rows]

    for item in result:
        item["bucket_time"] = str(item["bucket_time"]) if item.get("bucket_time") else None

    return result


def get_summary(
    *,
    line_id: str | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
) -> dict[str, Any]:
    """Return aggregate totals from aski_inspection_results."""
    filters: list[str] = []
    params: list[Any] = []

    if line_id:
        filters.append("Line = ?")
        params.append(line_id)
    if from_dt:
        filters.append("DateCheckMC >= ?")
        params.append(from_dt.replace(tzinfo=None))
    if to_dt:
        filters.append("DateCheckMC <= ?")
        params.append(to_dt.replace(tzinfo=None))

    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    with db_cursor() as cur:
        cur.execute(
            f"""
            SELECT
                COUNT(*)                                                    AS total_inspections,
                SUM(CASE WHEN decision = 'ACCEPT' THEN 1 ELSE 0 END)       AS total_accept,
                SUM(CASE WHEN decision = 'REJECT' THEN 1 ELSE 0 END)       AS total_reject,
                SUM(CASE WHEN reject_reason_code = 'NOT_FOUND'
                         THEN 1 ELSE 0 END)                                AS reject_not_found,
                SUM(CASE WHEN reject_reason_code = 'WRONG_TYPE'
                         THEN 1 ELSE 0 END)                                AS reject_wrong_type,
                SUM(CASE WHEN reject_reason_code = 'OUT_OF_POSITION'
                         THEN 1 ELSE 0 END)                                AS reject_out_of_position,
                SUM(CASE WHEN reject_reason_code = 'OUT_OF_ANGLE'
                         THEN 1 ELSE 0 END)                                AS reject_out_of_angle,
                SUM(CASE WHEN reject_reason_code IN ('LOW_ROI_CONF', 'LOW_CLASS_CONF')
                         THEN 1 ELSE 0 END)                                AS reject_low_conf,
                SUM(CASE WHEN reject_reason_code NOT IN (
                             'NOT_FOUND','WRONG_TYPE','OUT_OF_POSITION',
                             'OUT_OF_ANGLE','LOW_ROI_CONF','LOW_CLASS_CONF'
                         ) AND reject_reason_code IS NOT NULL
                         THEN 1 ELSE 0 END)                                AS reject_other
            FROM aski_inspection_results
            {where}
            """,
            *params,
        )
        row = cur.fetchone()
        if not row or row[0] is None:
            return {k: 0 for k in [
                "total_inspections", "total_accept", "total_reject",
                "reject_not_found", "reject_wrong_type",
                "reject_out_of_position", "reject_out_of_angle",
                "reject_low_conf", "reject_other",
            ]}
        return row_to_dict(cur, row)
