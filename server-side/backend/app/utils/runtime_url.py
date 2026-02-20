import os
from typing import Optional

from flask import has_request_context, request


def _is_unspecified_host(host: Optional[str]) -> bool:
    normalized = (host or "").strip().lower()
    return normalized in {"", "0.0.0.0", "::", "[::]"}


def _uses_https() -> bool:
    return (os.getenv("USE_HTTPS") or "false").strip().lower() == "true"


def _normalize_base_url(value: Optional[str]) -> Optional[str]:
    raw = (value or "").strip().rstrip("/")
    if not raw:
        return None
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    protocol = "https" if _uses_https() else "http"
    return f"{protocol}://{raw}"


def _request_base_url() -> Optional[str]:
    if not has_request_context():
        return None

    scheme = (request.headers.get("X-Forwarded-Proto") or request.scheme or "http")
    scheme = scheme.split(",", 1)[0].strip() or "http"

    host = (request.headers.get("X-Forwarded-Host") or request.host or "").split(",", 1)[0].strip()
    if not host:
        return None

    return f"{scheme}://{host}".rstrip("/")


def resolve_public_base_url(default_host: str = "127.0.0.1", default_port: str = "8000") -> str:
    env_url = _normalize_base_url(
        os.getenv("BACKEND_PUBLIC_BASE_URL") or os.getenv("PUBLIC_BASE_URL")
    )
    if env_url:
        return env_url

    req_url = _request_base_url()
    if req_url:
        return req_url

    host = os.getenv("BACKEND_PUBLIC_HOST") or os.getenv("PUBLIC_HOST")
    if _is_unspecified_host(host):
        host = None

    if not host:
        bind_host = os.getenv("BACKEND_HOST") or os.getenv("HOST")
        if not _is_unspecified_host(bind_host):
            host = bind_host

    host = (host or default_host).strip()

    if host.startswith("http://") or host.startswith("https://"):
        return host.rstrip("/")

    port = (
        os.getenv("BACKEND_PUBLIC_PORT")
        or os.getenv("PUBLIC_PORT")
        or os.getenv("BACKEND_PORT")
        or os.getenv("PORT")
        or str(default_port)
    )
    protocol = "https" if _uses_https() else "http"

    if ":" in host and not host.startswith("[") and host.count(":") > 1:
        host = f"[{host}]"

    return f"{protocol}://{host}:{port}".rstrip("/")
