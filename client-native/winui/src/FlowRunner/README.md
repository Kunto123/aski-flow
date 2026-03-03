# FlowRunner

Responsibilities:
- Trigger `run_node` and `process_file`.
- Track run state per node.
- Relay progress and final output to UI components.

Implemented:
- `AskiRestClient` for REST operations used by current contract v1.
- Typed response models in `FlowApiModels`.
- Supports `/v1` prefixed routes while still matching existing backend schema.
