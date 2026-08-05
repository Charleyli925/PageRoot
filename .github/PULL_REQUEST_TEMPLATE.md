## Summary

Describe the user-visible outcome and why this change is needed.

## Boundary

List the files or subsystems intentionally changed and anything explicitly left unchanged.

## Verification

- [ ] The PR opened as Draft and ordinary pushes used only PR Feedback
- [ ] The final head is updated onto current `main`; no other PR is being promoted
- [ ] Marking Ready will spend the one complete source gate; any later commit returns this PR to Draft before re-promotion
- [ ] `npm run gate:task`
- [ ] Relevant manual observation is documented, if automation cannot cover it
- [ ] No secrets, personal paths, user files, build output or release binaries are included
- [ ] Tests and documentation were updated where behavior or contracts changed
- [ ] `CHANGELOG.md` was updated when the change affects a release
