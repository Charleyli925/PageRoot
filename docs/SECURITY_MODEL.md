# Security model

PageRoot edits local files and renders user-controlled HTML, so its default policy is least privilege and fail-closed validation.

## Main controls

- Electron renderer sandbox, context isolation, disabled Node integration and explicit Content Security Policy
- Narrow preload APIs with payload validation instead of direct IPC exposure
- Project-path allowlisting and real-path checks for privileged file operations
- Hash-checked atomic writes that stop on external modification
- Per-process Bridge authentication token and managed workspace boundaries
- Clipboard-only third-party AI handoff
- Strict schemas, frozen inputs and identity/scope/Hash checks before accepting AI output
- No silent application update or binary replacement

## Untrusted inputs

HTML, attachments, AI output, update manifests and IPC payloads are treated as untrusted. Tests and fixtures must use synthetic data. A renderer compromise should not provide arbitrary Node or filesystem access; any new privileged API needs explicit validation and negative tests.

## Known distribution limitation

Current macOS builds are ad-hoc signed and not notarized. Users must verify downloads through GitHub Releases and `SHA256SUMS.txt`. This limitation affects installation trust and convenience; it does not replace the runtime controls above.
