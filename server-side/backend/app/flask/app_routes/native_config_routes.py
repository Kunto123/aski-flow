"""
Native Config Blueprint  –  /native-config

Endpoints:
    GET  /native-config   – Public client-facing flags for the WinForms/WebView2 host.
                            No authentication required; only read-only .env flags are exposed.
"""

from flask import Blueprint, jsonify

from app.env_config import is_native_webview2_devtools_enabled

native_config_blueprint = Blueprint("native_config", __name__)


@native_config_blueprint.route("/native-config", methods=["GET"])
def get_native_config():
    """
    Returns client-facing config flags read from .env for the native host.
    The native WinForms/WebView2 client fetches this endpoint at canvas load time
    so that .env settings (e.g. ASKI_NATIVE_WEBVIEW2_DEVTOOLS) are honoured
    without requiring Windows-level environment variable configuration.
    """
    return jsonify({
        "devtools_enabled": is_native_webview2_devtools_enabled(),
    })
