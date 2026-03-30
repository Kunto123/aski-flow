"""
SQL Server connection module for authentication.

Environment variables (tambahkan ke .env):
    MSSQL_SERVER           = localhost              (atau IP/hostname SQL Server)
    MSSQL_DATABASE         = askiflow_db
    MSSQL_USERNAME         = sa
    MSSQL_PASSWORD         = YourPassword123
    MSSQL_DRIVER           = ODBC Driver 17 for SQL Server   (default)
    MSSQL_CONNECT_TIMEOUT  = 10                              (TCP connect timeout, seconds)
    MSSQL_QUERY_TIMEOUT    = 30                              (statement timeout, seconds; 0 = no limit)

Pastikan pyodbc sudah terinstal:
    pip install pyodbc
"""

import logging
import os
import time
from contextlib import contextmanager
from typing import Generator

import pyodbc

logger = logging.getLogger(__name__)


# ── Stage-aware exceptions ──────────────────────────────────────────────────────
class DbConnectError(RuntimeError):
    """Connection phase failed (network unreachable, auth error, driver error)."""


class DbCommitError(RuntimeError):
    """Commit phase failed after execute succeeded."""


# ── Timeout helpers ─────────────────────────────────────────────────────────────
def _get_connect_timeout() -> int:
    try:
        return max(1, int(os.getenv("MSSQL_CONNECT_TIMEOUT", "10")))
    except (ValueError, TypeError):
        return 10


def _get_query_timeout() -> int:
    """Statement-level timeout in seconds. 0 = no limit (not recommended)."""
    try:
        return max(0, int(os.getenv("MSSQL_QUERY_TIMEOUT", "30")))
    except (ValueError, TypeError):
        return 30


def _get_connection_string() -> str:
    driver          = os.getenv("MSSQL_DRIVER",   "ODBC Driver 17 for SQL Server")
    server          = os.getenv("MSSQL_SERVER",   "localhost")
    database        = os.getenv("MSSQL_DATABASE", "askiflow_db")
    username        = os.getenv("MSSQL_USERNAME", "sa")
    password        = os.getenv("MSSQL_PASSWORD", "")
    connect_timeout = _get_connect_timeout()
    return (
        f"DRIVER={{{driver}}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"UID={username};"
        f"PWD={password};"
        f"TrustServerCertificate=yes;"
        f"Connection Timeout={connect_timeout};"
    )


def get_connection() -> pyodbc.Connection:
    """Open a new pyodbc connection.  Raises DbConnectError on failure."""
    t0 = time.perf_counter()
    try:
        conn = pyodbc.connect(_get_connection_string())
    except pyodbc.Error as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        logger.error("[auth_db] connect FAILED after %.0fms: %s", elapsed_ms, exc)
        raise DbConnectError(
            f"DB connect failed after {elapsed_ms:.0f}ms: {exc}"
        ) from exc
    elapsed_ms = (time.perf_counter() - t0) * 1000
    if elapsed_ms > 200:
        logger.warning("[auth_db] slow connect: %.0fms (server=%s)",
                       elapsed_ms, os.getenv("MSSQL_SERVER", "localhost"))
    else:
        logger.debug("[auth_db] connect OK in %.0fms", elapsed_ms)
    conn.autocommit = False
    return conn


@contextmanager
def db_cursor() -> Generator[pyodbc.Cursor, None, None]:
    """Context manager that auto-commits/rollbacks and closes the connection.

    Timeouts (configurable via .env):
      MSSQL_CONNECT_TIMEOUT  — TCP connect timeout in seconds (default: 10)
      MSSQL_QUERY_TIMEOUT    — Statement execution timeout in seconds (default: 30)
                               Set to 0 to disable (not recommended for production).

    Note: query timeout is set via conn.timeout (pyodbc.Connection attribute), NOT
    cur.timeout — pyodbc.Cursor does not expose a timeout attribute in pyodbc >= 5.x.
    conn.timeout sets SQL_ATTR_QUERY_TIMEOUT at connection level and applies to all
    cursors created from it; raises pyodbc.OperationalError if a statement exceeds it.

    Raises:
      DbConnectError  — raised when pyodbc.connect() fails
      DbCommitError   — raised when conn.commit() fails
      pyodbc.Error    — raised when cur.execute() times out or fails
    """
    query_timeout = _get_query_timeout()
    conn = get_connection()  # may raise DbConnectError before entering try
    try:
        if query_timeout > 0:
            # conn.timeout sets SQL_ATTR_QUERY_TIMEOUT at connection level;
            # applies to all cursors — pyodbc.Cursor has no .timeout attribute.
            conn.timeout = query_timeout
        cur = conn.cursor()
        yield cur
        # ── Commit phase ─────────────────────────────────────────────────────
        _t = time.perf_counter()
        try:
            conn.commit()
        except pyodbc.Error as exc:
            _ms = (time.perf_counter() - _t) * 1000
            logger.error("[auth_db] commit FAILED after %.0fms: %s", _ms, exc)
            raise DbCommitError(
                f"DB commit failed after {_ms:.0f}ms: {exc}"
            ) from exc
        _ms = (time.perf_counter() - _t) * 1000
        if _ms > 200:
            logger.warning("[auth_db] slow commit: %.0fms", _ms)
        else:
            logger.debug("[auth_db] commit OK in %.0fms", _ms)
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            conn.close()
        except Exception:
            pass


def row_to_dict(cursor: pyodbc.Cursor, row: pyodbc.Row) -> dict:
    """Konversi pyodbc Row ke dict menggunakan cursor.description."""
    return {col[0]: val for col, val in zip(cursor.description, row)}
