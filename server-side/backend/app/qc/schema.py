"""
QC domain schema creation for SQL Server.

Call ensure_qc_schema() and ensure_rbac_schema() during application startup.
Both functions are idempotent: they skip table/column creation if already present.
"""

from __future__ import annotations

from app.storage.auth_db import db_cursor


def ensure_qc_schema() -> None:
    """Create all QC domain tables if they do not exist."""
    with db_cursor() as cur:

        # ── Template Deployments ────────────────────────────────────────────
        cur.execute(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_template_deployments')
            BEGIN
                CREATE TABLE aski_template_deployments (
                    id                  INT IDENTITY(1,1) PRIMARY KEY,
                    template_id         INT NOT NULL,
                    template_version_id INT NOT NULL,
                    line_id             NVARCHAR(100) NOT NULL,
                    station_id          NVARCHAR(100) NOT NULL,
                    is_active           BIT NOT NULL DEFAULT 1,
                    deployed_by         INT NULL,
                    effective_from      DATETIME2 NOT NULL DEFAULT GETDATE(),
                    effective_until     DATETIME2 NULL,
                    created_at          DATETIME2 NOT NULL DEFAULT GETDATE(),
                    CONSTRAINT FK_aski_template_deployments_template
                        FOREIGN KEY (template_id) REFERENCES aski_flow_templates(id)
                );
                CREATE INDEX IX_aski_template_deployments_line_station
                    ON aski_template_deployments (line_id, station_id, is_active);
            END
            """
        )

        # ── Inspection Events (one row per inspection cycle) ────────────────
        cur.execute(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_inspection_events')
            BEGIN
                CREATE TABLE aski_inspection_events (
                    id                  INT IDENTITY(1,1) PRIMARY KEY,
                    deployment_id       INT NULL,
                    template_version_id INT NULL,
                    line_id             NVARCHAR(100) NULL,
                    station_id          NVARCHAR(100) NULL,
                    part_name           NVARCHAR(200) NULL,
                    decision            NVARCHAR(20)  NOT NULL,   -- ACCEPT / REJECT
                    decision_code       NVARCHAR(50)  NOT NULL,
                    reject_reason_code  NVARCHAR(50)  NULL,
                    mp_check            NVARCHAR(200) NULL,
                    operator_id         INT NULL,
                    inspected_at        DATETIME2 NOT NULL DEFAULT GETDATE()
                );
                CREATE INDEX IX_aski_inspection_events_inspected_at
                    ON aski_inspection_events (inspected_at DESC);
                CREATE INDEX IX_aski_inspection_events_line_id
                    ON aski_inspection_events (line_id);
                CREATE INDEX IX_aski_inspection_events_part_name
                    ON aski_inspection_events (part_name);
                CREATE INDEX IX_aski_inspection_events_decision_code
                    ON aski_inspection_events (decision_code);
                CREATE INDEX IX_aski_inspection_events_template_version
                    ON aski_inspection_events (template_version_id);
            END
            """
        )

        # ── Inspection Target Results (one row per sticker target) ──────────
        cur.execute(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_inspection_target_results')
            BEGIN
                CREATE TABLE aski_inspection_target_results (
                    id                  INT IDENTITY(1,1) PRIMARY KEY,
                    event_id            INT NOT NULL,
                    target_id           NVARCHAR(100) NULL,
                    part_name           NVARCHAR(200) NULL,
                    expected_class      NVARCHAR(100) NULL,
                    detected_class      NVARCHAR(100) NULL,
                    decision            NVARCHAR(20)  NOT NULL,
                    decision_code       NVARCHAR(50)  NOT NULL,
                    reject_reason_code  NVARCHAR(50)  NULL,
                    data1               FLOAT NULL,    -- ROI confidence
                    data2               FLOAT NULL,    -- class confidence (nullable)
                    pos_x               FLOAT NULL,
                    pos_y               FLOAT NULL,
                    offset_x            FLOAT NULL,
                    offset_y            FLOAT NULL,
                    angle_deg           FLOAT NULL,
                    delta_angle_deg     FLOAT NULL,
                    CONSTRAINT FK_aski_inspection_target_results_event
                        FOREIGN KEY (event_id) REFERENCES aski_inspection_events(id)
                            ON DELETE CASCADE
                );
                CREATE INDEX IX_aski_inspection_target_results_event_id
                    ON aski_inspection_target_results (event_id);
            END
            """
        )

        # ── Integration Outbox ──────────────────────────────────────────────
        cur.execute(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_integration_outbox')
            BEGIN
                CREATE TABLE aski_integration_outbox (
                    id              INT IDENTITY(1,1) PRIMARY KEY,
                    event_id        INT NULL,
                    part_name       NVARCHAR(200) NULL,
                    date_check_mc   DATETIME2 NOT NULL DEFAULT GETDATE(),
                    mp_check        NVARCHAR(200) NULL,
                    data1           FLOAT NULL,
                    data2           FLOAT NULL,
                    line            NVARCHAR(100) NULL,
                    decision        NVARCHAR(20)  NOT NULL,
                    decision_code   NVARCHAR(50)  NOT NULL,
                    payload_json    NVARCHAR(MAX) NULL,
                    status          NVARCHAR(20)  NOT NULL DEFAULT 'pending',
                    retry_count     INT NOT NULL DEFAULT 0,
                    last_error      NVARCHAR(1000) NULL,
                    created_at      DATETIME2 NOT NULL DEFAULT GETDATE(),
                    processed_at    DATETIME2 NULL
                );
                CREATE INDEX IX_aski_integration_outbox_status
                    ON aski_integration_outbox (status, created_at);
                CREATE INDEX IX_aski_integration_outbox_date_check_mc
                    ON aski_integration_outbox (date_check_mc DESC);
                CREATE INDEX IX_aski_integration_outbox_line
                    ON aski_integration_outbox (line);
            END
            """
        )

        # ── Inspection Counter Buckets ──────────────────────────────────────
        cur.execute(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_inspection_counter_buckets')
            BEGIN
                CREATE TABLE aski_inspection_counter_buckets (
                    id                      INT IDENTITY(1,1) PRIMARY KEY,
                    bucket_time             DATETIME2 NOT NULL,
                    granularity             NVARCHAR(10) NOT NULL,  -- 'minute' | 'hour' | 'day'
                    line_id                 NVARCHAR(100) NOT NULL,
                    template_version_id     INT NULL,
                    part_name               NVARCHAR(200) NULL,
                    total_inspections       INT NOT NULL DEFAULT 0,
                    total_accept            INT NOT NULL DEFAULT 0,
                    total_reject            INT NOT NULL DEFAULT 0,
                    reject_not_found        INT NOT NULL DEFAULT 0,
                    reject_wrong_type       INT NOT NULL DEFAULT 0,
                    reject_out_of_position  INT NOT NULL DEFAULT 0,
                    reject_out_of_angle     INT NOT NULL DEFAULT 0,
                    reject_low_conf         INT NOT NULL DEFAULT 0,
                    reject_other            INT NOT NULL DEFAULT 0,
                    CONSTRAINT UQ_aski_inspection_counter_buckets
                        UNIQUE (bucket_time, granularity, line_id,
                                template_version_id, part_name)
                );
                CREATE INDEX IX_aski_inspection_counter_buckets_time
                    ON aski_inspection_counter_buckets (bucket_time DESC, granularity, line_id);
            END
            """
        )

def _migrate_add_recipe_column() -> None:
    """Add inspection_recipe_json column to aski_flow_template_versions if absent."""
    with db_cursor() as cur:
        cur.execute(
            """
            IF NOT EXISTS (
                SELECT 1
                FROM sys.columns
                WHERE object_id = OBJECT_ID('aski_flow_template_versions')
                  AND name = 'inspection_recipe_json'
            )
            BEGIN
                ALTER TABLE aski_flow_template_versions
                    ADD inspection_recipe_json NVARCHAR(MAX) NULL;
            END
            """
        )


def ensure_rbac_schema() -> None:
    """Create RBAC tables if they do not exist. Backward-compatible with legacy role column."""
    with db_cursor() as cur:

        cur.execute(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_roles')
            BEGIN
                CREATE TABLE aski_roles (
                    id          INT IDENTITY(1,1) PRIMARY KEY,
                    name        NVARCHAR(50) NOT NULL UNIQUE,
                    label       NVARCHAR(100) NOT NULL,
                    description NVARCHAR(500) NULL
                );
                INSERT INTO aski_roles (name, label, description) VALUES
                    ('super_admin',       'Super Admin',        'Full system access'),
                    ('process_engineer',  'Process Engineer',   'Manage templates and recipes'),
                    ('operator',          'Operator',           'Run templates in production'),
                    ('supervisor',        'Supervisor',         'View results and dashboard'),
                    ('viewer',            'Viewer',             'Read-only dashboard access');
            END
            """
        )

        cur.execute(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_permissions')
            BEGIN
                CREATE TABLE aski_permissions (
                    id              INT IDENTITY(1,1) PRIMARY KEY,
                    permission_key  NVARCHAR(100) NOT NULL UNIQUE,
                    label           NVARCHAR(200) NOT NULL,
                    description     NVARCHAR(500) NULL
                );
                INSERT INTO aski_permissions (permission_key, label) VALUES
                    ('users.manage',           'Manage Users'),
                    ('templates.manage',       'Manage Templates'),
                    ('templates.deploy',       'Deploy Templates'),
                    ('templates.use',          'Use Templates'),
                    ('inspection.view',        'View Inspection Results'),
                    ('dashboard.view',         'View Dashboard'),
                    ('recipe.manage',          'Manage Inspection Recipe');
            END
            """
        )

        cur.execute(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_role_permissions')
            BEGIN
                CREATE TABLE aski_role_permissions (
                    role_name       NVARCHAR(50) NOT NULL,
                    permission_key  NVARCHAR(100) NOT NULL,
                    PRIMARY KEY (role_name, permission_key)
                );
                -- super_admin: all permissions
                INSERT INTO aski_role_permissions (role_name, permission_key) VALUES
                    ('super_admin', 'users.manage'),
                    ('super_admin', 'templates.manage'),
                    ('super_admin', 'templates.deploy'),
                    ('super_admin', 'templates.use'),
                    ('super_admin', 'inspection.view'),
                    ('super_admin', 'dashboard.view'),
                    ('super_admin', 'recipe.manage'),
                    -- process_engineer
                    ('process_engineer', 'templates.manage'),
                    ('process_engineer', 'templates.deploy'),
                    ('process_engineer', 'templates.use'),
                    ('process_engineer', 'inspection.view'),
                    ('process_engineer', 'dashboard.view'),
                    ('process_engineer', 'recipe.manage'),
                    -- operator
                    ('operator', 'templates.use'),
                    ('operator', 'inspection.view'),
                    -- supervisor
                    ('supervisor', 'inspection.view'),
                    ('supervisor', 'dashboard.view'),
                    -- viewer
                    ('viewer', 'dashboard.view');
            END
            """
        )

        cur.execute(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_user_roles')
            BEGIN
                CREATE TABLE aski_user_roles (
                    user_id     INT NOT NULL,
                    role_name   NVARCHAR(50) NOT NULL,
                    assigned_by INT NULL,
                    assigned_at DATETIME2 NOT NULL DEFAULT GETDATE(),
                    PRIMARY KEY (user_id, role_name)
                );
            END
            """
        )

        cur.execute(
            """
            IF EXISTS (
                SELECT 1
                FROM sys.tables t
                INNER JOIN sys.columns c ON c.object_id = t.object_id
                WHERE t.name = 'aski_permissions'
                  AND c.name = 'key'
            )
            AND NOT EXISTS (
                SELECT 1
                FROM sys.tables t
                INNER JOIN sys.columns c ON c.object_id = t.object_id
                WHERE t.name = 'aski_permissions'
                  AND c.name = 'permission_key'
            )
            BEGIN
                EXEC sp_rename 'aski_permissions.[key]', 'permission_key', 'COLUMN';
            END
            """
        )


def ensure_inspection_results_schema() -> None:
    """Create aski_inspection_results table if not exists.

    Single flat table replacing the old normalized triple:
      aski_inspection_events + aski_inspection_target_results + aski_integration_outbox

    push_status / retry_count / last_error are stored inline so no separate
    outbox table is needed.  targets_json holds the per-target detail as JSON.
    """
    with db_cursor() as cur:
        cur.execute(
            """
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_inspection_results')
            BEGIN
                CREATE TABLE aski_inspection_results (
                    id                  INT IDENTITY(1,1) PRIMARY KEY,
                    PartName            NVARCHAR(200)  NULL,
                    DateCheckMC         DATETIME2      NOT NULL DEFAULT GETDATE(),
                    MPCheck             NVARCHAR(200)  NULL,
                    Data1               FLOAT          NULL,
                    Data2               FLOAT          NULL,
                    Line                NVARCHAR(100)  NULL,
                    decision            NVARCHAR(20)   NOT NULL,
                    decision_code       NVARCHAR(50)   NOT NULL,
                    reject_reason_code  NVARCHAR(50)   NULL,
                    targets_json        NVARCHAR(MAX)  NULL,
                    push_status         NVARCHAR(20)   NOT NULL DEFAULT 'pending',
                    retry_count         INT            NOT NULL DEFAULT 0,
                    last_error          NVARCHAR(1000) NULL,
                    last_attempt_at     DATETIME2      NULL,
                    pushed_at           DATETIME2      NULL,
                    created_at          DATETIME2      NOT NULL DEFAULT GETDATE(),
                    template_version_id INT            NULL,
                    operator_user_id    INT            NULL
                );
                CREATE INDEX IX_aski_inspection_results_DateCheckMC
                    ON aski_inspection_results (DateCheckMC DESC);
                CREATE INDEX IX_aski_inspection_results_Line
                    ON aski_inspection_results (Line);
                CREATE INDEX IX_aski_inspection_results_push_status
                    ON aski_inspection_results (push_status, DateCheckMC);
                CREATE INDEX IX_aski_inspection_results_template_ver
                    ON aski_inspection_results (template_version_id);
            END
            """
        )
