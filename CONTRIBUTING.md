# Contributing to PageRoot

Thank you for helping improve PageRoot.

## Before opening a change

1. Search existing Issues and Pull Requests.
2. Create a focused branch from the latest `main`.
3. Keep user files, local paths, credentials, generated builds and private design records out of the repository.
4. Preserve source fidelity: a visual edit must not serialize unrelated DOM or rewrite bytes outside the authorized source range.

## Development workflow

```bash
git switch main
git pull --ff-only
git switch -c fix/short-description
npm ci
npx playwright install chromium
```

Run `npm run gate:edit` while working and `npm run gate:task` before committing. Update tests and documentation with behavioral changes. Use a clear imperative commit message such as `fix: preserve selection across source refresh`.

Push the branch and open a Pull Request. The PR must explain the problem, the chosen boundary, verification performed and any user-visible impact. Maintainers may request a smaller change when a PR mixes unrelated concerns.

## Pull Request requirements

- CI passes without skipped required checks.
- No secrets, personal data, user HTML, generated output or release binary is committed.
- Protocol or schema changes include fixtures, migration/compatibility notes and tests.
- UI changes include a concise description or screenshot when it materially helps review.
- Release-impacting changes update `CHANGELOG.md`.

By contributing, you agree that your contribution is licensed under Apache-2.0.
