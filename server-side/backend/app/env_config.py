import os
import sys
from typing import List, Optional

ENV_LOCAL = "LOCAL"
ENV_CLOUD = "CLOUD"
CURRENT_ENV = os.environ.get("DEPLOYMENT_ENV", ENV_LOCAL)


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(CURRENT_DIR)


def _resolve_local_storage_dir() -> str:
    """Resolve local storage directory.

    Priority:
      1) STORAGE_PATH (recommended, e.g. ./storage)
      2) LOCAL_STORAGE_FOLDER_NAME (legacy)

    Relative paths are resolved from the backend package directory.
    """

    storage_env = (os.getenv("STORAGE_PATH") or "").strip()
    if storage_env:
        if os.path.isabs(storage_env):
            return storage_env
        return os.path.abspath(os.path.join(BACKEND_DIR, storage_env))

    legacy = os.getenv("LOCAL_STORAGE_FOLDER_NAME", "local_storage")
    return os.path.join(BACKEND_DIR, legacy)


LOCAL_STORAGE_DIR = _resolve_local_storage_dir()


def _env_flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() == "true"


def get_static_folder() -> str:
    if getattr(sys, "frozen", False):
        base_path = sys._MEIPASS
        build_dir = os.path.join(base_path, "build")
        return build_dir

    # Web static UI build is optional in native-client mode.
    # Keep legacy fallback paths for compatibility if a web bundle is provided.
    current_file_dir = os.path.dirname(os.path.abspath(__file__))
    candidate_paths = [
        os.path.abspath(os.path.join(current_file_dir, "..", "..", "ui", "build")),
        os.path.abspath(
            os.path.join(current_file_dir, "..", "..", "..", "packages", "ui", "build")
        ),
    ]

    for candidate in candidate_paths:
        if os.path.isdir(candidate):
            return candidate

    # Default to the new canonical path even if it does not exist yet.
    return candidate_paths[0]


def is_cloud_env() -> bool:
    return CURRENT_ENV == ENV_CLOUD


def is_local_environment() -> bool:
    return CURRENT_ENV == ENV_LOCAL


def is_mock_env() -> bool:
    return _env_flag("USE_MOCK")


def is_server_static_files_enabled() -> bool:
    return _env_flag("SERVE_STATIC_FILES")


def get_local_storage_folder_path() -> str:
    return LOCAL_STORAGE_DIR


def get_flask_secret_key() -> Optional[str]:
    return os.getenv("FLASK_SECRET_KEY")


def get_replicate_api_key() -> Optional[str]:
    return os.getenv("REPLICATE_API_KEY")


def get_background_task_max_workers() -> int:
    return int(os.getenv("BACKGROUND_TASK_MAX_WORKERS", "2"))


def use_async_browser() -> bool:
    return _env_flag("USE_ASYNC_BROWSER")


def get_browser_tab_max_usage() -> int:
    return int(os.getenv("BROWSER_TAB_MAX_USAGE", "100"))


def get_browser_tab_pool_size() -> int:
    return int(os.getenv("BROWSER_TAB_POOL_SIZE", "3"))


def is_set_app_config_on_ui_enabled() -> bool:
    return _env_flag("ENABLE_SET_APP_CONFIG_ON_UI", "true")


def is_cloud_features_enabled() -> bool:
    # Security baseline: cloud integrations are disabled by default.
    return _env_flag("ASKI_ENABLE_CLOUD", "false")


def is_native_webview2_devtools_enabled() -> bool:
    """
    Controls whether the DevTools button and keyboard shortcuts (F12 / Ctrl+Shift+I)
    are available in the native WinForms/WebView2 host.
    Reads ASKI_NATIVE_WEBVIEW2_DEVTOOLS from .env; defaults to true.
    """
    return _env_flag("ASKI_NATIVE_WEBVIEW2_DEVTOOLS", "true")


def is_s3_enabled() -> bool:
    # Enable S3 only if bucket is explicitly configured.
    # This avoids false positives when env vars exist but are empty strings.
    return bool((os.getenv("S3_BUCKET_NAME") or "").strip())
