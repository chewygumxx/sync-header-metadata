<!-- vim:set expandtab shiftwidth=4 filetype=markdown foldlevel=3: -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

<!--
   -
   - ~chewygumxx/sync-header-metadata.git
   - ::: :/README.md
   -
   -->

<!--
   - Checks/rewrites the "~owner/repo.git" and
   - "::: :/<path>" lines in tracked files' header banners against each
   - file's actual repository and path.
   -->

# sync-header-metadata

A GitHub Action (and local CLI) that keeps a file-header convention honest.

Checks/rewrites the `~owner/repo.git` and `::: :/<path>` lines in tracked files'
header banners against each file's actual repository and path.

## Purpose

Consider the following textfile header, compliant in accordance with the
formalised format standard of a given repository:

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

Were a file with this header to be renamed, moved, forked, or otherwise
displaced, those two lines quietly go stale. This action finds every tracked
file whose banner has drifted from its current repository and/or path and either
loudly fails (`verify` mode), or rewrites it (`update` mode). The logic is
commentstring invariant and will perform irrespective of surrounding language
syntax eg. `-- %s`, `// %s`, `# %s`, `; %s`, et cetera.

Both markers must be the last non-whitespace content on their line, so this
matches the multi-line comment-block style shown above (marker on its own
line, closer on a separate line), but not a single-line closed comment like
`<!-- ~owner/repo.git -->` or `/* ~owner/repo.git */`.

## Usage

To verify without rewrite, failing on drift.

```yaml
- uses: actions/checkout@v7

- name: Verify header repository and path
  uses: chewygumxx/sync-header-metadata@v2
```

To rewrite and update files instead of failing on desync:

```yaml
- uses: actions/checkout@v7
  with:
      ref: ${{ github.head_ref || github.ref_name }}
      persist-credentials: true

- name: Update tracked files
  uses: chewygumxx/sync-header-metadata@v2
  with:
      mode: update

- name: Commit changes
  uses: stefanzweifel/git-auto-commit-action@v7
  with:
      commit_message: "chore: Sync header metadata"
```

For a complete, worked example, see the reusable
[`sync-header-metadata.yaml`](https://github.com/chewygumxx/.github/blob/v1/.github/workflows/sync-header-metadata.yaml)
workflow in `chewygumxx/.github`, which this repository's CI calls.

### Inputs

| Input        | Required | Default   | Description                                                       |
| ------------ | -------- | --------- | ----------------------------------------------------------------- |
| `mode`       | No       | `verify`  | `verify` exits non-zero on drift; `update` rewrites in place.     |
| `verbose`    | No       | `false`   | Enable INFO-level logging.                                        |
| `annotation` | No       | `false`   | Emit `::notice::`/`::warning::`/`::error::` workflow annotations. |

### Local usage

The same checks run from any local checkout via the
[`sync-header-metadata`](https://www.npmjs.com/package/sync-header-metadata)
npm package. Requires Bun or Node.js 24+, and `git` on `PATH`.

```sh
bunx sync-header-metadata            # verify
bunx sync-header-metadata --update   # rewrite in place
```

Pin a major (`sync-header-metadata@2`) or an exact version
(`sync-header-metadata@2.3.0`) for reproducibility; npm versions match the
action's `vX.Y.Z` release tags.

| Option                       | Default   | Description                                                   |
| ---------------------------- | --------- | ------------------------------------------------------------- |
| `-m`, `--mode <mode>`        | `verify`  | `verify` exits non-zero on drift; `update` rewrites in place. |
| `-u`, `--update`             | Off       | Shorthand for `--mode update`.                                |
| `-r`, `--repo <owner/repo>`  | See below | Repository the `~owner/repo.git` line is checked against.     |
| `-v`, `--verbose`            | Off       | Enable INFO-level logging.                                    |
| `-h`, `--help`               |           | Show usage.                                                   |

Without `--repo`, the repository is taken from `$GITHUB_REPOSITORY` if set,
otherwise from the `origin` remote's URL. Workflow annotations are never
emitted locally.

Only files in git's index are checked (`git ls-files`), exactly as in CI. A
new file isn't checked until it's been `git add`ed; untracked files are
skipped without warning.

To catch drift before it reaches CI, e.g. as a husky `pre-commit` hook
(staged files are in the index, so they're covered):

```sh
bunx sync-header-metadata@2
```

### Exit codes

| Code  | Meaning                                                                    |
| ----- | -------------------------------------------------------------------------- |
| `0`   | `verify` passed, or `update` completed.                                    |
| `1`   | `verify` found drift, or a fatal error (e.g. invalid mode, no repository). |
| `2`   | Invalid command-line arguments, e.g. `--update` with `--mode verify`.      |
| `127` | `git` not found on `PATH`.                                                 |

### Ignoring files

To exclude a path, explicitly unset the `sync-header-metadata` boolean
attribute for it in `.gitattributes`:

```gitattributes
vendor/**  -sync-header-metadata
*.min.js   -sync-header-metadata
/config.js -sync-header-metadata
```

Standard `.gitattributes` matching applies:

- A bare pattern with no leading `/` matches at any depth.
- A leading `/` anchors it to that `.gitattributes` file's own directory.
- Nested `.gitattributes` files can re-enable syncing for a subtree per greater
  specificity by setting the attribute back, e.g.
  `important/** sync-header-metadata`.

#### Built-in defaults

The action ships a baseline exclusion list for files that structurally can't
carry a header comment, or are generated/lockfiles that shouldn't be
hand-edited:

```gitattributes
/LICENSE*        -sync-header-metadata
.keep            -sync-header-metadata
*.json           -sync-header-metadata
*.lock           -sync-header-metadata
pnpm-lock.yaml   -sync-header-metadata
go.sum           -sync-header-metadata
*.min.js         -sync-header-metadata
*.min.css        -sync-header-metadata
```

These are loaded at the lowest precedence, so they never need to be declared
in your own `.gitattributes`. Any matching line in your repo (set or
unset) always overrides a default, e.g. to re-enable syncing for one JSON
file despite the blanket `*.json` default:

```gitattributes
config/version.json sync-header-metadata
```


## Limitations

### Workflow files

`update` mode rewrites `.github/workflows/*.yaml` headers the same as any
other tracked file. By default, `GITHUB_TOKEN` cannot push a commit that
touches `.github/workflows/` without the `workflows: write` permission
explicitly granted in the calling workflow. Without it, the commit/push step
following this action (`git-auto-commit-action` or otherwise) fails the
entire commit, and all update writes per this action are lost.

If you haven't granted `workflows: write`, elide workflow files in the same
manner as any other ignored path or learn this security restriction at push.

```gitattributes
.github/workflows/** -sync-header-metadata
```

*(It's a very inconsequential failure. Handling involves either providing the
permission, excluding as shown, or manually updating the out-of-sync workflow
header.)*

### Annotation limits

GitHub caps workflow annotations at 10 errors, 10 warnings, and 10 notices
per step, regardless of the `annotation` input. This action runs as a single
step and can emit up to two `error` annotations per drifted file (one for
the repo line, one for the path line), so a repo with more than a handful of
drifted files will exceed the cap: only the first 10 of each level render in
the PR's Checks/Files-changed UI, the rest are silently dropped by GitHub.

This doesn't affect correctness, the exit code and the plain `[ERROR]` log
lines printed to the job's raw log aren't subject to the cap, only the
`::error::`/`::warning::`/`::notice::` UI annotations are. Treat annotations
as a convenience for small drifts and rely on the job log or `mode: update`'s
diff for anything larger.

A GitHub check run is bound to a single commit (`head_sha`) for its whole
lifetime, and an annotation only renders as an inline bubble on that commit's
own "Files changed" page if the annotated file is part of *that specific
commit's* diff. This action scans every tracked file on each run, not just
what the triggering commit touched, so the use case matters:

- **`verify` mode gating a PR** that renamed or moved a file: the drifted
  file is, by definition, part of that PR's own diff, so the annotation
  lands inline exactly where it's useful. This is the primary intended use
  case and where annotations work well.
- **`update` mode as a scheduled or manually dispatched sweep** across a
  repo's whole tracked-file set (e.g. a periodic cleanup job): most flagged
  files have nothing to do with whatever commit triggered that run, so most
  annotations can't attach to a diff line at all. They still show up in the
  workflow run's own Annotations summary panel, just without a working deep
  link. Rely on the job log and exit code for this shape of run instead.

## Development

A native `node24` action with no install step and no runtime dependencies.
Both entry points are thin wrappers around the same logic:

| File                          | Role                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| `src/sync.js`                 | Core: resolves tracked files, checks/rewrites headers.          |
| `run.js`                      | Action entry: reads `INPUT_*` and `GITHUB_REPOSITORY`.          |
| `bin/sync-header-metadata.js` | CLI entry: reads flags, falls back to the `origin` remote.      |
| `src/action_log.js`           | Logging and `::error::`-style workflow-command annotations.     |

Sanity-check changes locally, from inside a git checkout:

```sh
bun bin/sync-header-metadata.js --verbose   # run the CLI against this repo
bun run test                                # both entry points, in throwaway repos
```

## License

[GNU General Public License v3.0 only](LICENSE)
