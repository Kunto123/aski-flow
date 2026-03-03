# Settings

Responsibilities:
- Store `ServerHost`, `ServerPort`, `UseHttps`.
- Persist device-level `client_id`.
- Handle secure local storage for client settings.

Implemented:
- `NativeClientSettings` as normalized runtime config model.
- `JsonClientSettingsStore` for disk persistence.
- DPAPI-backed secret protector (`WindowsDpapiSecretProtector`) for auth token.
