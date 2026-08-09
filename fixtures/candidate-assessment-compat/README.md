# Candidate assessment compatibility fixture

These synthetic fixtures represent short-lived August 4, 2026 PageRoot
Developer Preview records both before and during the executable-surface
experiment. `candidate-assessment.pre-executable-dev.json` omitted the pair;
`candidate-assessment.retired-executable-dev.json` retained it.

Both historical shapes remain valid v1 input. The history reader accepts them
only after the frozen base and sealed output are ordinary files, all four
exact/comparison hashes match, and the current document-health and continuity
assessment is reproduced deterministically. Retired executable fields are
normalized out in memory and never influence status, warnings or adoption.
Current writers emit neither executable field and history is never rewritten.
