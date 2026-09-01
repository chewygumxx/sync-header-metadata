<!-- vim:set expandtab shiftwidth=4 filetype=markdown: -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

<!--
   -
   - ~chewygumxx/sync-header-metadata.git
   - ::: :/README.md
   -
   -->

<!--
   - [GitHub Action] Checks/rewrites the "~owner/repo.git" and
   - "::: :/<path>" lines in tracked files' header banners against each
   - file's actual repository and path.
   -->

# sync-header-metadata

A GitHub Action that keeps a file-header convention honest: a banner comment
near the top of a file recording that file's own repository and path, e.g.

```js
#!/usr/bin/env node
// vim:set expandtab shiftwidth=4 filetype=javascript:

//
//
// ~owner/repo.git
// ::: :/path/to/this/file
//
//
```

Files get renamed, moved, or forked, and those two lines quietly go stale.
This finds every tracked file whose banner drifted from its actual repository
or path and either fails the build (`verify` mode) or rewrites it (`update`
mode). It never inspects the comment syntax preceding either marker (`#`,
`;`, `//`, `--`, ...), so one code path handles every language in the repo.
The two lines are checked and corrected independently; a file can have one
drifted without the other.

## Usage

To verify without rewrite, failing on drift.

```yaml
- uses: actions/checkout@v7

- name: Verify header repository and path
  uses: chewygumxx/sync-header-metadata@v1
```

To update and rewrite files instead of just failing the check:

```yaml
- uses: actions/checkout@v7
  with:
      ref: ${{ github.head_ref || github.ref_name }}
      persist-credentials: true

- name: Update tracked files
  uses: chewygumxx/sync-header-metadata@v1
  with:
      mode: update

- name: Commit changes
  uses: stefanzweifel/git-auto-commit-action@v7
  with:
      commit_message: "chore: sync header metadata"
```

See [`.github/workflows/sync-header-metadata.yaml`](.github/workflows/sync-header-metadata.yaml)
for a complete, worked example.

### Ignoring files

To exclude paths, add `.github/header_ignore.yaml`:

```yaml
ignore:
  - vendor/**
  - "*.min.js"
  - /config.js
```

A bare pattern (no `/`) matches at any depth; prefix with `/` to anchor it
to the repository root. Negation (`!pattern`) is not supported. Use the
`ignore_config` input to read this list from a different path instead.

### Inputs

| Input           | Required | Default                      | Description                                                   |
|-----------------|----------|-------------------------------|-----------------------------------------------------------------|
| `mode`          | No       | `verify`                     | `verify` fails the job on drift; `update` rewrites in place.  |
| `verbose`       | No       | `false`                      | Enable INFO-level logging.                                     |
| `ignore_config` | No       | `.github/header_ignore.yaml` | Path to the ignore-list YAML file, relative to the repo root.  |

## Development

A composite action: on use, it runs `npm ci --omit=dev` inside its own
checkout to install its one runtime dependency (`yaml`), then runs `run.js`
with `node` (the runtime GitHub Actions provides). Sanity-check changes
locally, from inside a git checkout, after `npm install`:

```sh
INPUT_MODE=verify GITHUB_REPOSITORY=owner/repo node run.js
```

## License

[GNU General Public License v3.0 only](LICENSE)
