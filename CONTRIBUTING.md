# Contributing

Thanks for contributing to `codebase-intelligence`.

## Development setup

```bash
git clone https://github.com/bntvllnt/codebase-intelligence.git
cd codebase-intelligence
pnpm install
```

Useful commands:

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Workflow

- Create a feature branch from `main`
- Keep changes focused and atomic
- Prefer one concern per pull request
- Open a PR early if you want feedback on scope

## Commit conventions

This repository uses conventional-style commit subjects.

Examples:
- `feat: add module-depth CLI command`
- `fix: normalize Windows paths in MCP handlers`
- `docs: clarify MCP setup`
- `test: add regression coverage for dead exports`

The release workflow generates changelog sections from commit prefixes, so prefer:
- `feat:` for user-visible features
- `fix:` for user-visible fixes
- `docs:` / `test:` / `chore:` for non-feature work

## Testing expectations

Before opening a PR, run:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Testing guidance:
- prefer real integration coverage over isolated mocking
- add regression tests for bug fixes
- update docs when CLI, MCP, or metrics behavior changes

## Pull requests

Please include:
- what changed
- why it changed
- any CLI or MCP surface changes
- validation performed

If your change affects users, update the relevant docs in `docs/` and `README.md`.

## Security

Do not open public issues for suspected vulnerabilities.
See [SECURITY.md](SECURITY.md).

## Code of conduct

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
