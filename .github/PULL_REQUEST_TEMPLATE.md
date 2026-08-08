## Summary

Describe the user-visible outcome and why this change is needed.

## Boundary

List the files or subsystems intentionally changed and anything explicitly left unchanged.

## Verification

- [ ] The PR opened as Draft and ordinary pushes used only PR Feedback
- [ ] The final head is updated onto current `main` and is Ready exactly once for final review
- [ ] P0/P1 user-impact findings and P0/P1 `CHANGES_REQUESTED` reviews are addressed; P2/P3/unclassified debt is linked or left for the weekly roll-up
- [ ] Any later commit returns this PR to Draft before one new final promotion
- [ ] PR scope/size is coherent; it is an advisory discussion, not a mechanical merge limit
- [ ] `npm run gate:task`
- [ ] Relevant manual observation is documented, if automation cannot cover it
- [ ] No secrets, personal paths, user files, build output or release binaries are included
- [ ] Tests and documentation were updated where behavior or contracts changed
- [ ] `CHANGELOG.md` was updated when the change affects a release
