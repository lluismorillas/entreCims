# Contributing

Thank you for helping. entreCims is small on purpose: one container, SQLite, and as few dependencies as possible.

## How to propose a change

1. Open an issue to describe the problem or the idea, unless it is a typo-sized fix.
2. Create a branch from `main`.
3. Make the change with its tests. Bug fixes come with a test that fails without them.
4. Open a pull request that links the issue, and fill in the template.

Continuous integration (lint, tests and the Docker build) must pass before the pull request is merged.

## Set up and check

```sh
cd backend && uv sync
uv run pytest && uv run ruff check . && uv run ruff format --check .

cd ../frontend && npm ci
npm test && npm run lint && npm run build
```

See the README for running the app in development.

## Ground rules

- **Never commit real tracks, photos or databases.** Tests build their own synthetic tracks in code. The `.gitignore` refuses GPX, FIT and TCX files anywhere except `backend/tests/`, and keeps real tracks for the evaluation in `eval/private/`.
- Keep the evaluation honest: a change to peak detection or to the time models comes with a re-run of `eval/peaks.py` or `eval/timing.py` on your own data, and the numbers in the pull request, even when they get worse.
- Before adding a dependency, check that its licence is compatible and add it to [NOTICE.md](NOTICE.md).
- Comments in the code are in Catalan, the interface and this documentation in English.
