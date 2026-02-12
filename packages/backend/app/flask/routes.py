import logging
import os

from app.env_config import (
    get_static_folder,
    is_local_environment,
    is_server_static_files_enabled,
)
from app.flask.socketio_init import flask_app
from .utils.constants import HTTP_OK


@flask_app.route("/healthcheck", methods=["GET"])
def healthcheck():
    return "OK", HTTP_OK


@flask_app.route("/health", methods=["GET"])
def health():
    # JSON health endpoint (used by the week-1 local/offline checklist)
    return {"status": "ok"}, HTTP_OK


from .app_routes.node_routes import node_blueprint

flask_app.register_blueprint(node_blueprint)

from .app_routes.upload_routes import upload_blueprint

flask_app.register_blueprint(upload_blueprint)

if is_server_static_files_enabled():
    # Only register static UI serving if the build folder exists.
    static_folder = get_static_folder()
    if os.path.isdir(static_folder):
        from .app_routes.static_routes import static_blueprint

        logging.info("Static UI serving enabled")
        flask_app.register_blueprint(static_blueprint)
    else:
        logging.warning(
            "SERVE_STATIC_FILES=true but UI build folder is missing: %s. Skipping static blueprint.",
            static_folder,
        )

if is_local_environment():
    from .app_routes.asset_routes import asset_blueprint
    from .app_routes.image_routes import image_blueprint

    logging.info("Environment set to LOCAL")
    flask_app.register_blueprint(asset_blueprint)
    flask_app.register_blueprint(image_blueprint)
