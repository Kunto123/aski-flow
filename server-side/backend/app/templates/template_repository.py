from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

from app.storage.auth_db import db_cursor, row_to_dict

RUNTIME_NODE_KEYS = {
    "outputData",
    "lastRun",
    "isDone",
    "isRunning",
    "startup_status",
    "startup_deferred",
    "error",
    "warning",
    "missingFields",
}

CANVAS_COORDINATE_KEYS = {
    "x",
    "y",
    "canvasX",
    "canvasY",
}

ROI_GEOMETRY_FIELDS = {
    "x",
    "y",
    "w",
    "h",
    "width",
    "height",
}


def ensure_template_schema() -> None:
    with db_cursor() as cur:
        cur.execute(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_flow_templates')
            BEGIN
                CREATE TABLE aski_flow_templates (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    name NVARCHAR(200) NOT NULL,
                    description NVARCHAR(1000) NULL,
                    is_active BIT NOT NULL DEFAULT 1,
                    current_version_id INT NULL,
                    created_by INT NULL,
                    updated_by INT NULL,
                    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
                    updated_at DATETIME2 NOT NULL DEFAULT GETDATE()
                );
            END
            """
        )
        cur.execute(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_flow_template_versions')
            BEGIN
                CREATE TABLE aski_flow_template_versions (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    template_id INT NOT NULL,
                    version_number INT NOT NULL,
                    flow_json NVARCHAR(MAX) NOT NULL,
                    policy_json NVARCHAR(MAX) NOT NULL,
                    flow_hash NVARCHAR(64) NOT NULL,
                    created_by INT NULL,
                    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
                    CONSTRAINT FK_aski_flow_template_versions_template
                        FOREIGN KEY (template_id) REFERENCES aski_flow_templates(id),
                    CONSTRAINT UQ_aski_flow_template_versions_template_version
                        UNIQUE (template_id, version_number)
                );
            END
            """
        )


def _serialize_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def _deserialize_json(value: Any, fallback: Any) -> Any:
    if value is None:
        return copy.deepcopy(fallback)
    if isinstance(value, (list, dict)):
        return copy.deepcopy(value)
    try:
        return json.loads(str(value))
    except Exception:
        return copy.deepcopy(fallback)


def _flow_hash(flow_definition: list[dict[str, Any]]) -> str:
    return hashlib.sha256(_serialize_json(flow_definition).encode("utf-8")).hexdigest()


def _extract_field_names(node_definition: dict[str, Any]) -> set[str]:
    config = node_definition.get("config") or {}
    fields = config.get("fields") or []
    field_names: set[str] = set()
    for field in fields:
        field_name = str((field or {}).get("name") or "").strip()
        if field_name:
            field_names.add(field_name)
    return field_names


def _sanitize_template_node(node_definition: dict[str, Any]) -> dict[str, Any]:
    normalized = copy.deepcopy(node_definition)
    for key in RUNTIME_NODE_KEYS:
        normalized.pop(key, None)
    return normalized


def normalize_flow_definition(flow_definition: Any) -> list[dict[str, Any]]:
    if not isinstance(flow_definition, list) or not flow_definition:
        raise ValueError("Flow template wajib berisi minimal satu node.")

    normalized_nodes: list[dict[str, Any]] = []
    node_names: set[str] = set()

    for raw_node in flow_definition:
        if not isinstance(raw_node, dict):
            raise ValueError("Format flow template tidak valid.")

        node_name = str(raw_node.get("name") or "").strip()
        processor_type = str(raw_node.get("processorType") or "").strip()
        if not node_name or not processor_type:
            raise ValueError("Setiap node template wajib memiliki name dan processorType.")
        if node_name in node_names:
            raise ValueError(f"Nama node template duplikat: '{node_name}'.")

        node_names.add(node_name)
        normalized_nodes.append(_sanitize_template_node(raw_node))

    return normalized_nodes


def normalize_template_policy(
    policy_definition: Any,
    flow_definition: list[dict[str, Any]],
) -> dict[str, Any]:
    raw_policy = policy_definition if isinstance(policy_definition, dict) else {}
    raw_nodes = raw_policy.get("nodes") if isinstance(raw_policy.get("nodes"), dict) else {}

    normalized_nodes: dict[str, dict[str, list[str]]] = {}
    for node_definition in flow_definition:
        node_name = str(node_definition["name"])
        allowed_field_names = _extract_field_names(node_definition)
        requested = raw_nodes.get(node_name) if isinstance(raw_nodes.get(node_name), dict) else {}
        editable_fields = requested.get("editableFields")
        if not isinstance(editable_fields, list):
            editable_fields = []

        normalized_editable_fields = sorted(
            {
                str(field_name).strip()
                for field_name in editable_fields
                if str(field_name).strip() in allowed_field_names
            }
        )
        normalized_nodes[node_name] = {
            "editableFields": normalized_editable_fields,
        }

    return {
        "graphLocked": True,
        "nodes": normalized_nodes,
    }


def _map_template_row(row: dict[str, Any]) -> dict[str, Any]:
    mapped = dict(row)
    mapped["is_active"] = bool(mapped.get("is_active"))
    mapped["flow"] = _deserialize_json(mapped.pop("flow_json", None), [])
    mapped["policy"] = _deserialize_json(mapped.pop("policy_json", None), {"graphLocked": True, "nodes": {}})
    mapped["inspection_recipe"] = _deserialize_json(mapped.pop("inspection_recipe_json", None), None)
    mapped["created_at"] = str(mapped.get("created_at")) if mapped.get("created_at") else None
    mapped["updated_at"] = str(mapped.get("updated_at")) if mapped.get("updated_at") else None
    mapped["version_created_at"] = (
        str(mapped.get("version_created_at")) if mapped.get("version_created_at") else None
    )
    return mapped


def list_templates(active_only: bool = True) -> list[dict[str, Any]]:
    with db_cursor() as cur:
        if active_only:
            cur.execute(
                """
                SELECT
                    t.id,
                    t.name,
                    t.description,
                    t.is_active,
                    t.created_by,
                    t.updated_by,
                    t.created_at,
                    t.updated_at,
                    v.id AS version_id,
                    v.version_number,
                    v.created_at AS version_created_at
                FROM aski_flow_templates t
                LEFT JOIN aski_flow_template_versions v ON v.id = t.current_version_id
                WHERE t.is_active = 1
                ORDER BY t.updated_at DESC, t.id DESC
                """
            )
        else:
            cur.execute(
                """
                SELECT
                    t.id,
                    t.name,
                    t.description,
                    t.is_active,
                    t.created_by,
                    t.updated_by,
                    t.created_at,
                    t.updated_at,
                    v.id AS version_id,
                    v.version_number,
                    v.created_at AS version_created_at
                FROM aski_flow_templates t
                LEFT JOIN aski_flow_template_versions v ON v.id = t.current_version_id
                ORDER BY t.updated_at DESC, t.id DESC
                """
            )
        rows = cur.fetchall()
        result = [row_to_dict(cur, row) for row in rows]

    for item in result:
        item["is_active"] = bool(item.get("is_active"))
        item["created_at"] = str(item.get("created_at")) if item.get("created_at") else None
        item["updated_at"] = str(item.get("updated_at")) if item.get("updated_at") else None
        item["version_created_at"] = (
            str(item.get("version_created_at")) if item.get("version_created_at") else None
        )

    return result


def get_template_detail(template_id: int) -> dict[str, Any] | None:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT
                t.id,
                t.name,
                t.description,
                t.is_active,
                t.created_by,
                t.updated_by,
                t.created_at,
                t.updated_at,
                v.id AS version_id,
                v.version_number,
                v.flow_json,
                v.policy_json,
                v.inspection_recipe_json,
                v.created_at AS version_created_at
            FROM aski_flow_templates t
            LEFT JOIN aski_flow_template_versions v ON v.id = t.current_version_id
            WHERE t.id = ?
            """,
            int(template_id),
        )
        row = cur.fetchone()

        if not row:
            return None

        return _map_template_row(row_to_dict(cur, row))


def get_template_version_detail(template_id: int, version_id: int | None = None) -> dict[str, Any] | None:
    with db_cursor() as cur:
        if version_id is None:
            cur.execute(
                """
                SELECT
                    t.id,
                    t.name,
                    t.description,
                    t.is_active,
                    t.created_by,
                    t.updated_by,
                    t.created_at,
                    t.updated_at,
                    v.id AS version_id,
                    v.version_number,
                    v.flow_json,
                    v.policy_json,
                    v.inspection_recipe_json,
                    v.created_at AS version_created_at
                FROM aski_flow_templates t
                INNER JOIN aski_flow_template_versions v ON v.id = t.current_version_id
                WHERE t.id = ?
                """,
                int(template_id),
            )
        else:
            cur.execute(
                """
                SELECT
                    t.id,
                    t.name,
                    t.description,
                    t.is_active,
                    t.created_by,
                    t.updated_by,
                    t.created_at,
                    t.updated_at,
                    v.id AS version_id,
                    v.version_number,
                    v.flow_json,
                    v.policy_json,
                    v.inspection_recipe_json,
                    v.created_at AS version_created_at
                FROM aski_flow_templates t
                INNER JOIN aski_flow_template_versions v ON v.template_id = t.id
                WHERE t.id = ? AND v.id = ?
                """,
                int(template_id),
                int(version_id),
            )
        row = cur.fetchone()
        if not row:
            return None

        return _map_template_row(row_to_dict(cur, row))


def _validate_inspection_recipe(recipe: Any) -> dict | None:
    """Basic structural validation for inspection recipe. Returns normalized recipe or None."""
    if recipe is None:
        return None
    if not isinstance(recipe, dict):
        raise ValueError("inspection_recipe harus berupa objek JSON.")
    targets = recipe.get("targets")
    if targets is not None and not isinstance(targets, list):
        raise ValueError("inspection_recipe.targets harus berupa array.")
    return recipe


def create_template(
    *,
    name: str,
    description: str,
    flow_definition: Any,
    policy_definition: Any,
    inspection_recipe: Any = None,
    created_by: int,
) -> dict[str, Any]:
    normalized_name = str(name or "").strip()
    if not normalized_name:
        raise ValueError("Nama template wajib diisi.")

    normalized_flow = normalize_flow_definition(flow_definition)
    normalized_policy = normalize_template_policy(policy_definition, normalized_flow)
    validated_recipe = _validate_inspection_recipe(inspection_recipe)
    flow_json = _serialize_json(normalized_flow)
    policy_json = _serialize_json(normalized_policy)
    recipe_json = _serialize_json(validated_recipe) if validated_recipe is not None else None

    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO aski_flow_templates (name, description, created_by, updated_by)
            OUTPUT INSERTED.id
            VALUES (?, ?, ?, ?)
            """,
            normalized_name,
            str(description or "").strip() or None,
            int(created_by),
            int(created_by),
        )
        template_id = int(cur.fetchone()[0])
        cur.execute(
            """
            INSERT INTO aski_flow_template_versions (
                template_id,
                version_number,
                flow_json,
                policy_json,
                flow_hash,
                created_by,
                inspection_recipe_json
            )
            OUTPUT INSERTED.id
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            template_id,
            1,
            flow_json,
            policy_json,
            _flow_hash(normalized_flow),
            int(created_by),
            recipe_json,
        )
        version_id = int(cur.fetchone()[0])
        cur.execute(
            """
            UPDATE aski_flow_templates
            SET current_version_id = ?, updated_by = ?, updated_at = GETDATE()
            WHERE id = ?
            """,
            version_id,
            int(created_by),
            template_id,
        )

    detail = get_template_version_detail(template_id, version_id)
    if not detail:
        raise RuntimeError("Template berhasil dibuat tetapi detail template gagal dimuat.")
    return detail


def update_template(
    *,
    template_id: int,
    name: str | None,
    description: str | None,
    flow_definition: Any | None,
    policy_definition: Any | None,
    inspection_recipe: Any = None,
    updated_by: int,
    is_active: bool | None = None,
) -> dict[str, Any]:
    current = get_template_detail(template_id)
    if not current:
        raise ValueError("Template tidak ditemukan.")

    next_name = str(name).strip() if name is not None else str(current.get("name") or "").strip()
    if not next_name:
        raise ValueError("Nama template wajib diisi.")

    next_description = (
        str(description).strip() if description is not None else str(current.get("description") or "").strip()
    )

    with db_cursor() as cur:
        cur.execute(
            """
            UPDATE aski_flow_templates
            SET
                name = ?,
                description = ?,
                is_active = COALESCE(?, is_active),
                updated_by = ?,
                updated_at = GETDATE()
            WHERE id = ?
            """,
            next_name,
            next_description or None,
            None if is_active is None else int(bool(is_active)),
            int(updated_by),
            int(template_id),
        )

    should_create_version = (
        flow_definition is not None
        or policy_definition is not None
        or inspection_recipe is not None
    )
    if should_create_version:
        base_flow = flow_definition if flow_definition is not None else current["flow"]
        base_policy = policy_definition if policy_definition is not None else current["policy"]
        base_recipe = inspection_recipe if inspection_recipe is not None else current.get("inspection_recipe")
        normalized_flow = normalize_flow_definition(base_flow)
        normalized_policy = normalize_template_policy(base_policy, normalized_flow)
        validated_recipe = _validate_inspection_recipe(base_recipe)
        flow_json = _serialize_json(normalized_flow)
        policy_json = _serialize_json(normalized_policy)
        recipe_json = _serialize_json(validated_recipe) if validated_recipe is not None else None
        next_version_number = int(current.get("version_number") or 0) + 1

        with db_cursor() as cur:
            cur.execute(
                """
                INSERT INTO aski_flow_template_versions (
                    template_id,
                    version_number,
                    flow_json,
                    policy_json,
                    flow_hash,
                    created_by,
                    inspection_recipe_json
                )
                OUTPUT INSERTED.id
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                int(template_id),
                next_version_number,
                flow_json,
                policy_json,
                _flow_hash(normalized_flow),
                int(updated_by),
                recipe_json,
            )
            version_id = int(cur.fetchone()[0])
            cur.execute(
                """
                UPDATE aski_flow_templates
                SET current_version_id = ?, updated_by = ?, updated_at = GETDATE()
                WHERE id = ?
                """,
                version_id,
                int(updated_by),
                int(template_id),
            )
        detail = get_template_version_detail(template_id, version_id)
    else:
        detail = get_template_detail(template_id)

    if not detail:
        raise RuntimeError("Template berhasil diperbarui tetapi detail template gagal dimuat.")
    return detail


def delete_template(*, template_id: int) -> bool:
    """Hard-delete a template and all its versions. Returns False if not found."""
    with db_cursor() as cur:
        cur.execute(
            "SELECT id FROM aski_flow_templates WHERE id = ?",
            int(template_id),
        )
        if not cur.fetchone():
            return False
        # Nullify FK before deleting versions to avoid FK constraint error
        cur.execute(
            "UPDATE aski_flow_templates SET current_version_id = NULL WHERE id = ?",
            int(template_id),
        )
        cur.execute(
            "DELETE FROM aski_flow_template_versions WHERE template_id = ?",
            int(template_id),
        )
        cur.execute(
            "DELETE FROM aski_flow_templates WHERE id = ?",
            int(template_id),
        )
    return True


def _canonicalize_node(node_definition: dict[str, Any]) -> dict[str, Any]:
    normalized = copy.deepcopy(node_definition)
    for key in list(normalized.keys()):
        if key in RUNTIME_NODE_KEYS:
            normalized.pop(key, None)
    for key in CANVAS_COORDINATE_KEYS:
        normalized.pop(key, None)
    return normalized


def _resolve_editable_fields(
    template_node: dict[str, Any],
    editable_fields: list[Any],
) -> set[str]:
    resolved = {
        str(field_name).strip()
        for field_name in editable_fields
        if str(field_name).strip()
    }

    processor_type = str(template_node.get("processorType") or "").strip().lower()
    if processor_type == "roi" and resolved.intersection(ROI_GEOMETRY_FIELDS):
        # ROI box interaction updates normalized geometry (`x/y/w/h`) together with
        # pixel dimensions (`width/height`). Treat them as one logical permission set
        # so operator edits from the visual ROI box do not violate template policy.
        resolved.update(ROI_GEOMETRY_FIELDS)

    return resolved


def validate_operator_flow(
    *,
    template_flow: list[dict[str, Any]],
    template_policy: dict[str, Any],
    submitted_flow: Any,
) -> None:
    normalized_submitted_flow = normalize_flow_definition(submitted_flow)

    template_nodes = {
        str(node["name"]): _canonicalize_node(node)
        for node in template_flow
    }
    submitted_nodes = {
        str(node["name"]): _canonicalize_node(node)
        for node in normalized_submitted_flow
    }

    if set(template_nodes.keys()) != set(submitted_nodes.keys()):
        raise ValueError("Graph template tidak boleh diubah oleh operator.")

    policy_nodes = template_policy.get("nodes") if isinstance(template_policy.get("nodes"), dict) else {}

    for node_name, template_node in template_nodes.items():
        submitted_node = submitted_nodes[node_name]
        node_policy = policy_nodes.get(node_name) if isinstance(policy_nodes.get(node_name), dict) else {}
        editable_fields = node_policy.get("editableFields") if isinstance(node_policy.get("editableFields"), list) else []
        resolved_editable_fields = _resolve_editable_fields(template_node, editable_fields)

        comparable_submitted_node = copy.deepcopy(submitted_node)
        for normalized_field_name in resolved_editable_fields:
            if normalized_field_name in template_node:
                comparable_submitted_node[normalized_field_name] = template_node[normalized_field_name]
            else:
                comparable_submitted_node.pop(normalized_field_name, None)

        if comparable_submitted_node != template_node:
            raise ValueError(
                f"Template policy violation pada node '{node_name}'. "
                "Operator hanya boleh mengubah field yang diizinkan."
            )
