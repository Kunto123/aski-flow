"""
SQL Server connection module for authentication.

Environment variables (tambahkan ke .env):
    MSSQL_SERVER    = localhost              (atau IP/hostname SQL Server)
    MSSQL_DATABASE  = askiflow_db
    MSSQL_USERNAME  = sa
    MSSQL_PASSWORD  = YourPassword123
    MSSQL_DRIVER    = ODBC Driver 17 for SQL Server   (default)

Pastikan pyodbc sudah terinstal:
    pip install pyodbc
"""

import os
from contextlib import contextmanager
from typing import Generator

import pyodbc


def _get_connection_string() -> str:
    driver   = os.getenv("MSSQL_DRIVER",   "ODBC Driver 17 for SQL Server")
    server   = os.getenv("MSSQL_SERVER",   "localhost")
    database = os.getenv("MSSQL_DATABASE", "askiflow_db")
    username = os.getenv("MSSQL_USERNAME", "sa")
    password = os.getenv("MSSQL_PASSWORD", "")
    return (
        f"DRIVER={{{driver}}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"UID={username};"
        f"PWD={password};"
        f"TrustServerCertificate=yes;"
        f"Connection Timeout=10;"
    )


def get_connection() -> pyodbc.Connection:
    conn = pyodbc.connect(_get_connection_string())
    conn.autocommit = False
    return conn


@contextmanager
def db_cursor() -> Generator[pyodbc.Cursor, None, None]:
    """Context manager yang otomatis commit/rollback dan close koneksi."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def row_to_dict(cursor: pyodbc.Cursor, row: pyodbc.Row) -> dict:
    """Konversi pyodbc Row ke dict menggunakan cursor.description."""
    return {col[0]: val for col, val in zip(cursor.description, row)}
