# MSIX Packaging Template

This folder stores static files used by `scripts/build-msix.ps1`.

## Files
- `AppxManifest.template.xml`
  - Tokenized manifest template.
  - Runtime values are injected by `build-msix.ps1`.

## Manifest Tokens
- `{{IDENTITY_NAME}}`
- `{{PUBLISHER}}`
- `{{VERSION}}`
- `{{DISPLAY_NAME}}`
- `{{PUBLISHER_DISPLAY_NAME}}`
- `{{DESCRIPTION}}`
- `{{APP_ID}}`
- `{{EXECUTABLE_NAME}}`
- `{{MIN_WINDOWS_VERSION}}`
- `{{MAX_WINDOWS_VERSION}}`
