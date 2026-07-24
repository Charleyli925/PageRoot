## Summary

Describe the user-visible outcome and why this change is needed.

## Boundary

List the files or subsystems intentionally changed and anything explicitly left unchanged.

## Verification

- [ ] The PR stays draft while iterating; marking it ready should spend the one complete source gate on the final intended tree
- [ ] `npm run gate:task`
- [ ] Relevant manual observation is documented, if automation cannot cover it
- [ ] No secrets, personal paths, user files, build output or release binaries are included
- [ ] Tests and documentation were updated where behavior or contracts changed
- [ ] `CHANGELOG.md` was updated when the change affects a release
