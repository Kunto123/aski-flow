from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class OutputEntry:
    output: Any
    updated_at: float


class OutputCache:
    """In-memory cache of last outputs per (session_id, node_name).

    Why this exists:
    - Frontend outputData can be cleared or not included in a "run_node" payload.
    - Downstream nodes still need access to the last upstream output.

    Notes:
    - This cache is process-local (RAM). It's meant to stabilize execution between
      runs in the same backend process.
    - We keep a bounded TTL per session to avoid unbounded growth.
    """

    def __init__(self, ttl_sec: float = 60.0 * 30):
        self._ttl_sec = float(ttl_sec)
        self._lock = threading.RLock()
        self._data: Dict[str, Dict[str, OutputEntry]] = {}

    def set_output(self, session_id: Optional[str], node_name: str, output: Any) -> None:
        if not session_id or not node_name:
            return
        now = time.time()
        with self._lock:
            bucket = self._data.setdefault(session_id, {})
            bucket[node_name] = OutputEntry(output=output, updated_at=now)
            self._prune_locked(now)

    def get_output(self, session_id: Optional[str], node_name: str) -> Any:
        if not session_id or not node_name:
            return None
        now = time.time()
        with self._lock:
            self._prune_locked(now)
            entry = self._data.get(session_id, {}).get(node_name)
            return entry.output if entry else None

    def clear_session(self, session_id: Optional[str]) -> None:
        if not session_id:
            return
        with self._lock:
            self._data.pop(session_id, None)

    def clear_node(self, session_id: Optional[str], node_name: str) -> None:
        if not session_id or not node_name:
            return
        with self._lock:
            bucket = self._data.get(session_id)
            if not bucket:
                return
            bucket.pop(node_name, None)
            if not bucket:
                self._data.pop(session_id, None)

    def _prune_locked(self, now: float) -> None:
        ttl = self._ttl_sec
        if ttl <= 0:
            return
        to_delete_sessions = []
        for sid, bucket in list(self._data.items()):
            # Remove stale nodes in this session
            stale_nodes = [
                node
                for node, entry in bucket.items()
                if (now - float(entry.updated_at)) > ttl
            ]
            for node in stale_nodes:
                bucket.pop(node, None)
            if not bucket:
                to_delete_sessions.append(sid)
        for sid in to_delete_sessions:
            self._data.pop(sid, None)


_OUTPUT_CACHE = OutputCache()


def get_output_cache() -> OutputCache:
    return _OUTPUT_CACHE
