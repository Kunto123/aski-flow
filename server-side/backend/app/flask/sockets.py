import eventlet
from ..env_config import is_cloud_features_enabled, is_set_app_config_on_ui_enabled

eventlet.monkey_patch(all=False, socket=True)

from app.flask.socketio_init import flask_app
from app.flask.socketio_init import socketio
import logging
import json
import copy
import time

from flask import g, request, session
from flask_socketio import emit
from ..root_injector import (
    get_root_injector,
    refresh_root_injector,
)
from .utils.constants import PARAMETERS_FIELD_NAME, ENV_API_KEYS

from ..processors.launcher.processor_launcher import ProcessorLauncher
from ..processors.context.processor_context_flask_request import (
    ProcessorContextFlaskRequest,
)
import traceback
import os
import threading


_ACTIVE_RUNTIME_RUNS = set()
_ACTIVE_RUNTIME_RUNS_LOCK = threading.Lock()
_LAST_VALID_FLOW_BY_SESSION = {}
_LAST_VALID_FLOW_BY_SESSION_LOCK = threading.Lock()


def _read_non_negative_float_env(name: str, default_value: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return max(0.0, float(default_value))
    try:
        return max(0.0, float(raw))
    except Exception:
        return max(0.0, float(default_value))


def _cooperative_sleep(seconds: float) -> None:
    if seconds <= 0:
        return
    try:
        eventlet.sleep(seconds)
    except Exception:
        time.sleep(seconds)


def _runtime_session_key(runtime_session_id=None):
    key = str(runtime_session_id or "").strip()
    if key:
        return key
    sid = str(getattr(request, "sid", "") or "").strip()
    return sid


def _acquire_runtime_run_slot(runtime_session_id=None, wait_timeout_sec: float = 0.0) -> bool:
    session_key = _runtime_session_key(runtime_session_id)
    if not session_key:
        return True

    deadline = None
    wait_timeout_sec = max(0.0, float(wait_timeout_sec or 0.0))
    if wait_timeout_sec > 0:
        deadline = time.time() + wait_timeout_sec

    poll_interval_sec = _read_non_negative_float_env(
        "ASKI_RUNTIME_RUN_SLOT_POLL_SEC",
        0.05,
    )
    poll_interval_sec = max(0.005, poll_interval_sec)

    while True:
        with _ACTIVE_RUNTIME_RUNS_LOCK:
            if session_key not in _ACTIVE_RUNTIME_RUNS:
                _ACTIVE_RUNTIME_RUNS.add(session_key)
                return True

        if deadline is None:
            return False

        remaining = deadline - time.time()
        if remaining <= 0:
            return False
        _cooperative_sleep(min(poll_interval_sec, remaining))


def _release_runtime_run_slot(runtime_session_id=None) -> None:
    session_key = _runtime_session_key(runtime_session_id)
    if not session_key:
        return

    with _ACTIVE_RUNTIME_RUNS_LOCK:
        _ACTIVE_RUNTIME_RUNS.discard(session_key)


def _cache_last_valid_flow_data(runtime_session_id, flow_data) -> None:
    session_key = _runtime_session_key(runtime_session_id)
    if not session_key:
        return

    try:
        flow_copy = copy.deepcopy(flow_data)
    except Exception:
        flow_copy = flow_data

    with _LAST_VALID_FLOW_BY_SESSION_LOCK:
        _LAST_VALID_FLOW_BY_SESSION[session_key] = flow_copy


def _get_last_valid_flow_data(runtime_session_id):
    session_key = _runtime_session_key(runtime_session_id)
    if not session_key:
        return None

    with _LAST_VALID_FLOW_BY_SESSION_LOCK:
        cached = _LAST_VALID_FLOW_BY_SESSION.get(session_key)
    if cached is None:
        return None

    try:
        return copy.deepcopy(cached)
    except Exception:
        return cached


def _clear_last_valid_flow_data(runtime_session_id) -> None:
    session_key = _runtime_session_key(runtime_session_id)
    if not session_key:
        return

    with _LAST_VALID_FLOW_BY_SESSION_LOCK:
        _LAST_VALID_FLOW_BY_SESSION.pop(session_key, None)


def _parse_flow_payload(data, runtime_session_id=None, node_name=None):
    raw_flow = data.get("jsonFile")

    if isinstance(raw_flow, (list, dict)):
        flow_data = raw_flow
    elif isinstance(raw_flow, str):
        if not raw_flow.strip():
            raise ValueError("Missing jsonFile payload")
        try:
            flow_data = json.loads(raw_flow)
        except Exception as parse_error:
            cached = _get_last_valid_flow_data(runtime_session_id)
            if cached is not None:
                logging.warning(
                    "Invalid jsonFile payload; using cached flow runtime_session_id=%s node=%s error=%s",
                    runtime_session_id,
                    node_name,
                    parse_error,
                )
                emit(
                    "error",
                    {
                        "error": (
                            "Received invalid flow JSON while another update was in progress. "
                            "Fallback to the previous valid graph."
                        ),
                        "nodeName": node_name,
                        "code": "invalid_json_fallback",
                    },
                )
                return cached
            raise ValueError("Invalid jsonFile payload") from parse_error
    else:
        raise ValueError("Missing jsonFile payload")

    _cache_last_valid_flow_data(runtime_session_id, flow_data)
    return flow_data


def _normalize_event_data(data):
    if isinstance(data, dict):
        return data
    return {}


def _extract_auth_token(event_data=None):
    payload = _normalize_event_data(event_data)

    authorization = (request.headers.get("Authorization") or "").strip()
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token:
            return token

    header_token = (request.headers.get("X-Aski-Auth-Token") or "").strip()
    if header_token:
        return header_token

    query_token = (request.args.get("auth_token") or "").strip()
    if query_token:
        return query_token

    payload_token = str(payload.get("auth_token") or "").strip()
    if payload_token:
        return payload_token

    return ""


def _is_socket_authorized(event_data=None):
    expected = (os.getenv("ASKI_CLIENT_AUTH_TOKEN") or "").strip()
    if not expected:
        return True
    return _extract_auth_token(event_data) == expected


def _extract_client_id(event_data=None):
    payload = _normalize_event_data(event_data)

    payload_client_id = str(payload.get("client_id") or "").strip()
    if payload_client_id:
        return payload_client_id

    header_client_id = (request.headers.get("X-Aski-Client-Id") or "").strip()
    if header_client_id:
        return header_client_id

    query_client_id = (request.args.get("client_id") or "").strip()
    if query_client_id:
        return query_client_id

    return ""


def _resolve_runtime_session_id(event_data=None):
    # Prefer stable client_id when provided (native app lifecycle), fallback to socket sid.
    client_id = _extract_client_id(event_data)
    return client_id or request.sid


def populate_request_global_object(data):
    """
    This function is responsible for initializing individual request objects either from the
    environmental variables or from the data passed as arguments, ensuring that the necessary API
    keys are available throughout the request for different processes.

    Parameters:
        data (dict): A dictionary containing optional runtime parameters.
    """
    cloud_parameter_keys = {"openai_api_key", "stabilityai_api_key", "replicate_api_key"}
    cloud_enabled = is_cloud_features_enabled()
    use_env = os.getenv("USE_ENV_API_KEYS", "false").lower()
    logging.debug("use_env: %s", use_env)

    if use_env == "true":
        for key in ENV_API_KEYS:
            env_key = key.upper()
            value = os.getenv(env_key)
            if value:
                setattr(g, f"session_{key}", value)
        return
    else:
        if PARAMETERS_FIELD_NAME not in data:
            logging.info("No parameters provided; continuing without API keys.")
            return

        for key, value in data[PARAMETERS_FIELD_NAME].items():
            if key in cloud_parameter_keys and not cloud_enabled:
                logging.info("Ignoring cloud parameter '%s' because ASKI_ENABLE_CLOUD=false", key)
                continue
            if value:
                setattr(g, f"session_{key}", value)


@socketio.on("connect")
def handle_connect(auth=None):
    if not _is_socket_authorized(auth):
        logging.warning("Socket connection rejected: unauthorized sid=%s", request.sid)
        return False

    runtime_session_id = _resolve_runtime_session_id(auth)
    logging.info("Client connected sid=%s runtime_session_id=%s", request.sid, runtime_session_id)


@socketio.on("process_file")
def handle_process_file(data):
    """
    This event handler is activated when a "process_file" event is received via Socket.IO. It allows to run every node in
    the file, even if they have been executed before.

    Parameters:
        data (dict): A dictionary encompassing the event's payload, which comprises the JSON configuration file
                    ("jsonFile").

    """
    data = _normalize_event_data(data)
    runtime_session_id = _resolve_runtime_session_id(data)
    run_slot_acquired = False
    try:
        if not _is_socket_authorized(data):
            emit("error", {"error": "Unauthorized"})
            emit("run_end", {"output": None})
            return

        wait_timeout_sec = _read_non_negative_float_env(
            "ASKI_PROCESS_FILE_BUSY_WAIT_SEC",
            2.0,
        )
        if not _acquire_runtime_run_slot(
            runtime_session_id,
            wait_timeout_sec=wait_timeout_sec,
        ):
            logging.info(
                "Rejecting process_file while run in progress sid=%s runtime_session_id=%s",
                request.sid,
                runtime_session_id,
            )
            emit(
                "error",
                {
                    "error": (
                        "Run already in progress for this client session. "
                        "Wait until current run finishes."
                    ),
                    "code": "run_in_progress",
                    "retryable": True,
                },
            )
            return
        run_slot_acquired = True

        populate_request_global_object(data)
        flow_data = _parse_flow_payload(data, runtime_session_id=runtime_session_id)
        launcher = get_root_injector().get(ProcessorLauncher)
        launcher.set_context(
            ProcessorContextFlaskRequest(g, session, runtime_session_id)
        )

        if flow_data:
            processors = launcher.load_processors(flow_data)
            output = launcher.launch_processors(processors)

            logging.debug("Emitting processing_result event with output: %s", output)
            emit("run_end", {"output": output})
        else:
            logging.warning("Invalid input or missing configuration file")
            emit("error", {"error": "Invalid input or missing configuration file"})
            emit("run_end", {"output": None})
    except Exception as e:
        emit("error", {"error": str(e)})
        # Ensure the frontend does not get stuck in a running state.
        emit("run_end", {"output": None})
        traceback.print_exc()
        logging.error(f"An error occurred: {str(e)}")
    finally:
        if run_slot_acquired:
            _release_runtime_run_slot(runtime_session_id)


@socketio.on("run_node")
def handle_run_node(data):
    """
    This event handler is activated when a "run_node" event is received via Socket.IO. It facilitates the processing
    of the specified node in the data payload, launching only the designated node and preceding nodes if they
    haven't been executed earlier.

    Parameters:
        data (dict): A dictionary encompassing the event's payload, which comprises the JSON configuration file
                    ("jsonFile") and the name of the node to run ("nodeName").

    """
    data = _normalize_event_data(data)
    node_name = data.get("nodeName")
    runtime_session_id = _resolve_runtime_session_id(data)
    run_slot_acquired = False
    try:
        if not _is_socket_authorized(data):
            emit("error", {"error": "Unauthorized"})
            emit("run_end", {"output": None})
            return

        wait_timeout_sec = _read_non_negative_float_env(
            "ASKI_RUN_NODE_BUSY_WAIT_SEC",
            4.0,
        )
        if not _acquire_runtime_run_slot(
            runtime_session_id,
            wait_timeout_sec=wait_timeout_sec,
        ):
            logging.info(
                "Rejecting run_node while run in progress sid=%s runtime_session_id=%s node=%s",
                request.sid,
                runtime_session_id,
                node_name,
            )
            emit(
                "error",
                {
                    "error": (
                        "Run already in progress for this client session. "
                        "Wait until current run finishes."
                    ),
                    "nodeName": node_name,
                    "code": "run_in_progress",
                    "retryable": True,
                },
            )
            return
        run_slot_acquired = True

        populate_request_global_object(data)
        flow_data = _parse_flow_payload(
            data,
            runtime_session_id=runtime_session_id,
            node_name=node_name,
        )

        launcher = get_root_injector().get(ProcessorLauncher)
        launcher.set_context(
            ProcessorContextFlaskRequest(g, session, runtime_session_id)
        )

        if flow_data and node_name:
            processors = launcher.load_processors_for_node(flow_data, node_name)
            output = launcher.launch_processors_for_node(processors, node_name)
            logging.debug("Emitting processing_result event with output: %s", output)
            emit("run_end", {"output": output})
        else:
            logging.warning("Invalid input or missing parameters")
            emit("error", {"error": "Invalid input or missing parameters"})
            emit("run_end", {"output": None})
    except Exception as e:
        emit(
            "error",
            {"error": str(e), "nodeName": node_name},
        )
        emit("run_end", {"output": None})
        traceback.print_exc()
        logging.error(f"An error occurred: {node_name} - {str(e)}")
    finally:
        if run_slot_acquired:
            _release_runtime_run_slot(runtime_session_id)


@socketio.on("disconnect")
def handle_disconnect():
    runtime_session_id = _resolve_runtime_session_id()
    _release_runtime_run_slot(runtime_session_id)
    _clear_last_valid_flow_data(runtime_session_id)

    # Stop orphaned transform streams left behind by this session.
    # Without this, transform threads keep running after a refresh, holding
    # references to the source camera stream and preventing recovery.
    try:
        from app.streaming import get_stream_manager
        manager = get_stream_manager()
        manager.stop_camera_streams(client_session_id=runtime_session_id)
        manager.stop_all_transform_streams()
    except Exception as e:
        logging.warning("Failed to cleanup transform streams on disconnect: %s", e)

    logging.info("Client disconnected sid=%s", request.sid)


@socketio.on("update_app_config")
def handle_update_app_config(data):
    if not is_set_app_config_on_ui_enabled():
        return

    logging.info("Updating app config")
    config_keys = [
        "S3_BUCKET_NAME",
        "S3_AWS_ACCESS_KEY_ID",
        "S3_AWS_SECRET_ACCESS_KEY",
        "S3_AWS_REGION_NAME",
        "S3_ENDPOINT_URL",
        "LOCAL_INFERENCE_BASE_URL",
    ]
    for key in config_keys:
        value = data.get(key)

        if value is not None and str(value).strip():
            logging.info(f"Setting {key}")
            os.environ[key] = value

    refresh_root_injector()
