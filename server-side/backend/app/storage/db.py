import os
import sqlite3
from pathlib import Path
from typing import Optional

_DATA_ROOT_ENV = "ASKI_DATA_ROOT"

def get_data_root() -> Path:
    root = os.getenv(_DATA_ROOT_ENV)
    if root:
        return Path(root).expanduser().resolve()
    # default: <repo>/data
    # backend/app/storage/db.py -> ../../..
    return (Path(__file__).resolve().parents[3] / "data").resolve()

def ensure_dirs() -> None:
    root = get_data_root()
    (root / "models").mkdir(parents=True, exist_ok=True)
    (root / "datasets").mkdir(parents=True, exist_ok=True)
    (root / "runs" / "training").mkdir(parents=True, exist_ok=True)

def get_db_path() -> Path:
    ensure_dirs()
    return get_data_root() / "app.db"

def connect() -> sqlite3.Connection:
    db_path = get_db_path()
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn

def init_db() -> None:
    ensure_dirs()
    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS models (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              task TEXT NOT NULL,
              runtime TEXT NOT NULL,
              path TEXT NOT NULL,
              created_at REAL NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS datasets (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              path TEXT NOT NULL,
              classes_json TEXT NOT NULL,
              created_at REAL NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS training_jobs (
              id TEXT PRIMARY KEY,
              dataset_id TEXT NOT NULL,
              base_model TEXT NOT NULL,
              status TEXT NOT NULL,
              log_path TEXT NOT NULL,
              output_model_id TEXT,
              architecture_family TEXT,
              architecture_variant TEXT,
              trained_model_path TEXT,
              params_json TEXT,
              started_at REAL,
              finished_at REAL,
              error_message TEXT,
              created_at REAL NOT NULL
            )
            """
        )
        _ensure_training_jobs_schema(conn)
        conn.commit()


def _ensure_training_jobs_schema(conn: sqlite3.Connection) -> None:
    """Best-effort migration for older local SQLite databases."""

    rows = conn.execute("PRAGMA table_info(training_jobs)").fetchall()
    existing = {str(row["name"]).lower() for row in rows}
    alter_statements = [
        ("architecture_family", "TEXT"),
        ("architecture_variant", "TEXT"),
        ("trained_model_path", "TEXT"),
        ("params_json", "TEXT"),
        ("started_at", "REAL"),
        ("finished_at", "REAL"),
        ("error_message", "TEXT"),
    ]

    for column_name, column_type in alter_statements:
        if column_name.lower() in existing:
            continue
        conn.execute(
            f"ALTER TABLE training_jobs ADD COLUMN {column_name} {column_type}"
        )
