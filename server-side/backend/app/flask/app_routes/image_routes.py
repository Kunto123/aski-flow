import os

from app.env_config import get_local_storage_folder_path
from flask import Blueprint, send_from_directory

image_blueprint = Blueprint('image_blueprint', __name__)

@image_blueprint.route("/image/<path:filename>")
def serve_image(filename):
    """
        Backward compatible route. Historically, AI-FLOW served only images
        via /image/<filename>. Since Week-2 we serve *all* assets via
        /asset/<filename> (images/videos/audio). This route keeps old flows
        working.
    """
    assets_dir = os.path.join(get_local_storage_folder_path(), "assets")
    return send_from_directory(assets_dir, filename)