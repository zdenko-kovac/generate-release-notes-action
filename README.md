# generate-release-notes-action

Composite GitHub Action that generates categorized release notes from conventional commits between two tags using the GitHub Compare API.

## Usage

```yaml
- uses: zdenko-kovac/generate-release-notes-action@v1
  id: release-notes
  with:
    personal-token: ${{ secrets.ACCESS_TOKEN }}
    previous-tag: v1.2.3
    new-tag: v1.3.0
    target-ref: main  # optional, defaults to "main"

- name: Use the notes
  run: echo "${{ steps.release-notes.outputs.release-notes }}"
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `personal-token` | Yes | — | Personal access token with repo read access |
| `previous-tag` | Yes | — | Tag of the previous release (e.g. `v1.2.3`) |
| `new-tag` | Yes | — | Tag being created (used for display in notes) |
| `target-ref` | No | `main` | Branch or commit SHA to compare against the previous tag |

## Outputs

| Output | Description |
|--------|-------------|
| `release-notes` | Generated Markdown release notes |

## How It Works

1. Fetches commits between `previous-tag` and `target-ref` via the GitHub Compare API
2. Filters out bot commits (renovate, service users) and merge/bump commits
3. Categorizes commits using [Conventional Commits](https://www.conventionalcommits.org/) prefixes:

| Prefix | Category |
|--------|----------|
| `feat` | New Features |
| `fix` | Bug Fixes |
| `docs` | Documentation |
| `perf`, `refactor`, `chore`, `ci`, `build`, `style`, `test`, `revert` | Improvements |
| `type!:` (with `!`) | Breaking Changes |
| (other) | Other Changes |

4. Outputs categorized Markdown with a full changelog link

## First Release Handling

If `previous-tag` is empty, `v0.0.0`, or `0.0.0`, the action outputs a simple "Initial Release" message instead of comparing commits.

## Security Hardening

- All `${{ inputs.* }}` values are passed via the `env:` block (`INPUT_*` variables), never interpolated directly into the shell script
- The script runs with `set -euo pipefail` for fail-fast behavior on errors, unset variables, or broken pipes
- The GitHub Compare API response is checked for HTTP status; non-2xx responses fail the action with a `::error::` annotation
- All `$GITHUB_OUTPUT` redirections are properly quoted

## Tests

The action logic lives in `generate-release-notes.sh` (extracted from the inline `run:` block). Tests use Node.js built-in `node:test` with zero dependencies.

```bash
npm test
```

26 tests across 7 suites cover first-release handling, API error handling, commit filtering, conventional-commit categorization, output structure, and section ordering. `curl` is mocked via PATH shadowing; `jq` runs for real.
