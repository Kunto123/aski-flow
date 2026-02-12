from typing import Any

import os

from injector import singleton
from werkzeug.utils import secure_filename

from app.env_config import get_local_storage_folder_path

from ..storage.storage_strategy import StorageStrategy


@singleton
class LocalStorageStrategy(StorageStrategy):
    """Local storage strategy. To be used only when you're running the app on your own machine.
    Every generated image is saved in a local directory."""

    LOCAL_DIR = get_local_storage_folder_path()
    ASSETS_DIR = os.path.join(LOCAL_DIR, "assets")

    def save(self, filename: str, data: Any) -> str:
        # All local assets are stored under <STORAGE_PATH>/assets
        # (images, videos, audio, and generated files).
        if not os.path.exists(self.ASSETS_DIR):
            os.makedirs(self.ASSETS_DIR, exist_ok=True)

        secure_name = secure_filename(filename)
        filepath = os.path.join(self.ASSETS_DIR, secure_name)
        with open(filepath, "wb") as f:
            f.write(data)

        return self.get_url(secure_name)

    def get_url(self, filename: str) -> str:
        port = os.getenv("PORT")
        return f"http://localhost:{port}/asset/{filename}"

    def get_file(self, filename: str) -> bytes:
        secure_name = secure_filename(filename)
        filepath = os.path.join(self.ASSETS_DIR, secure_name)
        with open(filepath, "rb") as f:
            return f.read()
