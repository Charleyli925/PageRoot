# Candidate assessment compatibility fixture

This synthetic fixture represents the short-lived August 4, 2026 PageRoot
Developer Preview producer that wrote `candidate-assessment.json` with
`schemaVersion: "1.0.0"` before executable-surface evidence became required.

The current strict v1 Schema intentionally rejects the persisted legacy JSON.
The historical-Version read adapter may decode it only after the frozen base
and sealed output are ordinary files, all four exact/comparison hashes match,
and every field emitted by that producer is reproduced deterministically. The
decoded current assessment is `blocked` because the synthetic output changes a
script. Current writers never emit this legacy shape.
