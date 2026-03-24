"""
Inspection repository.

Writes inspection events + target results to SQL Server and enqueues
an outbox row for downstream push.

Fallback notes:
- rotation_deg / angle_deg: nullable; stored as NULL when model does not provide it.
- data2 (class_confidence): nullable; stored as NULL when model only yields one confidence.
  Callers document this explicitly in the StickerValidatorProcessor payload contract.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from app.storage.auth_db import db_cursor, row_to_dict


def write_inspection_result(
    *,
    deployment_id: int | None,
    template_version_id: int | None,
    line_id: str | None,
    station_id: str | None,
    part_name: str | None,
    decision: str,
    decision_code: str,
    reject_reason_code: str | None,
    mp_check: str | None,
    operator_id: int | None,
    targets: list[dict[str, Any]],
    data1: float | None = None,
    data2: float | None = None,
) -> int:
    """
    Insert one inspection event + its target results + an outbox row.
    Returns the new event_id.
    All writes are committed atomically (single db_cursor transaction).
    """
    with db_cursor() as cur:
        # ── 1. inspection_events ────────────────────────────────────────────
        cur.execute(
            """
            INSERT INTO aski_inspection_events (
                deployment_id, template_version_id, line_id, station_id,
                part_name, decision, decision_code, reject_reason_code,
                mp_check, operator_id
            )
            OUTPUT INSERTED.id
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            deployment_id,
            template_version_id,
            line_id,
            station_id,
            part_name,
            decision,
            decision_code,
            reject_reason_code,
            mp_check,
            operator_id,
        )
        event_id = int(cur.fetchone()[0])

        # ── 2. target results ───────────────────────────────────────────────
        for t in targets:
            cur.execute(
                """
                INSERT INTO aski_inspection_target_results (
                    event_id, target_id, part_name, expected_class, detected_class,
                    decision, decision_code, reject_reason_code,
                    data1, data2, pos_x, pos_y, offset_x, offset_y,
                    angle_deg, delta_angle_deg
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                event_id,
                t.get("target_id"),
                t.get("part_name"),
                t.get("expected_class"),
                t.get("detected_class"),
                t.get("decision"),
                t.get("decision_code"),
                t.get("reject_reason_code"),
                t.get("data1"),
                t.get("data2"),
                (t.get("position") or {}).get("x"),
                (t.get("position") or {}).get("y"),
                (t.get("offset") or {}).get("x"),
                (t.get("offset") or {}).get("y"),
                t.get("angle_deg"),
                t.get("delta_angle_deg"),
            )

        # ── 3. outbox row ───────────────────────────────────────────────────
        payload = {
            "event_id": event_id,
            "decision": decision,
            "decision_code": decision_code,
            "part_name": part_name,
            "line_id": line_id,
            "station_id": station_id,
            "template_version_id": template_version_id,
            "targets": targets,
        }
        cur.execute(
            """
            INSERT INTO aski_integration_outbox (
                event_id, part_name, mp_check, data1, data2,
                line, decision, decision_code, payload_json, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
            """,
            event_id,
            part_name,
            mp_check,
            data1,
            data2,
            line_id,
            decision,
            decision_code,
            json.dumps(payload, ensure_ascii=True),
        )

    return event_id


def list_inspection_events(
    *,
    line_id: str | None = None,
    part_name: str | None = None,
    template_version_id: int | None = None,
    decision_code: str | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    filters: list[str] = []
    params: list[Any] = []

    if line_id:
        filters.append("e.line_id = ?")
        params.append(line_id)
    if part_name:
        filters.append("e.part_name = ?")
        params.append(part_name)
    if template_version_id is not None:
        filters.append("e.template_version_id = ?")
        params.append(int(template_version_id))
    if decision_code:
        filters.append("e.decision_code = ?")
        params.append(decision_code)
    if from_dt:
        filters.append("e.inspected_at >= ?")
        params.append(from_dt)
    if to_dt:
        filters.append("e.inspected_at <= ?")
        params.append(to_dt)

    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    params.extend([limit, offset])

    with db_cursor() as cur:
        cur.execute(
            f"""
            SELECT
                e.id, e.deployment_id, e.template_version_id,
                e.line_id, e.station_id, e.part_name,
                e.decision, e.decision_code, e.reject_reason_code,
                e.mp_check, e.operator_id, e.inspected_at
            FROM aski_inspection_events e
            {where}
            ORDER BY e.inspected_at DESC
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
            """,
            *params,
        )
        rows = cur.fetchall()
        result = [row_to_dict(cur, r) for r in rows]

    for item in result:
        item["inspected_at"] = str(item["inspected_at"]) if item.get("inspected_at") else None

    return result


def get_inspection_event_with_targets(event_id: int) -> dict[str, Any] | None:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT
                e.id, e.deployment_id, e.template_version_id,
                e.line_id, e.station_id, e.part_name,
                e.decision, e.decision_code, e.reject_reason_code,
                e.mp_check, e.operator_id, e.inspected_at
            FROM aski_inspection_events e
            WHERE e.id = ?
            """,
            int(event_id),
        )
        row = cur.fetchone()
        if not row:
            return None
        event = row_to_dict(cur, row)
        event["inspected_at"] = str(event["inspected_at"]) if event.get("inspected_at") else None

        cur.execute(
            """
            SELECT *
            FROM aski_inspection_target_results
            WHERE event_id = ?
            ORDER BY id
            """,
            int(event_id),
        )
        rows = cur.fetchall()
        event["targets"] = [row_to_dict(cur, r) for r in rows]

    return event


def list_outbox_pending(limit: int = 50) -> list[dict[str, Any]]:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT id, event_id, part_name, date_check_mc, mp_check,
                   data1, data2, line, decision, decision_code,
                   payload_json, status, retry_count, last_error, created_at
            FROM aski_integration_outbox
            WHERE status = 'pending'
            ORDER BY created_at ASC
            OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY
            """,
            limit,
        )
        rows = cur.fetchall()
        result = [row_to_dict(cur, r) for r in rows]

    for item in result:
        for key in ("date_check_mc", "created_at", "processed_at"):
            if item.get(key):
                item[key] = str(item[key])

    return result


def mark_outbox_sent(outbox_id: int) -> None:
    with db_cursor() as cur:
        cur.execute(
            """
            UPDATE aski_integration_outbox
            SET status = 'sent', processed_at = GETDATE()
            WHERE id = ?
            """,
            int(outbox_id),
        )


def mark_outbox_failed(outbox_id: int, error: str) -> None:
    with db_cursor() as cur:
        cur.execute(
            """
            UPDATE aski_integration_outbox
            SET status = 'failed',
                retry_count = retry_count + 1,
                last_error = ?,
                processed_at = GETDATE()
            WHERE id = ?
            """,
            str(error)[:1000],
            int(outbox_id),
        )
