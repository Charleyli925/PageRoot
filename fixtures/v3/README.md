# v3 clean workspace fixtures

These are the only positive lifecycle fixtures in the active source tree. Main
records use `schemaVersion: "3.0.0"`; auxiliary completion, input-manifest,
outcome, transaction, committed-marker, and scope-report records keep their own
current strict `1.0.0` contracts.

The directory deliberately contains no legacy import marker, migration report,
`local-editor` Version, `restore` Version, or v2 compatibility branch. The
pre-cutover main-record evidence is retained only in the read-only release
archive and is not an input to the v3 product runtime.
