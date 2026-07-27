# Security model

PageRoot edits local files and renders user-controlled HTML, so its default policy is least privilege and fail-closed validation.

## Main controls

- Electron renderer sandbox, context isolation, disabled Node integration and explicit Content Security Policy
- Narrow preload APIs with payload validation instead of direct IPC exposure
- Project-path allowlisting and real-path checks for privileged file operations
- Hash-checked atomic writes that stop on external modification
- Per-process Bridge authentication token and managed workspace boundaries
- Clipboard-only third-party AI handoff
- Strict schemas, frozen inputs and identity/Hash checks before accepting AI output; scope evidence is always recorded, with protocol/script/target-integrity findings hard-blocked and ordinary breadth findings observed without a user-waiver loop
- No silent application update or binary replacement

## V2 editable-island trust boundary

The rendered preview DOM is disposable and never becomes a whole-document
persistence source. PageRootV2 has one controlled `contenteditable="true"`
route:

- SourceIndex and TargetResolver must prove one exact, explicit-end-tag HTML
  element before activation.
- Runtime layout, text style, Selection, focus and restoration must pass the
  live preflight.
- The controller prevents ordinary `beforeinput` mutations and applies owned
  text, grapheme deletion, `<br>`, plain-text paste and safe inline formatting.
  Browser-created rich HTML has no authority.
- Authored comments and embedded/foreign content are immutable inventory;
  protected attributes cannot be introduced or changed through text editing.
- IME starts from a frozen island and logical Selection. Confirmation is
  replayed once at that frozen source affinity; cancellation restores the
  snapshot.
- MutationObserver rejects and restores any child/text mutation not owned by
  the controller.
- SourcePatch may replace only the selected element's exact content range.
  Outside bytes and source Hash preconditions remain exact; only the edited
  island may be minimally normalized and reparsed.

Pure-browser preview is a different, strictly weaker capability: authored scripts and interactions may run inside the sandbox, but PageRoot editing, comments, attachments, local persistence and AI submission are unavailable. Its transient page state is never treated as unsaved PageRoot content.

## Untrusted inputs

HTML, attachments, AI output, update manifests and IPC payloads are treated as untrusted. Tests and fixtures must use synthetic data. A renderer compromise should not provide arbitrary Node or filesystem access; any new privileged API needs explicit validation and negative tests.

## Known distribution limitation

Current macOS builds are ad-hoc signed and not notarized. Users must verify downloads through GitHub Releases and `SHA256SUMS.txt`. This limitation affects installation trust and convenience; it does not replace the runtime controls above.
