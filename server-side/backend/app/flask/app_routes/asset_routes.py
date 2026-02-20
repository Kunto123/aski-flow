import os

from flask import Blueprint, send_from_directory

from app.env_config import get_local_storage_folder_path


asset_blueprint = Blueprint("asset_blueprint", __name__)


@asset_blueprint.route("/asset/<path:filename>")
def serve_asset(filename: str):
    """Serve any locally stored asset.

    Week-2 checkpoint: Local Storage v2
    - images / videos / audio are served through a single endpoint.

    Files are stored under: <STORAGE_PATH>/assets
    """

    assets_dir = os.path.join(get_local_storage_folder_path(), "assets")
    return send_from_directory(assets_dir, filename)
