import os
import sys

from dotenv import load_dotenv

from app.log_config import root_logger

load_dotenv()

from app.flask.socketio_init import flask_app, socketio
import app.flask.sockets  # noqa: F401
import app.flask.routes  # noqa: F401


def run() -> None:
    """Run the backend server.

    Environment variables:
      - BACKEND_HOST / BACKEND_PORT (preferred)
      - HOST / PORT (legacy)
    """

    host = os.getenv("BACKEND_HOST") or os.getenv("HOST") or "127.0.0.1"
    port_raw = os.getenv("BACKEND_PORT") or os.getenv("PORT") or "8000"
    port = int(port_raw)

    root_logger.info(f"Starting application on {host}:{port}...")
    root_logger.info("You can stop the application by pressing Ctrl+C at any time.")

    # If we're running in a PyInstaller bundle
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(
            sys._MEIPASS, "ms-playwright"
        )

    root_logger.warning("Protocol set to HTTP")
    socketio.run(flask_app, port=port, host=host)


if __name__ == "__main__":
    run()
