"""
Inspection aggregate / counter bucket repository.

update_counter_bucket() is called from inspection_repository.write_inspection_result()
(or from InspectionDbWriterProcessor) after each inspection cycle.

Dashboard query supports granularity='hour' or 'day' aggregation.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.storage.auth_db import db_cursor, row_to_dict

_REJECT_REASON_COLUMN_MAP: dict[str, str] = {
    "NOT_FOUND":          "reject_not_found",
    "WRONG_TYPE":         "reject_wrong_type",
    "OUT_OF_POSITION":    "reject_out_of_position",
    "OUT_OF_ANGLE":       "reject_out_of_angle",
    "LOW_ROI_CONF":       "reject_low_conf",
    "LOW_CLASS_CONF":     "reject_low_conf",
    "ANGLE_UNAVAILABLE":  "reject_other",
}


def _bucket_time(dt: datetime, granularity: str) -> datetime:
    if granularity == "minute":
        return dt.replace(second=0, microsecond=0)
    if granularity == "hour":
        return dt.replace(minute=0, second=0, microsecond=0)
    # day
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


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
    """
    Upsert counter bucket row for the given time bucket.
    Increments total_inspections, total_accept or total_reject,
    and the specific reject breakdown column.
    """
    dt = at or datetime.now(timezone.utc)
    bt = _bucket_time(dt.replace(tzinfo=None), granularity)

    is_accept = 1 if decision.upper() == "ACCEPT" else 0
    is_reject = 0 if is_accept else 1

    reject_col = _REJECT_REASON_COLUMN_MAP.get(reject_reason_code or "", "reject_other")
    reject_inc = is_reject

    with db_cursor() as cur:
        # Try update first (common path)
        cur.execute(
            f"""
            UPDATE aski_inspection_counter_buckets
            SET
                total_inspections      = total_inspections + 1,
                total_accept           = total_accept + ?,
                total_reject           = total_reject + ?,
                {reject_col}           = {reject_col} + ?
            WHERE
                bucket_time = ? AND granularity = ?
                AND line_id = ?
                AND (template_version_id = ? OR (template_version_id IS NULL AND ? IS NULL))
                AND (part_name = ? OR (part_name IS NULL AND ? IS NULL))
            """,
            is_accept, is_reject, reject_inc,
            bt, granularity, line_id,
            template_version_id, template_version_id,
            part_name, part_name,
        )

        if cur.rowcount == 0:
            cur.execute(
                f"""
                INSERT INTO aski_inspection_counter_buckets (
                    bucket_time, granularity, line_id, template_version_id, part_name,
                    total_inspections, total_accept, total_reject, {reject_col}
                ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                bt, granularity, line_id, template_version_id, part_name,
                is_accept, is_reject, reject_inc,
            )


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
    """Return counter bucket rows for dashboard rendering."""
    filters: list[str] = ["granularity = ?"]
    params: list[Any] = [granularity]

    if line_id:
        filters.append("line_id = ?")
        params.append(line_id)
    if template_version_id is not None:
        filters.append("template_version_id = ?")
        params.append(int(template_version_id))
    if part_name:
        filters.append("part_name = ?")
        params.append(part_name)
    if from_dt:
        filters.append("bucket_time >= ?")
        params.append(from_dt.replace(tzinfo=None))
    if to_dt:
        filters.append("bucket_time <= ?")
        params.append(to_dt.replace(tzinfo=None))

    params.append(limit)

    with db_cursor() as cur:
        cur.execute(
            f"""
            SELECT
                id, bucket_time, granularity, line_id, template_version_id, part_name,
                total_inspections, total_accept, total_reject,
                reject_not_found, reject_wrong_type,
                reject_out_of_position, reject_out_of_angle,
                reject_low_conf, reject_other
            FROM aski_inspection_counter_buckets
            WHERE {' AND '.join(filters)}
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
    """Return aggregate totals for dashboard summary card."""
    filters: list[str] = ["granularity = 'hour'"]
    params: list[Any] = []

    if line_id:
        filters.append("line_id = ?")
        params.append(line_id)
    if from_dt:
        filters.append("bucket_time >= ?")
        params.append(from_dt.replace(tzinfo=None))
    if to_dt:
        filters.append("bucket_time <= ?")
        params.append(to_dt.replace(tzinfo=None))

    with db_cursor() as cur:
        cur.execute(
            f"""
            SELECT
                SUM(total_inspections)      AS total_inspections,
                SUM(total_accept)           AS total_accept,
                SUM(total_reject)           AS total_reject,
                SUM(reject_not_found)       AS reject_not_found,
                SUM(reject_wrong_type)      AS reject_wrong_type,
                SUM(reject_out_of_position) AS reject_out_of_position,
                SUM(reject_out_of_angle)    AS reject_out_of_angle,
                SUM(reject_low_conf)        AS reject_low_conf,
                SUM(reject_other)           AS reject_other
            FROM aski_inspection_counter_buckets
            WHERE {' AND '.join(filters)}
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
