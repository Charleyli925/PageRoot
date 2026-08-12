# Inline visual Phase 0 probe

Run with `npm run experiment:inline-visual-phase0`.

This is a synthetic, non-production Electron experiment. It does not import
PageRoot application code, accept a user path, persist any result, or enter the
package allowlist. Its expected result is `no-go`: the probe proves several
mechanical properties but intentionally refuses to claim OS-level pointer/IME
pass-through or visible WindowServer composition from hidden-window automation.

See [Phase 0 evidence](../../docs/INLINE_RUNTIME_VISUALS_PHASE0_EVIDENCE.md)
for the decision and the conditions required before this direction can be
revisited.
