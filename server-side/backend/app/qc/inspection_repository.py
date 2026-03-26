"""
Inspection repository — aski_inspection_results (flat table, single source of truth).

Schema column contract:
  PartName            — part name string from validator recipe
  DateCheckMC         — inspection timestamp (DEFAULT GETDATE(), written by DB)
  MPCheck             — machine/process check identifier from validator config
  Data1               — aggregate ROI/object confidence across targets (avg of accepted)
  Data2               — aggregate class confidence (nullable; None when model is single-conf)
  Line                — line identifier from validator config
  decision            — 'ACCEPT' | 'REJECT'
  decision_code       — same as decision in current flows; kept for audit flexibility
  reject_reason_code  — first failing target's reject reason code (None if ACCEPT)
  targets_json        — JSON array of per-target detail from StickerValidatorProcessor
  push_status         — 'pending' | 'sent' | 'failed' (outbox inline)
  retry_count         — incremented on each failed push attempt
  last_error          — last push error message (truncated to 1000 chars)
  last_attempt_at     — timestamp of last push attempt
  pushed_at           — timestamp of successful push
  template_version_id — version of the template used (from validator config)
  operator_user_id    — user id of the operator (from flow config, optional)

Function rename log (Tahap 2):
  list_inspection_events          → list_inspection_results
  get_inspection_event_with_targets → get_inspection_result
  list_outbox_pending             → list_push_pending
  mark_outbox_sent                → mark_push_sent
  mark_outbox_failed              → mark_push_failed
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from app.storage.auth_db import db_cursor, row_to_dict


def write_inspection_result(
    *,
    template_version_id: int | None,
    line_id: str | None,
    part_name: str | None,
    decision: str,
    decision_code: str,
    reject_reason_code: str | None,
    mp_check: str | None,
    operator_user_id: int | None,
    targets: list[dict[str, Any]],
    data1: float | None = None,
    data2: float | None = None,
) -> int:
    """
    Insert one row into aski_inspection_results.
    Returns the new row id (used as inspection_result_id throughout the system).

    Data1 = aggregate ROI confidence from validator (avg of accepted targets).
    Data2 = aggregate class confidence (None when model yields single confidence score).
    targets = full per-target detail list serialised as JSON for audit/detail view.
    push_status defaults to 'pending' — downstream push worker reads via list_push_pending().
    """
    targets_json = json.dumps(targets, ensure_ascii=True)
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO aski_inspection_results (
                PartName, MPCheck, Data1, Data2, Line,
                decision, decision_code, reject_reason_code,
                targets_json, push_status,
                template_version_id, operator_user_id
            )
            OUTPUT INSERTED.id
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            """,
            part_name,
            mp_check,
            data1,
            data2,
            line_id,
            decision,
            decision_code,
            reject_reason_code,
            targets_json,
            template_version_id,
            operator_user_id,
        )
        return int(cur.fetchone()[0])


def list_inspection_results(
    *,
    line_id: str | None = None,
    part_name: str | None = None,
    template_version_id: int | None = None,
    decision_code: str | None = None,
    push_status: str | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """List inspection results with optional filters. Does not include targets_json."""
    filters: list[str] = []
    params: list[Any] = []

    if line_id:
        filters.append("Line = ?")
        params.append(line_id)
    if part_name:
        filters.append("PartName = ?")
        params.append(part_name)
    if template_version_id is not None:
        filters.append("template_version_id = ?")
        params.append(int(template_version_id))
    if decision_code:
        filters.append("decision_code = ?")
        params.append(decision_code)
    if push_status:
        filters.append("push_status = ?")
        params.append(push_status)
    if from_dt:
        filters.append("DateCheckMC >= ?")
        params.append(from_dt)
    if to_dt:
        filters.append("DateCheckMC <= ?")
        params.append(to_dt)

    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    params.extend([offset, limit])

    with db_cursor() as cur:
        cur.execute(
            f"""
            SELECT
                id,
                template_version_id,
                Line                AS line_id,
                PartName            AS part_name,
                MPCheck             AS mp_check,
                Data1               AS data1,
                Data2               AS data2,
                decision,
                decision_code,
                reject_reason_code,
                push_status,
                retry_count,
                operator_user_id,
                DateCheckMC         AS inspected_at
            FROM aski_inspection_results
            {where}
            ORDER BY DateCheckMC DESC
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
            """,
            *params,
        )
        rows = cur.fetchall()
        result = [row_to_dict(cur, r) for r in rows]

    for item in result:
        item["inspected_at"] = str(item["inspected_at"]) if item.get("inspected_at") else None

    return result


def get_inspection_result(result_id: int) -> dict[str, Any] | None:
    """Return full inspection result row including parsed targets array."""
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT
                id,
                template_version_id,
                Line                AS line_id,
                PartName            AS part_name,
                MPCheck             AS mp_check,
                Data1               AS data1,
                Data2               AS data2,
                decision,
                decision_code,
                reject_reason_code,
                push_status,
                retry_count,
                last_error,
                last_attempt_at,
                pushed_at,
                operator_user_id,
                DateCheckMC         AS inspected_at,
                targets_json
            FROM aski_inspection_results
            WHERE id = ?
            """,
            int(result_id),
        )
        row = cur.fetchone()
        if not row:
            return None
        record = row_to_dict(cur, row)

    record["inspected_at"] = str(record["inspected_at"]) if record.get("inspected_at") else None
    for ts_col in ("last_attempt_at", "pushed_at"):
        if record.get(ts_col):
            record[ts_col] = str(record[ts_col])

    raw_json = record.pop("targets_json", None)
    try:
        record["targets"] = json.loads(raw_json) if raw_json else []
    except Exception:
        record["targets"] = []

    return record


def list_push_pending(limit: int = 50) -> list[dict[str, Any]]:
    """Return inspection results with push_status = 'pending', ordered oldest-first."""
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT
                id,
                template_version_id,
                Line                AS line_id,
                PartName            AS part_name,
                MPCheck             AS mp_check,
                Data1               AS data1,
                Data2               AS data2,
                Line                AS line,
                decision,
                decision_code,
                reject_reason_code,
                targets_json,
                push_status,
                retry_count,
                last_error,
                DateCheckMC         AS date_check_mc,
                created_at
            FROM aski_inspection_results
            WHERE push_status = 'pending'
            ORDER BY created_at ASC
            OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY
            """,
            limit,
        )
        rows = cur.fetchall()
        result = [row_to_dict(cur, r) for r in rows]

    for item in result:
        for key in ("date_check_mc", "created_at"):
            if item.get(key):
                item[key] = str(item[key])

    return result


def mark_push_sent(result_id: int) -> None:
    """Mark an inspection result as successfully pushed."""
    with db_cursor() as cur:
        cur.execute(
            """
            UPDATE aski_inspection_results
            SET push_status     = 'sent',
                pushed_at       = GETDATE(),
                last_attempt_at = GETDATE()
            WHERE id = ?
            """,
            int(result_id),
        )


def mark_push_failed(result_id: int, error: str) -> None:
    """Record a failed push attempt; increments retry_count."""
    with db_cursor() as cur:
        cur.execute(
            """
            UPDATE aski_inspection_results
            SET push_status     = 'failed',
                retry_count     = retry_count + 1,
                last_error      = ?,
                last_attempt_at = GETDATE()
            WHERE id = ?
            """,
            str(error)[:1000],
            int(result_id),
        )
