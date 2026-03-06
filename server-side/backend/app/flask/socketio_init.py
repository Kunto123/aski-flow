import eventlet

eventlet.monkey_patch(all=False, socket=True)

import errno
import eventlet.wsgi as eventlet_wsgi
from flask_socketio import SocketIO
from .flask_app import create_app


def _patch_eventlet_broken_sock_for_windows() -> None:
    """Treat Windows aborted/reset connection codes as expected client disconnects.

    On Windows, eventlet may surface WinError 10053 during request finalization
    when the peer closes the connection. Marking it as BROKEN_SOCK prevents
    noisy traceback spam for normal disconnect behavior.
    """

    win_codes = {10053}
    if hasattr(errno, "WSAECONNABORTED"):
        win_codes.add(int(errno.WSAECONNABORTED))
    if hasattr(errno, "WSAECONNRESET"):
        win_codes.add(int(errno.WSAECONNRESET))
    if hasattr(errno, "ESHUTDOWN"):
        win_codes.add(int(errno.ESHUTDOWN))

    eventlet_wsgi.BROKEN_SOCK = set(eventlet_wsgi.BROKEN_SOCK).union(win_codes)


_patch_eventlet_broken_sock_for_windows()

flask_app = create_app()
socketio = SocketIO(
    flask_app,
    cors_allowed_origins="*",
    async_mode="eventlet",
    # Flask 3.1 RequestContext has read-only `session`; let Flask manage session directly.
    manage_session=False,
)
