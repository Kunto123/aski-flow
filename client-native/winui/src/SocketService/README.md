# SocketService

Responsibilities:
- Connect/disconnect/reconnect Socket.IO.
- Subscribe to:
  `progress`, `error`, `run_end`, `current_node_running`.
- Emit:
  `run_node`, `process_file`, `update_app_config`.

Implemented:
- Event contracts in `FlowSocketEvents`.
- Service abstraction `IFlowSocketClient`.
- `FlowSocketClientSocketIo` as real Socket.IO transport implementation.
- `FlowSocketClientStub` kept as optional fallback (`ASKI_NATIVE_SOCKET_STUB=true`).
