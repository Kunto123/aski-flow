import logging
import os
import uuid

from flask import Blueprint, request
from werkzeug.utils import secure_filename

from ...root_injector import get_root_injector
from ...storage.storage_strategy import StorageStrategy

upload_blueprint = Blueprint("upload_blueprint", __name__)


@upload_blueprint.route("/upload", methods=["GET", "POST"])
def upload_file():
    """Upload handler.

    - CLOUD/S3 mode (legacy):
        GET /upload?filename=... -> returns presigned upload_data + download_link

    - LOCAL mode (Week-2):
        POST /upload (multipart/form-data, field: file) -> stores locally and
        returns download_link.
        GET /upload -> returns a small capability payload (so the UI can decide
        which upload flow to use).
    """

    storage_strategy = get_root_injector().get(StorageStrategy)

    # --- LOCAL upload (multipart) ---
    if request.method == "POST":
        if "file" not in request.files:
            return {"error": "Missing multipart field 'file'"}, 400

        f = request.files["file"]
        if not f or not getattr(f, "filename", ""):
            return {"error": "Empty file"}, 400

        # Keep original extension (for preview/rendering on UI)
        original_name = secure_filename(f.filename)
        _, ext = os.path.splitext(original_name)
        asset_filename = f"{uuid.uuid4().hex}{ext}" if ext else uuid.uuid4().hex

        # Save using the configured local storage strategy.
        # (LocalStorageStrategy stores everything in <STORAGE_PATH>/assets)
        download_link = storage_strategy.save(asset_filename, f.read())

        return {
            "upload_data": None,
            "download_link": download_link,
            "original_name": original_name,
            "asset_id": asset_filename,
        }

    # --- GET: S3 presign (cloud) OR local capability ---
    filename = request.args.get("filename")
    if hasattr(storage_strategy, "get_upload_link"):
        logging.info("Uploading file via presigned link")
        try:
            data = storage_strategy.get_upload_link(filename)
        except Exception as e:
            logging.error(e)
            raise Exception(
                "Error uploading file. "
                "Please check your S3 configuration. "
                "If you've not configured S3 please refer to docs.ai-flow.net/docs/file-upload"
            )

        return {
            "upload_data": data[0],
            "download_link": data[1],
        }

    # Local environment without S3: UI should use POST /upload.
    return {
        "upload_data": None,
        "download_link": None,
        "mode": "local",
    }
